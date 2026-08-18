/**
 * Conversation + message persistence for the channel worker (invariants
 * §4.3, §4.4). The unique indexes do the real at-least-once work: inbound
 * dedupe on (channel, external_message_id), outbound on idempotency_key.
 * Callers treat unique-violation errors as "already handled" no-ops.
 */

import type { Channel } from "@agentflow/shared/types";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../schema";

export async function upsertConversation(
  db: PostgresJsDatabase<typeof schema>,
  values: {
    workspaceId: string;
    channel: Channel;
    externalThreadId: string;
    externalCustomerId?: string;
    customerName?: string;
  },
) {
  const rows = await db
    .insert(schema.conversations)
    .values({
      workspaceId: values.workspaceId,
      channel: values.channel,
      externalThreadId: values.externalThreadId,
      externalCustomerId: values.externalCustomerId,
      customerName: values.customerName,
      lastMessageAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.conversations.channel, schema.conversations.externalThreadId],
      set: {
        lastMessageAt: new Date(),
        ...(values.externalCustomerId !== undefined
          ? { externalCustomerId: values.externalCustomerId }
          : {}),
        ...(values.customerName !== undefined ? { customerName: values.customerName } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("upserting a conversation returned no row");
  }
  return row;
}

export async function getConversation(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: Channel,
  externalThreadId: string,
) {
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.workspaceId, workspaceId),
        eq(schema.conversations.channel, channel),
        eq(schema.conversations.externalThreadId, externalThreadId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Insert an inbound message. Throws on duplicate (channel, external_message_id)
 * — the at-least-once backstop for retried webhook deliveries.
 */
export async function insertInboundMessage(
  db: PostgresJsDatabase<typeof schema>,
  values: {
    workspaceId: string;
    conversationId: string;
    channel: Channel;
    externalMessageId: string;
    sender: { id: string; name?: string } | undefined;
    text: string;
  },
) {
  const rows = await db
    .insert(schema.messages)
    .values({
      workspaceId: values.workspaceId,
      conversationId: values.conversationId,
      channel: values.channel,
      direction: "inbound",
      externalMessageId: values.externalMessageId,
      sender: values.sender ?? null,
      text: values.text,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("inserting an inbound message returned no row");
  }
  return row;
}

/**
 * Cheap webhook-path dedupe (invariant §4.2): an indexed point lookup before
 * enqueue. The unique index on (channel, external_message_id) is still the
 * authoritative backstop in the worker.
 */
export async function hasInboundMessage(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: Channel,
  externalMessageId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.workspaceId, workspaceId),
        eq(schema.messages.channel, channel),
        eq(schema.messages.externalMessageId, externalMessageId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Insert an outbound message with its idempotency key (at-least-once guard). */
export async function insertOutboundMessage(
  db: PostgresJsDatabase<typeof schema>,
  values: {
    workspaceId: string;
    conversationId: string;
    channel: Channel;
    idempotencyKey: string;
    text: string;
  },
) {
  const rows = await db
    .insert(schema.messages)
    .values({
      workspaceId: values.workspaceId,
      conversationId: values.conversationId,
      channel: values.channel,
      direction: "outbound",
      idempotencyKey: values.idempotencyKey,
      text: values.text,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("inserting an outbound message returned no row");
  }
  return row;
}

/** Route a conversation to the human inbox (window closed, §4.4). */
export async function routeToHumanInbox(
  db: PostgresJsDatabase<typeof schema>,
  conversationId: string,
): Promise<void> {
  await db
    .update(schema.conversations)
    .set({ status: "human_inbox", updatedAt: new Date() })
    .where(eq(schema.conversations.id, conversationId));
}
