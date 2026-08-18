/**
 * Run persistence (invariant §4.9) — every flow run stores its input,
 * per-node output, timings, token usage, and errors. The worker creates a
 * pending run, executes the published snapshot, then finalizes it.
 */

import type { Channel } from "@agentflow/shared/types";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../schema";

export interface CreateRunInput {
  workspaceId: string;
  flowSnapshotId: string;
  conversationId?: string;
  channel: Channel;
  input: Record<string, unknown>;
  expiresAt?: Date;
}

export interface RunErrorRecord {
  code: string;
  message: string;
  nodeId?: string;
}

export interface FinishRunPatch {
  status: (typeof schema.runs.$inferInsert)["status"];
  /** jsonb columns — any serializable JSON is valid. */
  nodeOutputs: unknown;
  timings: unknown;
  tokenUsage: unknown;
  error?: RunErrorRecord | null;
  /** Outbound routing decision + provider result (worker, Phase 5). */
  outbound?: unknown;
  startedAt?: Date;
  finishedAt: Date;
}

export async function createRun(
  db: PostgresJsDatabase<typeof schema>,
  values: CreateRunInput,
): Promise<string> {
  const rows = await db
    .insert(schema.runs)
    .values({ ...values, status: "pending" })
    .returning({ id: schema.runs.id });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("inserting a run returned no row");
  }
  return row.id;
}

export async function finishRun(
  db: PostgresJsDatabase<typeof schema>,
  runId: string,
  patch: FinishRunPatch,
): Promise<void> {
  await db
    .update(schema.runs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.runs.id, runId));
}

export async function getRun(db: PostgresJsDatabase<typeof schema>, runId: string) {
  const rows = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  return rows[0];
}
