/**
 * Meta channels — Messenger, Instagram DM, WhatsApp Cloud API (AGENTS.md §7,
 * docs/knowledge/09-meta-channels.md). All three run on the Graph API; the
 * webhook signature scheme and the challenge handshake are shared.
 *
 * - Signature: `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 of the RAW
 *   body with the app secret — verified before JSON parsing (§4.2).
 * - Messenger/IG: `entry[].messaging[]` events; customer messages only
 *   (filter echoes + receipts). Same app, same webhook surface.
 * - WhatsApp: `entry[].changes[].value.messages[]` (statuses are callbacks,
 *   not customer messages).
 * - Outbound: `POST /me/messages` (Messenger/IG) or
 *   `POST /{phone-number-id}/messages` (WhatsApp), always with the operator's
 *   token. Reply-window checks happen BEFORE send (windows.ts).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError } from "@agentflow/shared/errors";
import type { Channel, NormalizedReply } from "@agentflow/shared/types";

import type { ChannelAdapter, ChannelCredentials, InboundEvent, WebhookRequest } from "./types";

/** Pin the Graph API version; Meta deprecates on a schedule (see docs 09). */
const META_GRAPH_API_VERSION = "v21.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Constant-time comparison of the computed and received signatures. */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (signatureHeader === undefined || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const received = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const computed = createHmac("sha256", appSecret).update(rawBody).digest();
  if (received.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(received, computed);
}

function normalizeAttachments(attachments: unknown): { type: string; url: string }[] {
  if (!Array.isArray(attachments)) {
    return [];
  }
  const normalized: { type: string; url: string }[] = [];
  for (const attachment of attachments) {
    if (!isRecord(attachment)) {
      continue;
    }
    const type = asString(attachment.type) ?? "unknown";
    const payload = isRecord(attachment.payload) ? attachment.payload : undefined;
    const url = asString(payload?.url);
    if (url !== undefined) {
      normalized.push({ type, url });
    }
  }
  return normalized;
}

/** Messenger/Instagram: an entry.messaging event that is a customer message. */
function messengerEventToInbound(payload: unknown): InboundEvent | null {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return null;
  }
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.messaging)) {
      continue;
    }
    for (const event of entry.messaging) {
      if (!isRecord(event) || !isRecord(event.message)) {
        continue;
      }
      const message = event.message;
      if (message.is_echo === true) {
        continue; // our own sends come back as echoes — not customer messages
      }
      const sender = isRecord(event.sender) ? event.sender : undefined;
      const senderId = asString(sender?.id);
      const messageId = asString(message.mid);
      if (senderId === undefined || messageId === undefined) {
        continue;
      }
      const text = asString(message.text) ?? "";
      const attachmentRecords = normalizeAttachments(message.attachments);
      return {
        externalThreadId: senderId, // Messenger/IG thread == the sender's PSID
        externalMessageId: messageId,
        sender: { id: senderId, name: asString(sender?.name) },
        text,
        attachments: attachmentRecords,
      };
    }
  }
  return null;
}

/** WhatsApp Cloud API: value.messages[0], skipping status callbacks. */
function whatsappEventToInbound(payload: unknown): InboundEvent | null {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return null;
  }
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue;
    }
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        continue;
      }
      const messages = change.value.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        continue;
      }
      const message = messages[0];
      if (!isRecord(message)) {
        continue;
      }
      const messageId = asString(message.id);
      const from = asString(message.from);
      if (messageId === undefined || from === undefined) {
        continue;
      }
      const type = asString(message.type);
      const text =
        type === "text" && isRecord(message.text) ? (asString(message.text.body) ?? "") : "";
      const media =
        type !== undefined && type !== "text" && isRecord(message[type])
          ? message[type]
          : undefined;
      const mediaUrl = media === undefined ? undefined : asString(media.url);
      const attachments = mediaUrl !== undefined ? [{ type: type ?? "media", url: mediaUrl }] : [];
      return {
        externalThreadId: from, // WhatsApp thread == the customer's phone number
        externalMessageId: messageId,
        sender: { id: from },
        text,
        attachments,
      };
    }
  }
  return null;
}

