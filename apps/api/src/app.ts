/**
 * apps/api — Hono on Node (AGENTS.md §3).
 *
 * REST surface for the UI: flows CRUD + publish + manual test runs. Channel
 * webhooks land in Phase 5 (verify → dedupe → enqueue → 200, <100ms).
 *
 * The canvas talks to this API from the browser in dev (CORS) and through
 * Caddy in production (same origin). Manual runs execute the latest published
 * snapshot through the engine and persist the run (invariant §4.9).
 */

import type { ChannelCredentials } from "@agentflow/channels/types";
import type { WidgetPublisher } from "@agentflow/channels/widget";
import {
  createDraft,
  getDraft,
  getLatestPublished,
  listFlows,
  listRunsForFlow,
  publishFlow,
  saveDraft,
} from "@agentflow/db/repo/flows";
import { createRun, finishRun } from "@agentflow/db/repo/runs";
import type * as schema from "@agentflow/db/schema";
import { BUILTIN_WORKSPACE_ID } from "@agentflow/db/seed";
import { executeFlow } from "@agentflow/engine";
import { parseFlow } from "@agentflow/nodes/flow";
import {
  AgentFlowError,
  ConfigurationError,
  NotFoundError,
  ValidationError,
} from "@agentflow/shared/errors";
import { logger } from "@agentflow/shared/logger";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { authRoutes } from "./auth";
import { channelRoutes } from "./channels";
import type { InboundQueue } from "./queue";
import { settingsRoutes } from "./settings";
import type { WidgetStreamHub } from "./widget-hub";

export interface ApiOptions {
  db?: PostgresJsDatabase<typeof schema>;
  /** Webhook ingress queue (BullMQ). Absent → webhooks answer 503. */
  queue?: InboundQueue;
  widgetHub?: WidgetStreamHub;
  widgetPublisher?: WidgetPublisher;
  /** Provider credentials (env-loaded by index.ts). */
  channelCredentials?: ChannelCredentials;
  publicBaseUrl?: string;
  metaVerifyToken?: string;
  widgetToken?: string;
}

const flowIdSchema = z.string().uuid();

const createFlowBodySchema = z.object({
  name: z.string().min(1).max(200),
});

const saveDraftBodySchema = z.object({
  name: z.string().min(1).max(200),
  flowJson: z.unknown(),
});

const runBodySchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

