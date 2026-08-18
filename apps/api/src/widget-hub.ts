/**
 * Widget outbound delivery (docs/knowledge/10-tiktok-widget-channels.md).
 *
 * The worker produces replies (published via the channels package's
 * createRedisWidgetPublisher); the API holds the SSE streams. Redis pub/sub
 * fans out so any API instance reaches any connected widget client:
 * worker publishes `widget:outbound:<conversationId>`, the API's subscriber
 * forwards it to the matching SSE connection.
 */

import { WIDGET_OUTBOUND_PREFIX } from "@agentflow/channels/widget";
import type { NormalizedReply } from "@agentflow/shared/types";
import { Redis } from "ioredis";

export interface WidgetStreamHub {
  /** Subscribe to outbound replies for one conversation; returns unsubscribe. */
  subscribe(conversationId: string, onReply: (reply: NormalizedReply) => void): () => void;
}

function channelFor(conversationId: string): string {
  return `${WIDGET_OUTBOUND_PREFIX}${conversationId}`;
}

export function createRedisWidgetHub(redisUrl: string): WidgetStreamHub {
  const subscriber = new Redis(redisUrl);
  const listeners = new Map<string, Set<(reply: NormalizedReply) => void>>();

  subscriber.on("message", (channel, message) => {
    if (!channel.startsWith(WIDGET_OUTBOUND_PREFIX)) {
      return;
    }
    const conversationId = channel.slice(WIDGET_OUTBOUND_PREFIX.length);
    let reply: NormalizedReply;
    try {
      reply = JSON.parse(message) as NormalizedReply;
    } catch {
      return; // malformed publish — never crash the subscriber
    }
    for (const listener of listeners.get(conversationId) ?? []) {
      listener(reply);
    }
  });

  return {
    subscribe(conversationId, onReply) {
      const set = listeners.get(conversationId) ?? new Set();
      set.add(onReply);
      listeners.set(conversationId, set);
      void subscriber.subscribe(channelFor(conversationId));
      return () => {
        set.delete(onReply);
        if (set.size === 0) {
          listeners.delete(conversationId);
          void subscriber.unsubscribe(channelFor(conversationId));
        }
      };
    },
  };
}
