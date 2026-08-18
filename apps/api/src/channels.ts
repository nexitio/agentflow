/**
 * Channel ingress (AGENTS.md §2, §4.2) — webhooks acknowledge fast and do
 * nothing else: verify signature → dedupe → enqueue → 200 (<100ms).
 *
 * - `/webhooks/meta`    — Meta challenge handshake (GET) + events (POST).
 *   The same webhook serves Messenger/Instagram and WhatsApp; the channel is
 *   resolved from the payload (`whatsapp_business_account` vs messaging).
 *   Instagram DMs share the Messenger surface; per-account disambiguation
 *   lands with the Phase 6 credential store.
 * - `/webhooks/tiktok`  — TikTok Business Messaging events (POST).
 * - `/widget/messages`  — the embed's inbound POST (token-authenticated).
 * - `/widget/connect`   — SSE stream carrying outbound replies.
 * - `/api/channels`     — the setup screen's data (AGENTS.md §7).
 *
 * Dedupe here is a point lookup (cheap); the DB unique index in the worker is
 * the authoritative at-least-once backstop. If the queue is unavailable we
 * answer 503 so the provider retries — dedupe makes the retry a no-op.
 */

import { timingSafeEqual } from "node:crypto";
import { getProviderAdapter } from "@agentflow/channels";
import type { ChannelCredentials } from "@agentflow/channels/types";
import { createWidgetAdapter, type WidgetPublisher } from "@agentflow/channels/widget";
import type { Db } from "@agentflow/db/client";
import { listChannelStatus, recordChannelStatus } from "@agentflow/db/repo/channels";
import { hasInboundMessage } from "@agentflow/db/repo/conversations";
import { BUILTIN_WORKSPACE_ID } from "@agentflow/db/seed";
import { ForbiddenError, ProviderError, ValidationError } from "@agentflow/shared/errors";
import { logger } from "@agentflow/shared/logger";
import { type Channel, normalizedMessageSchema } from "@agentflow/shared/types";
import { uuidv7 } from "@agentflow/shared/uuid";
import { Hono } from "hono";

import type { InboundQueue } from "./queue";
import type { WidgetStreamHub } from "./widget-hub";

export interface ChannelRoutesOptions {
  db?: Db;
  queue?: InboundQueue;
  widgetHub?: WidgetStreamHub;
  widgetPublisher?: WidgetPublisher;
  credentials?: ChannelCredentials;
  publicBaseUrl?: string;
  metaVerifyToken?: string;
  widgetToken?: string;
  now?: () => Date;
}

interface ParsedWebhook {
  rawBody: string;
  payload: unknown;
}

function parseWebhook(c: { req: { text(): Promise<string> } }): Promise<ParsedWebhook> {
  return c.req.text().then((rawBody) => {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new ValidationError("Webhook payload is not valid JSON.");
    }
    return { rawBody, payload };
  });
}

