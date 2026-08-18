/**
 * Widget adapter — our own channel (docs/knowledge/10-tiktok-widget-channels.md).
 *
 * No provider, no signature, no reply window. The embed's messages are still
 * a boundary: the API validates the embed token and Zod-validates the payload
 * (a visitor can forge messages — same untrusted-input rules as every channel,
 * invariant §4.5). Outbound delivery is our SSE machinery, so the adapter is
 * constructed with a publisher that routes replies to the connected client.
 */

import type { NormalizedReply } from "@agentflow/shared/types";
import { Redis } from "ioredis";

import type { ChannelAdapter, ChannelCredentials, InboundEvent, WebhookRequest } from "./types";

export interface WidgetPublisher {
  publish(conversationId: string, reply: NormalizedReply): Promise<void>;
}

/** Redis pub/sub channel prefix: worker publishes, API's SSE hub subscribes. */
export const WIDGET_OUTBOUND_PREFIX = "widget:outbound:";

/**
 * Worker-side widget delivery: publish the reply to Redis; the API's SSE hub
 * (apps/api/src/widget-hub.ts) forwards it to the connected widget client.
 */
export function createRedisWidgetPublisher(redisUrl: string): WidgetPublisher {
  const client = new Redis(redisUrl);
  return {
    async publish(conversationId, reply) {
      await client.publish(`${WIDGET_OUTBOUND_PREFIX}${conversationId}`, JSON.stringify(reply));
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createWidgetAdapter(publisher: WidgetPublisher): ChannelAdapter {
  return {
    channel: "widget",
    verifyWebhook(_credentials: ChannelCredentials, _request: WebhookRequest): void {
      // No transport signature — the API route authenticates the embed token
      // and Zod-validates the payload before this is ever called.
    },
    normalizeInbound(payload: unknown): InboundEvent | null {
      if (!isRecord(payload)) {
        return null;
      }
      const conversationId = payload.conversationId;
      const messageId = payload.messageId;
      const text = payload.text;
      if (
        typeof conversationId !== "string" ||
        conversationId.length === 0 ||
        typeof messageId !== "string" ||
        messageId.length === 0 ||
        typeof text !== "string"
      ) {
        return null;
      }
      const senderId = typeof payload.senderId === "string" ? payload.senderId : "widget-visitor";
      return {
        externalThreadId: conversationId,
        externalMessageId: messageId,
        sender: { id: senderId },
        text,
        attachments: [],
      };
    },
    async sendOutbound(_credentials, reply: NormalizedReply) {
      await publisher.publish(reply.externalThreadId, reply);
      return { providerMessageId: reply.id };
    },
  };
}
