/**
 * Integration tests — run ONLY against a throwaway database.
 *
 * These TRUNCATE every table, so they must never be pointed at a real
 * database. In CI, DATABASE_URL points at the ephemeral postgres service.
 * Without DATABASE_URL the whole suite is skipped.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { uuidv7 } from "@agentflow/shared/uuid";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbClient } from "../client";
import {
  createDraft,
  getLatestPublished,
  listFlows,
  listRunsForFlow,
  publishFlow,
  saveDraft,
} from "../repo/flows";
import { deleteSource, searchChunks, upsertChunks } from "../repo/knowledge";
import { createRun, finishRun } from "../repo/runs";
import { conversations, flows, knowledgeChunks, messages, runs, workspaces } from "../schema";
import { BUILTIN_WORKSPACE_ID, ensureBuiltinWorkspace } from "../seed";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const migrationsFolder = resolve(fileURLToPath(new URL("../../", import.meta.url)), "migrations");

let dbClient: ReturnType<typeof createDbClient>;

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("expected a row, got none");
  }
  return row;
}

describeDb("database (integration)", () => {
  beforeAll(async () => {
    const url = DATABASE_URL;
    if (url === undefined) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    dbClient = createDbClient(url);
    await migrate(dbClient.db, { migrationsFolder });
    // Clean slate — this must be a throwaway database (see file header).
    await dbClient.db.execute(
      sql`TRUNCATE TABLE runs, messages, conversations, flows, credentials, knowledge_chunks, channel_status, workspaces`,
    );
    await ensureBuiltinWorkspace(dbClient.db);
  });

  afterAll(async () => {
    await dbClient?.client.end();
  });

  it("applies migrations and seeds the built-in workspace", async () => {
    const rows = await dbClient.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, BUILTIN_WORKSPACE_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Default workspace");
  });

  it("enforces the conversation identity key (channel, external_thread_id)", async () => {
    const thread = `thread-${uuidv7()}`;
    await dbClient.db.insert(conversations).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      channel: "whatsapp",
      externalThreadId: thread,
    });
    // Same thread on the same channel → unique violation (duplicate webhook).
    await expect(
      dbClient.db.insert(conversations).values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        channel: "whatsapp",
        externalThreadId: thread,
      }),
    ).rejects.toThrow();
    // Same thread on a different channel is a different conversation.
    await expect(
      dbClient.db.insert(conversations).values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        channel: "messenger",
        externalThreadId: thread,
      }),
    ).resolves.toBeDefined();
  });

  it("dedupes inbound messages on (channel, external_message_id)", async () => {
    const conversation = firstRow(
      await dbClient.db
        .insert(conversations)
        .values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          channel: "tiktok",
          externalThreadId: `thread-${uuidv7()}`,
        })
        .returning(),
    );
    const externalMessageId = `mid-${uuidv7()}`;
    await dbClient.db.insert(messages).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      conversationId: conversation.id,
      channel: "tiktok",
      direction: "inbound",
      externalMessageId,
      text: "hello",
    });
    // A retried webhook delivery with the same id must be a no-op rejection.
    await expect(
      dbClient.db.insert(messages).values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        conversationId: conversation.id,
        channel: "tiktok",
        direction: "inbound",
        externalMessageId,
        text: "hello (again)",
      }),
    ).rejects.toThrow();
  });

  it("guards outbound sends with a unique idempotency key (at-least-once)", async () => {
    const conversation = firstRow(
      await dbClient.db
        .insert(conversations)
        .values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          channel: "widget",
          externalThreadId: `thread-${uuidv7()}`,
        })
        .returning(),
    );
    const key = `reply:${conversation.id}:run-1:step-2`;
    await dbClient.db.insert(messages).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      conversationId: conversation.id,
      channel: "widget",
      direction: "outbound",
      idempotencyKey: key,
      text: "your order is on its way",
    });
    // A retried outbound job must not double-send.
    await expect(
      dbClient.db.insert(messages).values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        conversationId: conversation.id,
        channel: "widget",
        direction: "outbound",
        idempotencyKey: key,
        text: "your order is on its way",
      }),
    ).rejects.toThrow();
    // Multiple sends without a key are allowed (no key → no guard).
    await expect(
      dbClient.db.insert(messages).values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        conversationId: conversation.id,
        channel: "widget",
        direction: "outbound",
        text: "unkeyed",
      }),
    ).resolves.toBeDefined();
  });

  it("keeps exactly one draft per flow and immutable published snapshots", async () => {
    const flowId = uuidv7();
    const base = {
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowId,
      name: "Support agent",
      flowJson: { nodes: [], edges: [] },
    };
    await dbClient.db.insert(flows).values({ ...base, status: "draft", version: 1 });
    // Publish: a new immutable snapshot row with the next version.
    const published = await dbClient.db
      .insert(flows)
      .values({ ...base, status: "published", version: 2 })
      .returning();
    const snapshot = firstRow(published);
    // A second draft for the same flow is rejected by the partial index.
    await expect(
      dbClient.db.insert(flows).values({ ...base, status: "draft", version: 3 }),
    ).rejects.toThrow();
    // The run references the published snapshot, so editing the draft later
    // never rewrites run history (invariant §4.9).
    const run = firstRow(
      await dbClient.db
        .insert(runs)
        .values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          flowSnapshotId: snapshot.id,
          channel: "widget",
          input: { text: "where is my order" },
          status: "running",
        })
        .returning(),
    );
    expect(run.flowSnapshotId).toBe(snapshot.id);
  });

  it("walks a flow through draft → save → publish → run", async () => {
    const draft = await createDraft(dbClient.db, BUILTIN_WORKSPACE_ID, "Support agent");
    expect(draft.status).toBe("draft");
    expect(draft.version).toBe(1);

    const flowJson = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger-manual", typeVersion: 1, params: {} },
        { id: "a1", type: "action-log", typeVersion: 1, params: { message: "hi" } },
      ],
      edges: [{ id: "e1", source: "t1", target: "a1" }],
    };
    const saved = await saveDraft(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId, {
      name: "Support agent v2",
      flowJson,
    });
    expect(saved.name).toBe("Support agent v2");
    expect(saved.flowJson).toEqual(flowJson);

    const snapshot = await publishFlow(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId);
    expect(snapshot.status).toBe("published");
    expect(snapshot.version).toBe(2);
    expect(snapshot.flowJson).toEqual(flowJson);

    const latest = await getLatestPublished(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId);
    expect(latest?.id).toBe(snapshot.id);

    // Publish again → next version, and the previous snapshot stays intact.
    await saveDraft(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId, {
      flowJson: { ...flowJson, version: 1 },
    });
    const second = await publishFlow(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId);
    expect(second.version).toBe(3);
    const latest2 = await getLatestPublished(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId);
    expect(latest2?.id).toBe(second.id);

    const summaries = await listFlows(dbClient.db, BUILTIN_WORKSPACE_ID);
    const summary = summaries.find((s) => s.flowId === draft.flowId);
    expect(summary?.name).toBe("Support agent v2");
    expect(summary?.draftVersion).toBe(1);
    expect(summary?.publishedVersion).toBe(3);
  });

  it("lists runs for a flow (latest snapshots only)", async () => {
    const draft = await createDraft(dbClient.db, BUILTIN_WORKSPACE_ID, "Runs flow");
    const snapshot = await publishFlow(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId);

    const runId = await createRun(dbClient.db, {
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowSnapshotId: snapshot.id,
      channel: "widget",
      input: { text: "test" },
    });
    await finishRun(dbClient.db, runId, {
      status: "succeeded",
      nodeOutputs: {},
      timings: {},
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishedAt: new Date(),
    });

    const runsForFlow = await listRunsForFlow(dbClient.db, BUILTIN_WORKSPACE_ID, draft.flowId);
    expect(runsForFlow).toHaveLength(1);
    expect(runsForFlow[0]?.id).toBe(runId);
    expect(runsForFlow[0]?.status).toBe("succeeded");
  });

  // The vector column is fixed at 1536 dims; only the leading dims are set
  // so the cosine geometry is easy to reason about.
  function vector(...leading: number[]): number[] {
    const v = new Array<number>(1536).fill(0);
    leading.forEach((value, index) => {
      v[index] = value;
    });
    return v;
  }

  it("stores knowledge chunks and retrieves the nearest by cosine distance", async () => {
    await upsertChunks(dbClient.db, [
      {
        workspaceId: BUILTIN_WORKSPACE_ID,
        sourceId: "refund-policy",
        title: "Refund policy",
        content: "Refunds are processed within 5 business days.",
        embedding: vector(1, 0, 0),
      },
      {
        workspaceId: BUILTIN_WORKSPACE_ID,
        sourceId: "refund-policy",
        title: "Refund policy",
        content: "Expedited refunds take 2 business days.",
        embedding: vector(0.9, 0.1, 0),
      },
      {
        workspaceId: BUILTIN_WORKSPACE_ID,
        sourceId: "hours",
        title: "Opening hours",
        content: "We are open 9am to 5pm.",
        embedding: vector(0, 0, 1),
      },
    ]);

    // Query about refunds → the two refund chunks rank above the hours chunk.
    const refunds = await searchChunks(dbClient.db, BUILTIN_WORKSPACE_ID, vector(1, 1, 0), 5);
    expect(refunds).toHaveLength(3);
    expect(refunds[0]?.distance).toBeLessThan(refunds[1]?.distance ?? 1);
    expect(refunds[0]?.content).toContain("2 business days");
    expect(refunds[1]?.content).toContain("5 business days");
    expect(refunds[2]?.sourceId).toBe("hours");

    // Query about hours → the hours chunk ranks first.
    const hours = await searchChunks(dbClient.db, BUILTIN_WORKSPACE_ID, vector(0, 0.1, 1), 3);
    expect(hours[0]?.sourceId).toBe("hours");
  });

  it("re-ingesting a source replaces its old chunks wholesale", async () => {
    await upsertChunks(dbClient.db, [
      {
        workspaceId: BUILTIN_WORKSPACE_ID,
        sourceId: "shipping",
        title: "Shipping",
        content: "Old policy: 10 days.",
        embedding: vector(0, 1, 0),
      },
    ]);
    await upsertChunks(dbClient.db, [
      {
        workspaceId: BUILTIN_WORKSPACE_ID,
        sourceId: "shipping",
        title: "Shipping",
        content: "New policy: 3 days.",
        embedding: vector(0, 1, 0),
      },
    ]);
    const rows = await dbClient.db
      .select()
      .from(knowledgeChunks)
      .where(sql`${knowledgeChunks.sourceId} = 'shipping'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toContain("3 days");

    await deleteSource(dbClient.db, BUILTIN_WORKSPACE_ID, "shipping");
    const after = await dbClient.db
      .select()
      .from(knowledgeChunks)
      .where(sql`${knowledgeChunks.sourceId} = 'shipping'`);
    expect(after).toHaveLength(0);
  });

  it("persists full run detail (input, outputs, timings, tokens, error, retention)", async () => {
    const flowId = uuidv7();
    const snapshot = firstRow(
      await dbClient.db
        .insert(flows)
        .values({
          workspaceId: BUILTIN_WORKSPACE_ID,
          flowId,
          name: "Support agent",
          status: "published",
          version: 1,
          flowJson: { nodes: [{ id: "n1", type: "agent" }], edges: [] },
        })
        .returning(),
    );
    const input = { text: "refund please", channel: "whatsapp" };
    const nodeOutputs = { n1: { content: "I'll escalate this" } };
    const timings = { n1: { startedAt: 1, finishedAt: 12 } };
    const tokenUsage = { n1: { promptTokens: 100, completionTokens: 20 } };
    const error = { code: "PROVIDER", message: "upstream down" };
    const expiresAt = new Date(Date.now() + 86_400_000);

    await dbClient.db.insert(runs).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowSnapshotId: snapshot.id,
      channel: "whatsapp",
      input,
      nodeOutputs,
      timings,
      tokenUsage,
      status: "failed",
      error,
      expiresAt,
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    const rows = await dbClient.db.select().from(runs).where(eq(runs.flowSnapshotId, snapshot.id));
    const run = firstRow(rows);
    expect(run.status).toBe("failed");
    expect(run.input).toEqual(input);
    expect(run.nodeOutputs).toEqual(nodeOutputs);
    expect(run.timings).toEqual(timings);
    expect(run.tokenUsage).toEqual(tokenUsage);
    expect(run.error).toEqual(error);
    expect(run.expiresAt).not.toBeNull();
  });
});
