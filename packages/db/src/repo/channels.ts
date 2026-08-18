/**
 * Channel webhook status (AGENTS.md §7) — what the setup screen shows:
 * webhook URL, verification state, last event, and plain-English errors.
 */

import type { Channel } from "@agentflow/shared/types";
import { CHANNELS } from "@agentflow/shared/types";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../schema";

export interface ChannelStatusPatch {
  verified?: boolean;
  lastError?: string | null;
}

export interface ChannelStatusView {
  channel: Channel;
  webhookUrl: string | null;
  verifiedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

/** Upsert one channel's status row (verified handshake or webhook event). */
export async function recordChannelStatus(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: Channel,
  patch: ChannelStatusPatch,
): Promise<void> {
  await db
    .insert(schema.channelStatus)
    .values({
      workspaceId,
      channel,
      ...(patch.verified === true ? { verifiedAt: new Date() } : {}),
      lastEventAt: new Date(),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
    })
    .onConflictDoUpdate({
      target: [schema.channelStatus.workspaceId, schema.channelStatus.channel],
      set: {
        ...(patch.verified === true ? { verifiedAt: new Date() } : {}),
        lastEventAt: new Date(),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        updatedAt: new Date(),
      },
    });
}

/** All channels with their status — missing rows show as never-verified. */
export async function listChannelStatus(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<ChannelStatusView[]> {
  const rows = await db
    .select()
    .from(schema.channelStatus)
    .where(eq(schema.channelStatus.workspaceId, workspaceId));
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  return CHANNELS.map((channel) => {
    const row = byChannel.get(channel);
    return {
      channel,
      webhookUrl: row?.webhookUrl ?? null,
      verifiedAt: row?.verifiedAt?.toISOString() ?? null,
      lastEventAt: row?.lastEventAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  });
}

/** Remember the webhook URL the setup screen told the operator to paste. */
export async function setChannelWebhookUrl(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: Channel,
  webhookUrl: string,
): Promise<void> {
  await db
    .insert(schema.channelStatus)
    .values({ workspaceId, channel, webhookUrl })
    .onConflictDoUpdate({
      target: [schema.channelStatus.workspaceId, schema.channelStatus.channel],
      set: { webhookUrl, updatedAt: new Date() },
    });
}

export async function getChannelStatus(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: Channel,
) {
  const rows = await db
    .select()
    .from(schema.channelStatus)
    .where(
      and(
        eq(schema.channelStatus.workspaceId, workspaceId),
        eq(schema.channelStatus.channel, channel),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Clear a resolved error (e.g. a later webhook arrived successfully). */
export async function clearChannelError(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: Channel,
): Promise<void> {
  await db
    .update(schema.channelStatus)
    .set({ lastError: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.channelStatus.workspaceId, workspaceId),
        eq(schema.channelStatus.channel, channel),
      ),
    );
}
