/**
 * apps/worker — BullMQ consumer (AGENTS.md §2, §4.2). Webhooks never do this
 * work; the API enqueues and answers 200 in <100ms. The worker is the only
 * place node runtimes + the engine execute. The per-job logic lives in
 * handle-inbound.ts (pure, testable); this file wires env + queue.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialsFromEnv } from "@agentflow/channels/config";
import { createRedisWidgetPublisher } from "@agentflow/channels/widget";
import { createDbClient, type Db } from "@agentflow/db/client";
import { ensureBuiltinWorkspace } from "@agentflow/db/seed";
import { loadEnv } from "@agentflow/shared/env";
import { logger } from "@agentflow/shared/logger";
import { type NormalizedMessage, normalizedMessageSchema } from "@agentflow/shared/types";
import { Worker } from "bullmq";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { z } from "zod";

import { createInboundHandler } from "./handle-inbound";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

const env = loadEnv(envSchema);

const migrationsFolder = resolve(
  fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
);

const dbClient = createDbClient(env.DATABASE_URL);
const db: Db = dbClient.db;
await migrate(db, { migrationsFolder });
await ensureBuiltinWorkspace(db);

const handleInbound = createInboundHandler({
  db,
  credentials: credentialsFromEnv(process.env as Record<string, string | undefined>),
  widgetPublisher: createRedisWidgetPublisher(env.REDIS_URL),
});

const worker = new Worker<NormalizedMessage>(
  "inbound",
  async (job) => {
    const message = normalizedMessageSchema.parse(job.data);
    await handleInbound(message);
  },
  { connection: { url: env.REDIS_URL }, concurrency: 5 },
);

worker.on("failed", (job, error) => {
  logger.error("inbound job failed", error, { jobId: job?.id });
});

logger.info("worker ready", { service: "worker", queue: "inbound" });
