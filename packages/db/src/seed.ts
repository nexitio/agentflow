/**
 * Single built-in workspace (AGENTS.md §6). Deterministic id so seeding is
 * idempotent; agencies will add workspaces later without a migration.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

export const BUILTIN_WORKSPACE_ID = "00000000-0000-7000-8000-000000000001";

export async function ensureBuiltinWorkspace(db: PostgresJsDatabase<typeof schema>): Promise<void> {
  await db
    .insert(schema.workspaces)
    .values({ id: BUILTIN_WORKSPACE_ID, name: "Default workspace" })
    .onConflictDoNothing();
}