export function createApp(options: ApiOptions = {}): Hono {
  const app = new Hono();

  // Dev: the canvas calls this API from the browser. Production is same-origin
  // through Caddy, where CORS is irrelevant.
  app.use("/api/*", cors({ origin: "*" }));

  const requireDb = (): PostgresJsDatabase<typeof schema> => {
    if (options.db === undefined) {
      throw new ConfigurationError(
        "Database not configured — set DATABASE_URL and restart the API.",
      );
    }
    return options.db;
  };

  const parseFlowId = (raw: string | undefined): string => {
    const parsed = flowIdSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("Invalid flow id.");
    }
    return parsed.data;
  };

  // Auth routes: login, register, session, TOTP, passkey
  app.route(
    "/",
    authRoutes({
      db: options.db,
    }),
  );

  // Settings routes: workspace, agents, channels, knowledge, system, audit
  app.route(
    "/",
    settingsRoutes({
      db: options.db,
    }),
  );

  // Channel ingress: webhooks (verify → dedupe → enqueue → 200), widget
  // SSE, and the setup screen data.
  app.route(
    "/",
    channelRoutes({
      db: options.db,
      queue: options.queue,
      widgetHub: options.widgetHub,
      widgetPublisher: options.widgetPublisher,
      credentials: options.channelCredentials,
      publicBaseUrl: options.publicBaseUrl,
      metaVerifyToken: options.metaVerifyToken,
      widgetToken: options.widgetToken,
    }),
  );

  app.get("/health", (c) => {
    logger.info("health check", { service: "api", path: c.req.path });
    return c.json({ status: "ok", service: "api", time: new Date().toISOString() });
  });

  app.get("/api/flows", async (c) => {
    const db = requireDb();
    const flows = await listFlows(db, BUILTIN_WORKSPACE_ID);
    return c.json({ flows });
  });

  app.post("/api/flows", async (c) => {
    const db = requireDb();
    const body = createFlowBodySchema.parse(await c.req.json());
    const flow = await createDraft(db, BUILTIN_WORKSPACE_ID, body.name);
    return c.json({ flow }, 201);
  });

  app.get("/api/flows/:flowId", async (c) => {
    const db = requireDb();
    const flowId = parseFlowId(c.req.param("flowId"));
    const draft = await getDraft(db, BUILTIN_WORKSPACE_ID, flowId);
    if (draft === undefined) {
      throw new NotFoundError("Flow draft not found.");
    }
    return c.json({ flow: draft });
  });

  app.put("/api/flows/:flowId", async (c) => {
    const db = requireDb();
    const flowId = parseFlowId(c.req.param("flowId"));
    const body = saveDraftBodySchema.parse(await c.req.json());
    // The workflow JSON is a public contract — validate (and normalize, e.g.
    // fill position defaults) at the API boundary before persisting.
    const flowJson = parseFlow(body.flowJson);
    const flow = await saveDraft(db, BUILTIN_WORKSPACE_ID, flowId, {
      name: body.name,
      flowJson,
    });
    return c.json({ flow });
  });

  app.post("/api/flows/:flowId/publish", async (c) => {
    const db = requireDb();
    const flowId = parseFlowId(c.req.param("flowId"));
    const snapshot = await publishFlow(db, BUILTIN_WORKSPACE_ID, flowId);
    return c.json({ flow: snapshot }, 201);
  });

  app.get("/api/flows/:flowId/runs", async (c) => {
    const db = requireDb();
    const flowId = parseFlowId(c.req.param("flowId"));
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(c.req.query("limit"));
    const runs = await listRunsForFlow(db, BUILTIN_WORKSPACE_ID, flowId, limit);
    return c.json({ runs });
  });

  app.post("/api/flows/:flowId/runs", async (c) => {
    const db = requireDb();
    const flowId = parseFlowId(c.req.param("flowId"));
    const body = runBodySchema.parse(await c.req.json());

    // Runs reference the immutable published snapshot — never the draft.
    const snapshot = await getLatestPublished(db, BUILTIN_WORKSPACE_ID, flowId);
    if (snapshot === undefined) {
      throw new ValidationError("Publish the flow before running a test.");
    }

    const runId = await createRun(db, {
      workspaceId: BUILTIN_WORKSPACE_ID,
      flowSnapshotId: snapshot.id,
      channel: "widget",
      input: body.input,
    });

    const result = await executeFlow({
      flow: snapshot.flowJson,
      input: body.input,
      workspaceId: BUILTIN_WORKSPACE_ID,
      channel: "widget",
      db,
      runId,
    });

    await finishRun(db, runId, {
      status: result.status,
      nodeOutputs: result.nodeOutputs,
      timings: result.timings,
      tokenUsage: result.tokenUsage,
      ...(result.error !== undefined ? { error: result.error } : {}),
      finishedAt: new Date(result.finishedAt),
    });

    return c.json({ run: { id: runId, ...result } });
  });

  app.onError((error, c) => {
    if (error instanceof AgentFlowError) {
      logger.error("request failed", error, { path: c.req.path });
      return c.json({ error: error.toLog() }, error.status as ContentfulStatusCode);
    }
    if (error instanceof z.ZodError) {
      const message = `Invalid request — ${error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ")}`;
      const validationError = new ValidationError(message, { details: error.issues });
      logger.error("request failed", validationError, { path: c.req.path });
      return c.json({ error: validationError.toLog() }, 400);
    }
    logger.error("unhandled request error", error, { path: c.req.path });
    return c.json({ error: { code: "INTERNAL", status: 500, message: "Internal error." } }, 500);
  });

  return app;
}
