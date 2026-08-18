/**
 * The adapter contract (AGENTS.md §7). Every channel adapter implements the
 * same surface; the engine never branches on channel type — provider
 * quirks (signatures, payload shapes, window policy) live here.
 */

import type { Channel, NormalizedReply } from "@agentflow/shared/types";

/**
 * Provider credentials. Phase 5 loads them from the environment (Zod-validated
 * in config.ts); the encrypted credentials table (invariant §4.6) is the
 * Phase 6+ path for the operator UI.
 */
export interface ChannelCredentials {
  /** Meta Graph API app secret — webhook signature (X-Hub-Signature-256). */
  appSecret?: string;
  /** Meta page/system-user token — outbound sends. */
  accessToken?: string;
  /** WhatsApp Cloud API phone-number id — outbound endpoint. */
  phoneNumberId?: string;
  /** TikTok client secret — webhook signature (TikTok-Signature). */
  clientSecret?: string;
  /** TikTok access token — outbound sends. */
  tiktokAccessToken?: string;
  /** Widget embed token — shared workspace token for Phase 5. */
  widgetToken?: string;
}

/** A provider payload reduced to what the engine/worker needs. */
export interface InboundEvent {
  externalThreadId: string;
  externalMessageId: string;
  sender: { id: string; name?: string };
  text: string;
  attachments: { type: string; url: string }[];
}

export interface WebhookRequest {
  /** The RAW body — signatures are computed over it before JSON parsing. */
  rawBody: string;
  headers: Record<string, string>;
}

export interface OutboundResult {
  providerMessageId: string;
}

export interface ChannelAdapter {
  channel: Channel;
  /**
   * Verify the transport signature over the raw body. Throws ForbiddenError
   * on mismatch or a missing secret — the caller answers 403 without
   * touching the payload (invariant §4.2).
   */
  verifyWebhook(credentials: ChannelCredentials, request: WebhookRequest): void;
  /**
   * Reduce a provider payload to an InboundEvent, or null when it is not a
   * customer message (echoes, delivery receipts, template callbacks). Never
   * throws on provider shapes it doesn't recognize — data problems are typed.
   */
  normalizeInbound(payload: unknown): InboundEvent | null;
  /** Send a NormalizedReply. Throws typed ProviderError on failure. */
  sendOutbound(credentials: ChannelCredentials, reply: NormalizedReply): Promise<OutboundResult>;
}
