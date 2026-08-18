/**
 * The inbound queue (AGENTS.md §2) — webhooks enqueue a NormalizedMessage and
 * answer 200 <100ms; the worker (apps/worker) consumes. BullMQ on Redis;
 * tests inject a fake.
 */

import type { NormalizedMessage } from "@agentflow/shared/types";
import { Queue } from "bullmq";

export interface InboundQueue {
  enqueue(message: NormalizedMessage): Promise<void>;
  close(): Promise<void>;
}

export function createInboundQueue(redisUrl: string): InboundQueue {
  const queue = new Queue<NormalizedMessage>("inbound", {
    connection: { url: redisUrl },
    defaultJobOptions: {
      // At-least-once: retry with backoff; the DB unique indexes make a
      // re-delivered job a no-op, never a double-send (invariant §4.3).
      attempts: 8,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
  return {
    async enqueue(message) {
      await queue.add("message", message);
    },
    async close() {
      await queue.close();
    },
  };
}

/** In-memory queue for tests and for API processes without Redis. */
export function createMemoryQueue(): InboundQueue & { messages: NormalizedMessage[] } {
  const messages: NormalizedMessage[] = [];
  return {
    messages,
    async enqueue(message) {
      messages.push(message);
    },
    async close() {
      messages.length = 0;
    },
  };
}