function channelFromMetaPayload(payload: unknown): Channel {
  if (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: unknown }).object === "whatsapp_business_account"
  ) {
    return "whatsapp";
  }
  return "messenger";
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function channelRoutes(options: ChannelRoutesOptions): Hono {
  const app = new Hono();

  const requireDb = (): Db => {
    if (options.db === undefined) {
      throw new ProviderError("Database not configured.", { provider: "internal", status: 500 });
    }
    return options.db;
  };

  const requireQueue = (): InboundQueue => {
    if (options.queue === undefined) {
      // No queue → cannot ack inbound safely; answer 503 so the provider
      // retries (dedupe turns the retry into a no-op).
      throw new ProviderError("Message queue is not configured (REDIS_URL).", {
        provider: "internal",
        status: 503,
      });
    }
    return options.queue;
  };

  /** Shared ingress: verify → dedupe → record status → enqueue → 200. */
  const ingest = async (
    channel: Channel,
    normalize: (payload: unknown) => {
      externalThreadId: string;
      externalMessageId: string;
      sender: { id: string; name?: string };
      text: string;
      attachments: { type: string; url: string }[];
    } | null,
    payload: unknown,
    c: { json(body: unknown, status?: number): Response },
  ): Promise<Response> => {
    const event = normalize(payload);
    if (event === null) {
      // Echoes, delivery receipts, template callbacks — acknowledge, do nothing.
      return c.json({ status: "ignored" });
    }
    const db = requireDb();
    const now = options.now ?? (() => new Date());

    // Dedupe (cheap point lookup; the unique index in the worker is the backstop).
    const exists = await hasInboundMessage(
      db,
      BUILTIN_WORKSPACE_ID,
      channel,
      event.externalMessageId,
    );
    if (exists) {
      return c.json({ status: "duplicate" });
    }

    await recordChannelStatus(db, BUILTIN_WORKSPACE_ID, channel, {});

    const message = normalizedMessageSchema.parse({
      id: uuidv7(),
      workspaceId: BUILTIN_WORKSPACE_ID,
      channel,
      externalThreadId: event.externalThreadId,
      externalMessageId: event.externalMessageId,
      sender: event.sender,
      text: event.text,
      attachments: event.attachments,
      receivedAt: now().toISOString(),
    });
    await requireQueue().enqueue(message);
    return c.json({ status: "ok" });
  };

  // --- Meta: challenge handshake (verification) ---------------------------
  app.get("/webhooks/meta", async (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    const db = requireDb();

    if (mode !== "subscribe" || token === undefined || challenge === undefined) {
      throw new ValidationError("Meta verification handshake is malformed.");
    }
    const expected = options.metaVerifyToken;
    if (expected === undefined || !constantTimeEquals(token, expected)) {
      await recordChannelStatus(db, BUILTIN_WORKSPACE_ID, "messenger", {
        lastError:
          "Meta verify token mismatch — the token you pasted into Meta does not match META_VERIFY_TOKEN.",
      });
      throw new ForbiddenError("Meta verify token does not match.");
    }
    await recordChannelStatus(db, BUILTIN_WORKSPACE_ID, "messenger", { verified: true });
    logger.info("meta webhook verified", { service: "api" });
    return c.text(challenge);
  });

  // --- Meta: events --------------------------------------------------------
  app.post("/webhooks/meta", async (c) => {
    const { rawBody, payload } = await parseWebhook(c);
    const credentials = options.credentials ?? {};
    const adapter = getProviderAdapter("messenger");
    if (adapter === undefined) {
      throw new ProviderError("Meta adapter is not available.", { provider: "meta" });
    }
    const channel = channelFromMetaPayload(payload);
    const normalize = getProviderAdapter(channel)?.normalizeInbound;
    if (normalize === undefined) {
      throw new ProviderError(`No adapter for channel ${channel}.`, { provider: "meta" });
    }
    adapter.verifyWebhook(credentials, {
      rawBody,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
    });
    return ingest(channel, normalize, payload, c);
  });

  // --- TikTok: events ------------------------------------------------------
  app.post("/webhooks/tiktok", async (c) => {
    const { rawBody, payload } = await parseWebhook(c);
    const adapter = getProviderAdapter("tiktok");
    if (adapter === undefined) {
      throw new ProviderError("TikTok adapter is not available.", { provider: "tiktok" });
    }
    adapter.verifyWebhook(options.credentials ?? {}, {
      rawBody,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
    });
    return ingest("tiktok", adapter.normalizeInbound, payload, c);
  });

  // --- Widget: inbound -----------------------------------------------------
  app.post("/widget/messages", async (c) => {
    const token = options.widgetToken;
    const provided =
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? c.req.query("token");
    if (token === undefined || provided === undefined || !constantTimeEquals(provided, token)) {
      throw new ForbiddenError("Invalid widget token.");
    }
    const body: unknown = await c.req.json();
    // The API generates the message id — a visitor can forge text, never ids.
    const enriched = {
      ...(typeof body === "object" && body !== null ? body : {}),
      messageId: uuidv7(),
    };
    const adapter = createWidgetAdapter(
      options.widgetPublisher ?? { publish: async () => undefined },
    );
    const event = adapter.normalizeInbound(enriched);
    if (event === null) {
      throw new ValidationError("Widget payload must include conversationId, and text.");
    }
    return ingest("widget", () => event, event, c);
  });

  // --- Widget: SSE outbound stream -----------------------------------------
  app.get("/widget/connect", (c) => {
    const token = options.widgetToken;
    const provided = c.req.query("token");
    const conversationId = c.req.query("conversationId");
    if (token === undefined || provided === undefined || !constantTimeEquals(provided, token)) {
      return c.text("unauthorized", 401);
    }
    if (conversationId === undefined || conversationId.length === 0) {
      return c.text("conversationId is required", 400);
    }
    const hub = options.widgetHub;
    if (hub === undefined) {
      return c.text("widget streaming is not configured", 503);
    }
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));
        unsubscribe = hub.subscribe(conversationId as string, (reply) => {
          try {
            controller.enqueue(encoder.encode(`event: reply\ndata: ${JSON.stringify(reply)}\n\n`));
          } catch {
            // stream closed — the subscriber cleanup below handles it
          }
        });
      },
      cancel() {
        unsubscribe?.();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

  // --- Setup screen data ---------------------------------------------------
  app.get("/api/channels", async (c) => {
    const db = requireDb();
    const statuses = await listChannelStatus(db, BUILTIN_WORKSPACE_ID);
    const base = (options.publicBaseUrl ?? "").replace(/\/+$/, "");
    const channels = statuses.map((status) => {
      const webhookUrl =
        status.channel === "widget"
          ? null
          : `${base}/webhooks/${status.channel === "tiktok" ? "tiktok" : "meta"}`;
      return {
        ...status,
        webhookUrl,
        guidance: guidanceFor(status.channel, options),
      };
    });
    return c.json({
      channels,
      secrets: {
        metaVerifyToken: options.metaVerifyToken ?? null,
        widgetToken: options.widgetToken ?? null,
      },
    });
  });

  return app;
}

/** Plain-English setup guidance per channel (AGENTS.md §7). */
function guidanceFor(channel: Channel, options: ChannelRoutesOptions): string {
  switch (channel) {
    case "messenger":
    case "instagram":
      return options.credentials?.appSecret
        ? "Webhook is ready. Paste the URL into your Meta app → Messenger (and Instagram) → Webhooks, with the verify token shown on this screen."
        : "Set META_APP_SECRET and META_PAGE_TOKEN in the environment, then paste the webhook URL into your Meta app.";
    case "whatsapp":
      return options.credentials?.appSecret
        ? "Webhook is ready. Paste the URL into your WhatsApp Cloud API app and subscribe to the messages field."
        : "Set META_APP_SECRET, META_PAGE_TOKEN, and WHATSAPP_PHONE_NUMBER_ID in the environment.";
    case "tiktok":
      return options.credentials?.clientSecret
        ? "Webhook is ready. Paste the URL into your TikTok Business Messaging webhook configuration."
        : "Set TIKTOK_CLIENT_SECRET and TIKTOK_ACCESS_TOKEN in the environment, then subscribe this URL in TikTok.";
    case "widget":
      return "No provider setup needed — paste the widget script into your site and use the token shown on this screen.";
  }
}
