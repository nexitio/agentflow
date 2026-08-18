/**
 * Worker e2e (invariants §4.3, §4.4, §4.9): a NormalizedMessage flows through
 * conversation upsert → dedupe-insert → flow-by-channel lookup → engine run →
 * window-checked outbound with an idempotency key, and the run record carries
 * the routing decision. Runs ONLY against a throwaway database.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelAdapter } from "@agentflow/channels/types";
import { createDbClient } from "@agentflow/db/client";
import { flows, messages, runs } from "@agentflow/db/schema";
import { BUILTIN_WORKSPACE_ID, ensureBuiltinWorkspace } from "@agentflow/db/seed";
import { uuidv7 } from "@agentflow/shared/uuid";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInboundHandler } from "./handle-inbound";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const migrationsFolder = resolve(
  fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
);

let dbClient: ReturnType<typeof createDbClient>;

const sentReplies: Array<{ channel: string; text: string; idempotencyKey: string }> = [];

const fakeAdapter: ChannelAdapter = {
  channel: "whatsapp",
  verifyWebhook: () => undefined,
  normalizeInbound: () => null,
  async sendOutbound(_credentials, reply) {
    sentReplies.push({
      channel: reply.channel,
      text: reply.text,
      idempotencyKey: reply.idempotencyKey,
    });
    return { providerMessageId: `provider-${sentReplies.length}` };
  },
};

function channelFlowJson() {
  return {
    version: 1,
    nodes: [
      {
        id: "t1",
        type: "trigger-channel",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        params: { channel: "whatsapp", label: "WhatsApp" },
      },
      {
        id: "sr1",
        type: "action-send-reply",
        typeVersion: 1,
        position: { x: 220, y: 0 },
        params: { label: "Send reply" },
      },
    ],
    edges: [{ id: "e1", source: "t1", target: "sr1" }],
  };
}

async function seedPublishedFlow() {
  const rows = await dbClient.db
    .insert(flows)
    .values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowId: uuidv7(),
      name: "WhatsApp support",
      status: "published",
      version: 1,
      flowJson: channelFlowJson(),
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("expected a flow row");
  }
  return row;
}

function whatsappMessage(text: string, externalMessageId: string) {
  return {
    id: uuidv7(),
    workspaceId: BUILTIN_WORKSPACE_ID,
    channel: "whatsapp" as const,
    externalThreadId: "15551112222",
    externalMessageId,
    sender: { id: "15551112222", name: "Alex Customer" },
    text,
    attachments: [],
    receivedAt: new Date().toISOString(),
  };
}

describeDb("worker inbound (integration)", () => {
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

  it("runs the channel flow and sends a window-checked reply with an idempotency key", async () => {
    const snapshot = await seedPublishedFlow();
    const handleInbound = createInboundHandler({
      db: dbClient.db,
      adapters: { whatsapp: fakeAdapter },
    });

    const inbound = whatsappMessage("where is my order?", "wamid.e2e-1");
    await handleInbound(inbound);

    // Outbound sent once with the reply text and a run-scoped idempotency key.
    expect(sentReplies).toHaveLength(1);
    expect(sentReplies[0]).toMatchObject({
      channel: "whatsapp",
      text: "where is my order?",
    });
    expect(sentReplies[0]?.idempotencyKey).toMatch(/^run:[0-9a-f-]+:reply$/);

    // The outbound message row carries the idempotency key (at-least-once).
    const outboundRows = await dbClient.db
      .select()
      .from(messages)
      .where(sql`${messages.direction} = 'outbound'`);
    expect(outboundRows).toHaveLength(1);
    expect(outboundRows[0]?.idempotencyKey).toBe(sentReplies[0]?.idempotencyKey);

    // The run record carries the routing decision.
    const runRows = await dbClient.db.select().from(runs);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.status).toBe("succeeded");
    expect(runRows[0]?.flowSnapshotId).toBe(snapshot.id);
    expect(runRows[0]?.outbound).toMatchObject({ decision: "sent" });
  });

  it("treats a retried delivery as a no-op (no double send)", async () => {
    const handleInbound = createInboundHandler({
      db: dbClient.db,
      adapters: { whatsapp: fakeAdapter },
    });
    const inbound = whatsappMessage("hello again", "wamid.e2e-duplicate");
    await handleInbound(inbound);
    await handleInbound(inbound); // retried job

    const outboundRows = await dbClient.db
      .select()
      .from(messages)
      .where(sql`${messages.direction} = 'outbound' and ${messages.text} = 'hello again'`);
    // Only the first delivery produced a send.
    expect(outboundRows).toHaveLength(1);
    expect(sentReplies).toHaveLength(2);
  });

  it("does nothing when no published flow is wired to the channel", async () => {
    const handleInbound = createInboundHandler({
      db: dbClient.db,
      adapters: { whatsapp: fakeAdapter },
    });
    const inbound = whatsappMessage("no flow for this", "wamid.e2e-nothing");
    await handleInbound({
      ...inbound,
      channel: "tiktok",
      externalThreadId: "tt_open_1",
    });
    const runRows = await dbClient.db.select().from(runs);
    // No run was created (the run above + none for this message).
    expect(runRows).toHaveLength(2);
  });
});
