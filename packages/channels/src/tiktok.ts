/**
 * TikTok Business Messaging API adapter (docs/knowledge/10-tiktok-widget-channels.md).
 *
 * Verified against live documentation (Aug 2026):
 * - Signature scheme (TikTok for Developers, "Webhook Signature Verification"):
 *   header `TikTok-Signature: t=<unix-seconds>,s=<hex>`; signed payload is
 *   `t + "." + raw JSON body`; HMAC-SHA256 keyed with the client secret.
 *   https://developers.tiktok.com/doc/webhooks-verification
 * - Reply window: 48h from the user's last message (Business Messaging API
 *   "Messaging limits" — see windows.ts for the doc links).
 * - The inbound envelope and send endpoint live behind TikTok's JS-rendered
 *   portal (business-api.tiktok.com/portal/docs) and could not be crawled;
 *   the normalizer here tolerates the documented field shapes
 *   (sender.open_id, msg_id, content.type/content.text) and the send URL is
 *   overridable via TIKTOK_SEND_URL. Verify the exact envelope at
 *   integration time against the portal before going live (AGENTS.md §13).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError } from "@agentflow/shared/errors";

import type { ChannelAdapter, InboundEvent } from "./types";

/** Send endpoint — confirm against the current portal docs at integration time. */
const TIKTOK_SEND_URL =
  process.env.TIKTOK_SEND_URL ?? "https://open.tiktokapis.com/v2/message/send/";
/** Reject signed payloads older than this (replay protection per TikTok docs). */
const TIKTOK_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * `TikTok-Signature: t=<timestamp>,s=<hex-signature>`. The signed payload is
 * `timestamp + "." + rawBody`, HMAC-SHA256 with the client secret. Also
 * rejects stale timestamps (replay protection).
 */
export function verifyTikTokSignature(
  clientSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
  now: Date = new Date(),
): boolean {
  if (signatureHeader === undefined) {
    return false;
  }
  let timestamp: string | undefined;
  let signature: string | undefined;
  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const prefix = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (prefix === "t") {
      timestamp = value;
    } else if (prefix === "s") {
      signature = value;
    }
  }
  if (timestamp === undefined || signature === undefined) {
    return false;
  }
  const timestampMs = Number(timestamp) * 1000;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(now.getTime() - timestampMs) > TIKTOK_SIGNATURE_MAX_AGE_MS
  ) {
    return false;
  }
  const received = Buffer.from(signature, "hex");
  const computed = createHmac("sha256", clientSecret).update(`${timestamp}.${rawBody}`).digest();
  if (received.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(received, computed);
}

/** Reduce a BM API webhook event. Defensive: tolerates several envelopes. */
function tiktokEventToInbound(payload: unknown): InboundEvent | null {
  if (!isRecord(payload)) {
    return null;
  }
  // The event may sit under `event` or `events[]`, or be the payload itself.
  const candidates: unknown[] = [];
  if (isRecord(payload.event)) {
    candidates.push(payload.event);
  } else if (Array.isArray(payload.events)) {
    candidates.push(...payload.events);
  } else {
    candidates.push(payload);
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    const sender = isRecord(candidate.sender) ? candidate.sender : undefined;
    const openId = asString(sender?.open_id) ?? asString(candidate.sender_id);
    const messageId = asString(candidate.msg_id) ?? asString(candidate.message_id);
    if (openId === undefined || messageId === undefined) {
      continue;
    }
    const content = isRecord(candidate.content) ? candidate.content : undefined;
    const text = asString(content?.text) ?? asString(candidate.text) ?? "";
    return {
      externalThreadId: openId,
      externalMessageId: messageId,
      sender: { id: openId, name: asString(sender?.name) },
      text,
      attachments: [],
    };
  }
  return null;
}

export const tiktokAdapter: ChannelAdapter = {
  channel: "tiktok",
  verifyWebhook(credentials, request) {
    const secret = credentials.clientSecret;
    if (secret === undefined || secret.length === 0) {
      throw new ProviderError("TikTok client secret is not configured (TIKTOK_CLIENT_SECRET).", {
        provider: "tiktok",
        status: 500,
      });
    }
    // Provider header casing varies across TikTok docs — check every variant
    // rather than trusting one canonical name.
    const header =
      request.headers["tiktok-signature"] ??
      request.headers["TikTok-Signature"] ??
      request.headers.tiktok_signature;
    if (!verifyTikTokSignature(secret, request.rawBody, header)) {
      throw new ProviderError("Invalid TikTok webhook signature.", {
        provider: "tiktok",
        status: 403,
      });
    }
  },
  normalizeInbound: tiktokEventToInbound,
  async sendOutbound(credentials, reply) {
    const token = credentials.tiktokAccessToken;
    if (token === undefined || token.length === 0) {
      throw new ProviderError("TikTok access token is not configured (TIKTOK_ACCESS_TOKEN).", {
        provider: "tiktok",
        status: 500,
      });
    }
    let response: Response;
    try {
      response = await fetch(TIKTOK_SEND_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to_user: { open_id: reply.externalThreadId },
          message_type: "text",
          content: { text: reply.text },
        }),
      });
    } catch (error) {
      throw new ProviderError("TikTok outbound request failed.", {
        provider: "tiktok",
        cause: error,
      });
    }
    const errorBody = await response.text().catch(() => "");
    if (!response.ok) {
      throw new ProviderError(`TikTok API returned ${response.status}`, {
        provider: "tiktok",
        status: response.status,
        details: { errorBody: errorBody.slice(0, 300) },
      });
    }
    const data: unknown = JSON.parse(errorBody || "{}");
    const dataRecord = isRecord(data) && isRecord(data.data) ? data.data : undefined;
    const messageId = dataRecord === undefined ? undefined : asString(dataRecord.message_id);
    return { providerMessageId: messageId ?? reply.id };
  },
};
