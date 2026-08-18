/**
 * Migration runner — applied automatically on container boot (AGENTS.md §4.8).
 * Forward-only, idempotent: `docker compose up` on a box with a year of
 * conversations must work unattended. Then seeds the built-in workspace.
 *
 * Usage: pnpm --filter @agentflow/db db:migrate  (requires DATABASE_URL)
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@agentflow/shared/env";
import { logger } from "@agentflow/shared/logger";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { z } from "zod";

import { createDbClient } from "./client";
import { ensureBuiltinWorkspace } from "./seed";

const env = loadEnv(z.object({ DATABASE_URL: z.string().min(1) }));

const migrationsFolder = resolve(fileURLToPath(new URL("..", import.meta.url)), "migrations");

const { client, db } = createDbClient(env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder });
  await ensureBuiltinWorkspace(db);
  logger.info("database ready", { service: "db", migrationsFolder });
} finally {
  await client.end();
}
