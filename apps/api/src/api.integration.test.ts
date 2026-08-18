/**
 * API integration tests — like db.integration.test.ts, these run ONLY against
 * a throwaway database (they create real rows). Skipped without DATABASE_URL.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient } from "@agentflow/db/client";
import { ensureBuiltinWorkspace } from "@agentflow/db/seed";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined ? describe.skip : describe;

const migrationsFolder = resolve(
  fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
);

let dbClient: ReturnType<typeof createDbClient>;
let app: ReturnType<typeof createApp>;

const FLOW_JSON = {
  version: 1,
  nodes: [
    { id: "t1", type: "trigger-manual", typeVersion: 1, params: { label: "Run" } },
    {
      id: "c1",
      type: "logic-condition",
      typeVersion: 2,
      params: { path: "text", op: "contains", value: "refund", caseSensitive: false },
    },
    { id: "l1", type: "action-log", typeVersion: 1, params: { message: "refund requested" } },
  ],
  edges: [
    { id: "e1", source: "t1", target: "c1" },
    { id: "e2", source: "c1", target: "l1", sourceHandle: "true" },
  ],
};

describeDb("api (integration)", () => {
  beforeAll(async () => {
    const url = DATABASE_URL;
    if (url === undefined) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    dbClient = createDbClient(url);
    await migrate(dbClient.db, { migrationsFolder });
    await ensureBuiltinWorkspace(dbClient.db);
    app = createApp({ db: dbClient.db });
  });

  afterAll(async () => {
    await dbClient?.client.end();
  });

  it("creates, saves, and publishes a flow", async () => {
    const created = await app.request("/api/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Order support" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      flow: { flowId: string; name: string; status: string };
    };
    expect(createdBody.flow.status).toBe("draft");

    const flowId = createdBody.flow.flowId;
    const saved = await app.request(`/api/flows/${flowId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Order support", flowJson: FLOW_JSON }),
    });
    expect(saved.status).toBe(200);

    const published = await app.request(`/api/flows/${flowId}/publish`, { method: "POST" });
    expect(published.status).toBe(201);

    const list = (await (await app.request("/api/flows")).json()) as {
      flows: Array<{ flowId: string; publishedVersion: number | null }>;
    };
    // Draft is version 1; the published snapshot is the next version (2).
    expect(list.flows.find((f) => f.flowId === flowId)?.publishedVersion).toBe(2);
  });

  it("rejects publishing a missing flow with a typed error", async () => {
    const res = await app.request("/api/flows/00000000-0000-7000-8000-000000000099/publish", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("runs the published flow and persists the result", async () => {
    const created = (await (
      await app.request("/api/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Run flow" }),
      })
    ).json()) as { flow: { flowId: string } };
    const flowId = created.flow.flowId;

    await app.request(`/api/flows/${flowId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Run flow", flowJson: FLOW_JSON }),
    });
    await app.request(`/api/flows/${flowId}/publish`, { method: "POST" });

    // Before publish is impossible here; test the refusal on a fresh flow:
    const fresh = (await (
      await app.request("/api/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Unpublished" }),
      })
    ).json()) as { flow: { flowId: string } };
    const refused = await app.request(`/api/flows/${fresh.flow.flowId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { text: "hi" } }),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");

    const ran = await app.request(`/api/flows/${flowId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { text: "I want a refund" } }),
    });
    expect(ran.status).toBe(200);
    const runBody = (await ran.json()) as {
      run: { id: string; status: string; nodeOutputs: Record<string, { status: string }> };
    };
    expect(runBody.run.status).toBe("succeeded");
    expect(runBody.run.nodeOutputs.c1?.status).toBe("success");
    expect(runBody.run.nodeOutputs.l1?.status).toBe("success");

    const runs = (await (await app.request(`/api/flows/${flowId}/runs`)).json()) as {
      runs: Array<{ id: string; status: string }>;
    };
    expect(runs.runs[0]?.id).toBe(runBody.run.id);
    expect(runs.runs[0]?.status).toBe("succeeded");
  });
});