interface SendResponse {
  ok: boolean;
  status: number;
  providerMessageId: string | undefined;
  errorBody: string;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<SendResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ProviderError("Channel outbound request failed.", {
      provider: "meta",
      cause: error,
    });
  }
  const errorBody = await response.text().catch(() => "");
  if (!response.ok) {
    throw new ProviderError(`Meta API returned ${response.status}`, {
      provider: "meta",
      status: response.status,
      details: { errorBody: errorBody.slice(0, 300) },
    });
  }
  const data: unknown = JSON.parse(errorBody || "{}");
  let providerMessageId: string | undefined;
  if (isRecord(data) && Array.isArray(data.messages)) {
    providerMessageId = asString((data.messages[0] as Record<string, unknown> | undefined)?.id);
  } else if (isRecord(data)) {
    providerMessageId = asString(data.message_id);
  }
  return { ok: true, status: response.status, providerMessageId, errorBody: "" };
}

function requireToken(credentials: ChannelCredentials): string {
  const token = credentials.accessToken;
  if (token === undefined || token.length === 0) {
    throw new ProviderError("Meta access token is not configured (META_PAGE_TOKEN).", {
      provider: "meta",
      status: 500,
    });
  }
  return token;
}

function metaVerify(credentials: ChannelCredentials, request: WebhookRequest): void {
  const secret = credentials.appSecret;
  if (secret === undefined || secret.length === 0) {
    throw new ProviderError("Meta app secret is not configured (META_APP_SECRET).", {
      provider: "meta",
      status: 500,
    });
  }
  const header = request.headers["x-hub-signature-256"] ?? request.headers["X-Hub-Signature-256"];
  if (!verifyMetaSignature(secret, request.rawBody, header)) {
    throw new ProviderError("Invalid Meta webhook signature.", {
      provider: "meta",
      status: 403,
    });
  }
}

async function sendMessengerLike(
  credentials: ChannelCredentials,
  reply: NormalizedReply,
  threadType: "psid",
): Promise<{ providerMessageId: string }> {
  const token = requireToken(credentials);
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(token)}`;
  const result = await postJson(
    url,
    {},
    {
      recipient: { [threadType]: reply.externalThreadId },
      messaging_type: "RESPONSE",
      message: { text: reply.text },
    },
  );
  return { providerMessageId: result.providerMessageId ?? reply.id };
}

export const messengerAdapter: ChannelAdapter = {
  channel: "messenger",
  verifyWebhook: metaVerify,
  normalizeInbound: messengerEventToInbound,
  sendOutbound: (credentials, reply) => sendMessengerLike(credentials, reply, "psid"),
};

export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",
  verifyWebhook: metaVerify,
  normalizeInbound: messengerEventToInbound,
  sendOutbound: (credentials, reply) => sendMessengerLike(credentials, reply, "psid"),
};

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  verifyWebhook: metaVerify,
  normalizeInbound: whatsappEventToInbound,
  async sendOutbound(credentials, reply) {
    const token = requireToken(credentials);
    const phoneNumberId = credentials.phoneNumberId;
    if (phoneNumberId === undefined || phoneNumberId.length === 0) {
      throw new ProviderError(
        "WhatsApp phone number id is not configured (WHATSAPP_PHONE_NUMBER_ID).",
        { provider: "whatsapp", status: 500 },
      );
    }
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const result = await postJson(
      url,
      { authorization: `Bearer ${token}` },
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: reply.externalThreadId,
        type: "text",
        text: { body: reply.text },
      },
    );
    return { providerMessageId: result.providerMessageId ?? reply.id };
  },
};

/** The meta adapters keyed by channel — registry lookup, not a barrel. */
export const META_ADAPTERS: Record<Channel, ChannelAdapter | undefined> = {
  messenger: messengerAdapter,
  instagram: instagramAdapter,
  whatsapp: whatsappAdapter,
  tiktok: undefined,
  widget: undefined,
};
