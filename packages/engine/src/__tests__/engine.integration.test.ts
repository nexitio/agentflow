/**
 * Engine → database e2e (invariant §4.9): create a published snapshot, run
 * the engine against it with a real Postgres, persist the run, read it back.
 *
 * Lives in the engine package (not packages/db) so the dependency graph stays
 * acyclic: engine depends on db, never the reverse. Runs ONLY against a
 * throwaway database — it TRUNCATEs every table, so DATABASE_URL must never
 * point at real data. Without DATABASE_URL the suite is skipped.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient } from "@agentflow/db/client";
import { createRun, finishRun, getRun } from "@agentflow/db/repo/runs";
import { flows } from "@agentflow/db/schema";
import { BUILTIN_WORKSPACE_ID, ensureBuiltinWorkspace } from "@agentflow/db/seed";
import { executeFlow } from "@agentflow/engine";
import { uuidv7 } from "@agentflow/shared/uuid";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const migrationsFolder = resolve(fileURLToPath(new URL("../../../db/migrations", import.meta.url)));

let dbClient: ReturnType<typeof createDbClient>;

describeDb("engine ↔ database (integration)", () => {
  beforeAll(async () => {
    const url = DATABASE_URL;
    if (url === undefined) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    dbClient = createDbClient(url);
    await migrate(dbClient.db, { migrationsFolder });
    await dbClient.db.execute(
      sql`TRUNCATE TABLE runs, messages, conversations, flows, credentials, knowledge_chunks, channel_status, workspaces`,
    );
    await ensureBuiltinWorkspace(dbClient.db);
  });

  afterAll(async () => {
    await dbClient?.client.end();
  });

  it("persists an engine run end-to-end (create → execute → finish → read back)", async () => {
    const snapshot = (
      await dbClient.db
        .insert(flows)
        .values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          flowId: uuidv7(),
          name: "Support agent",
          status: "published",
          version: 1,
          flowJson: {
            version: 1,
            nodes: [
              { id: "t1", type: "trigger-manual", typeVersion: 1, params: {} },
              { id: "a1", type: "action-log", typeVersion: 1, params: { message: "logged" } },
            ],
            edges: [{ id: "e1", source: "t1", target: "a1" }],
          },
        })
        .returning()
    )[0];
    if (snapshot === undefined) {
      throw new Error("expected a flow row");
    }

    const input = { text: "where is my order?" };
    const runId = await createRun(dbClient.db, {
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowSnapshotId: snapshot.id,
      channel: "widget",
      input,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    });

    const result = await executeFlow({
      flow: snapshot.flowJson,
      input,
      workspaceId: BUILTIN_WORKSPACE_ID,
      channel: "widget",
      db: dbClient.db,
      runId,
    });

    await finishRun(dbClient.db, runId, {
      status: result.status,
      nodeOutputs: result.nodeOutputs,
      timings: result.timings,
      tokenUsage: result.tokenUsage,
      ...(result.error !== undefined ? { error: result.error } : {}),
      finishedAt: new Date(result.finishedAt),
    });

    const run = await getRun(dbClient.db, runId);
    expect(run?.status).toBe("succeeded");
    expect(run?.flowSnapshotId).toBe(snapshot.id);
    expect(run?.input).toEqual(input);
    expect(run?.nodeOutputs).toMatchObject({ a1: { status: "success" } });
    expect(run?.expiresAt).not.toBeNull();
    expect(run?.id).toBe(runId);
  });

  it("records a failing engine run with its error", async () => {
    const snapshot = (
      await dbClient.db
        .insert(flows)
        .values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          flowId: uuidv7(),
          name: "Broken flow",
          status: "published",
          version: 1,
          flowJson: {
            version: 1,
            nodes: [
              { id: "t1", type: "trigger-manual", typeVersion: 1, params: {} },
              { id: "x1", type: "no-such-node", typeVersion: 1, params: {} },
            ],
            edges: [{ id: "e1", source: "t1", target: "x1" }],
          },
        })
        .returning()
    )[0];
    if (snapshot === undefined) {
      throw new Error("expected a flow row");
    }

    const runId = await createRun(dbClient.db, {
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowSnapshotId: snapshot.id,
      channel: "widget",
      input: { text: "hi" },
    });

    const result = await executeFlow({
      flow: snapshot.flowJson,
      input: { text: "hi" },
      workspaceId: BUILTIN_WORKSPACE_ID,
      channel: "widget",
      db: dbClient.db,
      runId,
    });

    await finishRun(dbClient.db, runId, {
      status: result.status,
      nodeOutputs: result.nodeOutputs,
      timings: result.timings,
      tokenUsage: result.tokenUsage,
      ...(result.error !== undefined ? { error: result.error } : {}),
      finishedAt: new Date(result.finishedAt),
    });

    expect(result.status).toBe("failed");
    const run = await getRun(dbClient.db, runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatchObject({ code: "CONFIGURATION" });
    expect(run?.tokenUsage).toMatchObject({ totalTokens: 0 });
  });
});
