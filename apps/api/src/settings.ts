/**
 * Settings routes — workspace, agents, channels, knowledge, system, audit.
 *
 * All routes require authentication. The settings panel is the operator's
 * control surface for the entire platform.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, desc, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import * as schema from "@agentflow/db/schema";
import { BUILTIN_WORKSPACE_ID } from "@agentflow/db/seed";
import { UnauthorizedError } from "@agentflow/shared/errors";
import { logger } from "@agentflow/shared/logger";
import { getCookie } from "@agentflow/shared/auth";
import { randomBytes } from "node:crypto";

const SESSION_COOKIE = "af_session";
const SESSION_SECRET = process.env.SESSION_SECRET ?? process.env.ENCRYPTION_KEY ?? "dev-session-secret";

// ─── Auth middleware ─────────────────────────────────────────────────────────

function verifySession(c: { req: { header: (name: string) => string | undefined } }): {
  userId: string;
  email: string;
  role: string;
} | null {
  const { verifyJwt } = require("@agentflow/shared/auth") as typeof import("@agentflow/shared/auth");
  const cookieHeader = c.req.header("cookie") ?? null;
  const token = getCookie(cookieHeader, SESSION_COOKIE);
  if (token === undefined) return null;

  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  // Use the same verification as in auth.ts
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payload = verifyJwt(token, SESSION_SECRET);
  if (payload === null) return null;

  return { userId: payload.sub, email: payload.email, role: payload.role };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
});

const updateLlmSchema = z.object({
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
  systemPrompt: z.string().max(10000).optional(),
});

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(["read"]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

export function settingsRoutes(options: {
  db?: PostgresJsDatabase<typeof schema>;
}): Hono {
  const app = new Hono();

  const requireDb = (): PostgresJsDatabase<typeof schema> => {
    if (options.db === undefined) {
      throw new Error("Database not configured");
    }
    return options.db;
  };

  const requireAuth = (c: { req: { header: (name: string) => string | undefined } }) => {
    const user = verifySession(c);
    if (user === null) {
      throw new UnauthorizedError("Not authenticated.");
    }
    return user;
  };

  // ─── Workspace Settings ─────────────────────────────────────────────────

  app.get("/api/settings/workspace", async (c) => {
    requireAuth(c);
    const db = requireDb();

    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, BUILTIN_WORKSPACE_ID),
    });

    return c.json({ workspace });
  });

  app.put("/api/settings/workspace", async (c) => {
    const user = requireAuth(c);
    if (user.role !== "admin") {
      return c.json({ error: { code: "FORBIDDEN", message: "Admin access required." } }, 403);
    }

    const db = requireDb();
    const body = updateWorkspaceSchema.parse(await c.req.json());

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;

    const [updated] = await db
      .update(schema.workspaces)
      .set(updates)
      .where(eq(schema.workspaces.id, BUILTIN_WORKSPACE_ID))
      .returning();

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      action: "workspace.update",
      resourceType: "workspace",
      resourceId: BUILTIN_WORKSPACE_ID,
    });

    return c.json({ workspace: updated });
  });

  // ─── Agents / Flows ────────────────────────────────────────────────────

  app.get("/api/settings/agents", async (c) => {
    requireAuth(c);
    const db = requireDb();

    const flows = await db.query.flows.findMany({
      where: eq(schema.flows.workspaceId, BUILTIN_WORKSPACE_ID),
      orderBy: [desc(schema.flows.updatedAt)],
    });

    // Group by flowId and get draft + latest published
    const agentMap = new Map<string, {
      flowId: string;
      name: string;
      description: string;
      draftVersion: number | null;
      publishedVersion: number | null;
      publishedAt: string | null;
      updatedAt: string;
      runCount: number;
    }>();

    for (const flow of flows) {
      const existing = agentMap.get(flow.flowId);
      if (existing === undefined) {
        agentMap.set(flow.flowId, {
          flowId: flow.flowId,
          name: flow.name,
          description: flow.description,
          draftVersion: flow.status === "draft" ? flow.version : null,
          publishedVersion: flow.status === "published" ? flow.version : null,
          publishedAt: flow.status === "published" ? flow.updatedAt.toISOString() : null,
          updatedAt: flow.updatedAt.toISOString(),
          runCount: 0,
        });
      } else {
        if (flow.status === "published") {
          existing.publishedVersion = flow.version;
          existing.publishedAt = flow.updatedAt.toISOString();
        }
      }
    }

    return c.json({ agents: Array.from(agentMap.values()) });
  });

  app.put("/api/settings/agents/:flowId", async (c) => {
    const user = requireAuth(c);
    const db = requireDb();
    const flowId = c.req.param("flowId");
    const body = z.object({ name: z.string().min(1).max(200).optional() }).parse(await c.req.json());

    // Update all versions of this flow with the new name
    if (body.name !== undefined) {
      await db
        .update(schema.flows)
        .set({ name: body.name, updatedAt: new Date() })
        .where(and(eq(schema.flows.workspaceId, BUILTIN_WORKSPACE_ID), eq(schema.flows.flowId, flowId)));
    }

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      action: "agent.update",
      resourceType: "flow",
      resourceId: flowId,
    });

    return c.json({ ok: true });
  });

  app.delete("/api/settings/agents/:flowId", async (c) => {
    const user = requireAuth(c);
    if (user.role !== "admin") {
      return c.json({ error: { code: "FORBIDDEN", message: "Admin access required." } }, 403);
    }

    const db = requireDb();
    const flowId = c.req.param("flowId");

    // Delete all versions of this flow
    await db
      .delete(schema.flows)
      .where(and(eq(schema.flows.workspaceId, BUILTIN_WORKSPACE_ID), eq(schema.flows.flowId, flowId)));

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      action: "agent.delete",
      resourceType: "flow",
      resourceId: flowId,
    });

    return c.json({ ok: true });
  });

  // ─── Channel Settings ──────────────────────────────────────────────────

  app.get("/api/settings/channels", async (c) => {
    requireAuth(c);
    const db = requireDb();

    const channels = await db.query.channelStatus.findMany({
      where: eq(schema.channelStatus.workspaceId, BUILTIN_WORKSPACE_ID),
    });

    const credentials = await db.query.credentials.findMany({
      where: eq(schema.credentials.workspaceId, BUILTIN_WORKSPACE_ID),
    });

    return c.json({
      channels: channels.map((ch) => ({
        channel: ch.channel,
        webhookUrl: ch.webhookUrl,
        verified: ch.verifiedAt !== null,
        lastEventAt: ch.lastEventAt?.toISOString() ?? null,
        lastError: ch.lastError,
      })),
      credentials: credentials.map((cred) => ({
        id: cred.id,
        channel: cred.channel,
        name: cred.name,
        maskedHint: cred.maskedHint,
        createdAt: cred.createdAt.toISOString(),
      })),
    });
  });

  // ─── Knowledge Base ────────────────────────────────────────────────────

  app.get("/api/settings/knowledge", async (c) => {
    requireAuth(c);
    const db = requireDb();

    const chunks = await db
      .select({
        sourceId: schema.knowledgeChunks.sourceId,
        title: schema.knowledgeChunks.title,
        count: sql<number>`count(*)::int`,
        createdAt: sql<Date>`min(${schema.knowledgeChunks.createdAt})`,
      })
      .from(schema.knowledgeChunks)
      .where(eq(schema.knowledgeChunks.workspaceId, BUILTIN_WORKSPACE_ID))
      .groupBy(schema.knowledgeChunks.sourceId);

    return c.json({ sources: chunks });
  });

  app.delete("/api/settings/knowledge/:sourceId", async (c) => {
    const user = requireAuth(c);
    if (user.role !== "admin") {
      return c.json({ error: { code: "FORBIDDEN", message: "Admin access required." } }, 403);
    }

    const db = requireDb();
    const sourceId = c.req.param("sourceId");

    await db
      .delete(schema.knowledgeChunks)
      .where(
        and(
          eq(schema.knowledgeChunks.workspaceId, BUILTIN_WORKSPACE_ID),
          eq(schema.knowledgeChunks.sourceId, sourceId),
        ),
      );

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      action: "knowledge.delete",
      resourceType: "knowledge",
      resourceId: sourceId,
    });

    return c.json({ ok: true });
  });

  // ─── System Settings ───────────────────────────────────────────────────

  app.get("/api/settings/system", async (c) => {
    requireAuth(c);
    const db = requireDb();

    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, BUILTIN_WORKSPACE_ID),
    });

    // System health info
    return c.json({
      version: "0.1.0",
      workspace: {
        name: workspace?.name ?? "Default workspace",
        createdAt: workspace?.createdAt.toISOString() ?? null,
      },
      environment: {
        hasEncryptionKey: (process.env.ENCRYPTION_KEY ?? "").length > 0,
        hasDatabase: (process.env.DATABASE_URL ?? "").length > 0,
        hasRedis: (process.env.REDIS_URL ?? "").length > 0,
        hasLlmEndpoint: (process.env.LLM_BASE_URL ?? "").length > 0,
      },
    });
  });

  // ─── Audit Log ─────────────────────────────────────────────────────────

  app.get("/api/settings/audit", async (c) => {
    requireAuth(c);
    const db = requireDb();

    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(c.req.query("limit"));
    const offset = z.coerce.number().int().min(0).default(0).parse(c.req.query("offset"));

    const logs = await db.query.auditLog.findMany({
      where: eq(schema.auditLog.workspaceId, BUILTIN_WORKSPACE_ID),
      orderBy: [desc(schema.auditLog.createdAt)],
      limit,
      offset,
    });

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, BUILTIN_WORKSPACE_ID));

    const total = result[0]?.count ?? 0;

    return c.json({ logs, total });
  });

  // ─── API Keys ──────────────────────────────────────────────────────────

  app.get("/api/settings/api-keys", async (c) => {
    const user = requireAuth(c);
    const db = requireDb();

    const keys = await db.query.apiKeys.findMany({
      where: eq(schema.apiKeys.workspaceId, BUILTIN_WORKSPACE_ID),
      orderBy: [desc(schema.apiKeys.createdAt)],
    });

    return c.json({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        expiresAt: key.expiresAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      })),
    });
  });

  app.post("/api/settings/api-keys", async (c) => {
    const user = requireAuth(c);
    if (user.role !== "admin") {
      return c.json({ error: { code: "FORBIDDEN", message: "Admin access required." } }, 403);
    }

    const db = requireDb();
    const body = createApiKeySchema.parse(await c.req.json());

    // Generate API key
    const rawKey = `af_${randomBytes(32).toString("hex")}`;
    const keyPrefix = rawKey.slice(0, 12);

    // Hash the key for storage
    const { createHash } = await import("node:crypto");
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const expiresAt = body.expiresInDays !== undefined
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    await db.insert(schema.apiKeys).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      name: body.name,
      keyHash,
      keyPrefix,
      scopes: body.scopes,
      expiresAt,
    });

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      action: "apikey.create",
      resourceType: "api_key",
      metadata: { name: body.name },
    });

    // Return the raw key ONCE — it's never stored plaintext (invariant §4.6)
    return c.json({ key: rawKey, keyPrefix });
  });

  app.delete("/api/settings/api-keys/:id", async (c) => {
    const user = requireAuth(c);
    if (user.role !== "admin") {
      return c.json({ error: { code: "FORBIDDEN", message: "Admin access required." } }, 403);
    }

    const db = requireDb();
    const keyId = c.req.param("id");

    await db
      .delete(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.workspaceId, BUILTIN_WORKSPACE_ID)));

    await db.insert(schema.auditLog).values({
      workspaceId: BUILTIN_WORKSPACE_ID,
      userId: user.userId,
      action: "apikey.delete",
      resourceType: "api_key",
      resourceId: keyId,
    });

    return c.json({ ok: true });
  });

  return app;
}
