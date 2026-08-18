/**
 * Webhook ingress integration tests (invariants §4.2, §4.3, §4.7): signature
 * verification over the raw body, dedupe (a duplicate delivery is a no-op),
 * enqueue-then-200, and the widget token boundary. Runs ONLY against a
 * throwaway database; skipped without DATABASE_URL.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChannelCredentials } from "@agentflow/channels/types";
import { createDbClient } from "@agentflow/db/client";
import { conversations, messages } from "@agentflow/db/schema";
import { BUILTIN_WORKSPACE_ID, ensureBuiltinWorkspace } from "@agentflow/db/seed";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { createMemoryQueue } from "./queue";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const migrationsFolder = resolve(
  fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
);

const APP_SECRET = "test-meta-secret";
const TIKTOK_SECRET = "test-tiktok-secret";
const WIDGET_TOKEN = "test-widget-token";
const META_VERIFY_TOKEN = "test-verify-token";

const CREDENTIALS: ChannelCredentials = {
  appSecret: APP_SECRET,
  accessToken: "page-token",
  phoneNumberId: "333333333333333",
  clientSecret: TIKTOK_SECRET,
  widgetToken: WIDGET_TOKEN,
};

let dbClient: ReturnType<typeof createDbClient>;
let queue: ReturnType<typeof createMemoryQueue>;
let app: ReturnType<typeof createApp>;

function metaSign(rawBody: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
}

function tiktokSign(rawBody: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", TIKTOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},s=${signature}`;
}

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../packages/channels/fixtures/${name}.json`, import.meta.url)),
    "utf8",
  );
}

describeDb("webhooks (integration)", () => {
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
    queue = createMemoryQueue();
    app = createApp({
      db: dbClient.db,
      queue,
      channelCredentials: CREDENTIALS,
      widgetToken: WIDGET_TOKEN,
      metaVerifyToken: META_VERIFY_TOKEN,
      publicBaseUrl: "https://support.example.test",
    });
  });

  afterAll(async () => {
    await dbClient?.client.end();
  });

  it("answers the Meta verification handshake with the challenge", async () => {
    const res = await app.request(
      `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${META_VERIFY_TOKEN}&hub.challenge=CHALLENGE_42`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CHALLENGE_42");
  });

  it("rejects the Meta handshake with a wrong verify token", async () => {
    const res = await app.request(
      "/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE_42",
    );
    expect(res.status).toBe(403);
  });

  it("enqueues a signed Messenger message and answers 200 fast", async () => {
    const raw = fixture("meta-messenger");
    const res = await app.request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(queue.messages).toHaveLength(1);
    const message = queue.messages[0];
    expect(message?.channel).toBe("messenger");
    expect(message?.externalMessageId).toBe("mid.1787000000123:abcdef1234");
    expect(message?.externalThreadId).toBe("999888777");
    expect(message?.text).toBe("Where is my order?");
  });

  it("rejects an invalid signature before touching the payload", async () => {
    const raw = fixture("meta-messenger");
    const before = queue.messages.length;
    const res = await app.request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
      body: raw,
    });
    expect(res.status).toBe(403);
    expect(queue.messages.length).toBe(before);
  });

  it("treats a duplicate delivery as a no-op", async () => {
    // Simulate the worker having processed an earlier delivery: the message
    // row exists, so the API's point-lookup dedupe must short-circuit.
    const conversation = await dbClient.db
      .insert(conversations)
      .values({
        workspaceId: BUILTIN_WORKSPACE_ID,
        channel: "messenger",
        externalThreadId: "999888777",
      })
      .returning();
    await dbClient.db.insert(messages).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      conversationId: conversation[0]?.id ?? "",
      channel: "messenger",
      direction: "inbound",
      externalMessageId: "mid.1787000000123:abcdef1234",
      text: "Where is my order?",
    });

    const before = queue.messages.length;
    const raw = fixture("meta-messenger");
    const res = await app.request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toEqual({ status: "duplicate" });
    expect(queue.messages.length).toBe(before); // not enqueued again
  });

  it("routes WhatsApp payloads to the whatsapp channel and ignores statuses", async () => {
    const raw = fixture("meta-whatsapp");
    const res = await app.request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    const message = queue.messages[1];
    expect(message?.channel).toBe("whatsapp");
    expect(message?.externalMessageId).toBe("wamid.ABGGFlM5abcdef");
    expect(message?.text).toBe("How long do refunds take?");
  });

  it("acknowledges non-customer events (echoes/receipts) without enqueuing", async () => {
    const raw = JSON.stringify({
      object: "page",
      entry: [
        {
          id: "101",
          messaging: [
            {
              sender: { id: "s1" },
              recipient: { id: "page" },
              timestamp: 1,
              message: { mid: "m-echo", text: "hi", is_echo: true },
            },
          ],
        },
      ],
    });
    const before = queue.messages.length;
    const res = await app.request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": metaSign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toEqual({ status: "ignored" });
    expect(queue.messages.length).toBe(before);
  });

  it("enqueues a signed TikTok message and rejects a bad signature", async () => {
    const raw = fixture("tiktok");
    const ok = await app.request("/webhooks/tiktok", {
      method: "POST",
      headers: { "content-type": "application/json", "tiktok-signature": tiktokSign(raw) },
      body: raw,
    });
    expect(ok.status).toBe(200);
    const message = queue.messages[2];
    expect(message?.channel).toBe("tiktok");
    expect(message?.externalThreadId).toBe("tt_open_4455667788");

    const bad = await app.request("/webhooks/tiktok", {
      method: "POST",
      headers: { "content-type": "application/json", "tiktok-signature": "t=1,s=beef" },
      body: raw,
    });
    expect(bad.status).toBe(403);
  });

  it("enqueues widget messages with a valid token and rejects forged ones", async () => {
    const ok = await app.request("/widget/messages", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${WIDGET_TOKEN}` },
      body: JSON.stringify({ conversationId: "conv-1", text: "hello widget" }),
    });
    expect(ok.status).toBe(200);
    const message = queue.messages[3];
    expect(message?.channel).toBe("widget");
    expect(message?.externalThreadId).toBe("conv-1");
    expect(message?.externalMessageId).toBeTruthy();

    const forged = await app.request("/widget/messages", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify({ conversationId: "conv-1", text: "forged" }),
    });
    expect(forged.status).toBe(403);
    expect(queue.messages.length).toBe(4);
  });

  it("exposes the setup screen data with webhook URLs and plain-English guidance", async () => {
    const res = await app.request("/api/channels");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      channels: Array<{
        channel: string;
        webhookUrl: string | null;
        guidance: string;
      }>;
    };
    expect(body.channels).toHaveLength(5);
    const meta = body.channels.find((c) => c.channel === "messenger");
    expect(meta?.webhookUrl).toBe("https://support.example.test/webhooks/meta");
    expect(meta?.guidance).toContain("Paste the URL");
    const widget = body.channels.find((c) => c.channel === "widget");
    expect(widget?.webhookUrl).toBeNull();
  });
});
