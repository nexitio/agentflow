/**
 * Flows repository — the canvas's data access (AGENTS.md §6).
 *
 * A flow is an editable `draft` row plus immutable `published` snapshots.
 * Publish copies the draft into a new published row with the next version;
 * runs reference the snapshot id, so editing never rewrites run history.
 */

import { NotFoundError } from "@agentflow/shared/errors";
import { uuidv7 } from "@agentflow/shared/uuid";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../schema";

export const EMPTY_FLOW_JSON = { version: 1, nodes: [], edges: [] };

export interface FlowSummary {
  flowId: string;
  name: string;
  draftVersion: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
  runCount: number;
}

function summarize(
  draft: typeof schema.flows.$inferSelect | undefined,
  published: typeof schema.flows.$inferSelect | undefined,
  runCount: number,
): FlowSummary {
  const source = draft ?? published;
  return {
    flowId: source?.flowId ?? "",
    name: source?.name ?? "Untitled flow",
    draftVersion: draft?.version ?? null,
    publishedVersion: published?.version ?? null,
    publishedAt: published?.createdAt.toISOString() ?? null,
    updatedAt: (source?.updatedAt ?? published?.createdAt ?? new Date(0)).toISOString(),
    runCount,
  };
}

export async function listFlows(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<FlowSummary[]> {
  const rows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, workspaceId))
    .orderBy(desc(schema.flows.updatedAt));

  const runCounts = await db
    .select({
      flowId: schema.flows.flowId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.runs)
    .innerJoin(schema.flows, eq(schema.runs.flowSnapshotId, schema.flows.id))
    .where(eq(schema.flows.workspaceId, workspaceId))
    .groupBy(schema.flows.flowId);

  const counts = new Map(runCounts.map((row) => [row.flowId, row.count]));

  // Merge drafts + latest published per logical flow.
  const drafts = new Map<string, typeof schema.flows.$inferSelect>();
  const latestPublished = new Map<string, typeof schema.flows.$inferSelect>();
  for (const row of rows) {
    if (row.status === "draft") {
      drafts.set(row.flowId, row);
    } else if (
      row.status === "published" &&
      (latestPublished.get(row.flowId) === undefined ||
        row.version > (latestPublished.get(row.flowId)?.version ?? 0))
    ) {
      latestPublished.set(row.flowId, row);
    }
  }

  const flowIds = new Set([...drafts.keys(), ...latestPublished.keys()]);
  const summaries = [...flowIds].map((flowId) =>
    summarize(drafts.get(flowId), latestPublished.get(flowId), counts.get(flowId) ?? 0),
  );
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function getDraft(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  flowId: string,
) {
  const rows = await db
    .select()
    .from(schema.flows)
    .where(
      and(
        eq(schema.flows.workspaceId, workspaceId),
        eq(schema.flows.flowId, flowId),
        eq(schema.flows.status, "draft"),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createDraft(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  name: string,
) {
  const rows = await db
    .insert(schema.flows)
    .values({
      flowId: uuidv7(),
      workspaceId,
      name,
      status: "draft",
      version: 1,
      flowJson: EMPTY_FLOW_JSON,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("inserting a flow draft returned no row");
  }
  return row;
}

export async function saveDraft(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  flowId: string,
  patch: { name?: string; flowJson?: unknown },
) {
  const rows = await db
    .update(schema.flows)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.flows.workspaceId, workspaceId),
        eq(schema.flows.flowId, flowId),
        eq(schema.flows.status, "draft"),
      ),
    )
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new NotFoundError("Flow draft not found.");
  }
  return row;
}

/** Copy the draft into an immutable published snapshot with the next version. */
export async function publishFlow(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  flowId: string,
) {
  const draft = await getDraft(db, workspaceId, flowId);
  if (draft === undefined) {
    throw new NotFoundError("Flow draft not found — nothing to publish.");
  }
  const versionRows = await db
    .select({ maxVersion: sql<number>`max(version)::int` })
    .from(schema.flows)
    .where(eq(schema.flows.flowId, flowId));
  const nextVersion = (versionRows[0]?.maxVersion ?? 0) + 1;

  const rows = await db
    .insert(schema.flows)
    .values({
      flowId,
      workspaceId,
      name: draft.name,
      description: draft.description,
      status: "published",
      version: nextVersion,
      flowJson: draft.flowJson,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("inserting a published snapshot returned no row");
  }
  return row;
}

export async function getLatestPublished(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  flowId: string,
) {
  const rows = await db
    .select()
    .from(schema.flows)
    .where(
      and(
        eq(schema.flows.workspaceId, workspaceId),
        eq(schema.flows.flowId, flowId),
        eq(schema.flows.status, "published"),
      ),
    )
    .orderBy(desc(schema.flows.version))
    .limit(1);
  return rows[0];
}

/**
 * The newest published snapshot whose trigger is a `trigger-channel` wired to
 * the given channel — how the worker routes a webhook to the right flow.
 * The workflow JSON is a public contract, so matching on its shape with a
 * jsonb containment query is safe (no need to import the node registry here).
 */
export async function getLatestPublishedByChannel(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  channel: string,
) {
  const triggerShape = JSON.stringify([{ type: "trigger-channel", params: { channel } }]);
  const rows = await db
    .select()
    .from(schema.flows)
    .where(
      and(
        eq(schema.flows.workspaceId, workspaceId),
        eq(schema.flows.status, "published"),
        sql`${schema.flows.flowJson}->'nodes' @> ${sql.raw(`'${triggerShape}'`)}\:\:jsonb`,
      ),
    )
    .orderBy(desc(schema.flows.version))
    .limit(1);
  return rows[0];
}

export async function listRunsForFlow(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  flowId: string,
  limit = 20,
) {
  return db
    .select({
      id: schema.runs.id,
      status: schema.runs.status,
      input: schema.runs.input,
      nodeOutputs: schema.runs.nodeOutputs,
      timings: schema.runs.timings,
      tokenUsage: schema.runs.tokenUsage,
      error: schema.runs.error,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .innerJoin(schema.flows, eq(schema.runs.flowSnapshotId, schema.flows.id))
    .where(and(eq(schema.flows.workspaceId, workspaceId), eq(schema.flows.flowId, flowId)))
    .orderBy(desc(schema.runs.createdAt))
    .limit(limit);
}
