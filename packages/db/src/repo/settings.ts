/**
 * Settings repository — dot-notched workspace settings (schema.ts §6).
 *
 * Today this backs the LLM defaults surfaced in System → LLM Configuration:
 * the operator picks a default model / temperature / max tokens / system
 * prompt for the workspace, and the agent runtime uses them whenever a flow
 * leaves the corresponding value unset (see packages/nodes agent runtime).
 * Keys live under the "llm." prefix — "llm.model", "llm.temperature", …
 */

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../schema";

export interface LlmSettings {
  /** Default model for agents without an explicit Model node choice. */
  model?: string;
  /** Default temperature (0..2). */
  temperature?: number;
  /** Default max output tokens. */
  maxTokens?: number;
  /** Default system prompt used when an agent leaves the stock prompt. */
  systemPrompt?: string;
}

/** Read the workspace's stored LLM defaults (all rows under the "llm." prefix). */
export async function getLlmSettings(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<LlmSettings> {
  const rows = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(
      and(eq(schema.settings.workspaceId, workspaceId), sql`${schema.settings.key} like 'llm.%'`),
    );

  const result: LlmSettings = {};
  for (const row of rows) {
    // Values travel as JSONB; anything stored as the wrong type (e.g. by an
    // old client) is skipped rather than crashing a run.
    const value = row.value;
    if (row.key === "llm.model" && typeof value === "string" && value.length > 0) {
      result.model = value;
    } else if (
      row.key === "llm.temperature" &&
      typeof value === "number" &&
      value >= 0 &&
      value <= 2
    ) {
      result.temperature = value;
    } else if (
      row.key === "llm.maxTokens" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0
    ) {
      result.maxTokens = value;
    } else if (row.key === "llm.systemPrompt" && typeof value === "string" && value.length > 0) {
      result.systemPrompt = value;
    }
  }
  return result;
}

/** Upsert one dot-notched setting for the workspace. */
export async function setSetting(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ workspaceId, key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.settings.workspaceId, schema.settings.key],
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });
}

/** Remove one dot-notched setting for the workspace (a cleared default). */
export async function clearSetting(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  key: string,
): Promise<void> {
  await db
    .delete(schema.settings)
    .where(and(eq(schema.settings.workspaceId, workspaceId), eq(schema.settings.key, key)));
}

/**
 * Apply a partial LLM-defaults patch: present values are upserted, `null`
 * clears the stored key, and absent keys are left untouched.
 */
export async function patchLlmSettings(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  patch: Record<string, string | number | null | undefined>,
): Promise<void> {
  const mapping: Array<[string, string | number | null | undefined]> = [
    ["model", patch.model],
    ["temperature", patch.temperature],
    ["maxTokens", patch.maxTokens],
    ["systemPrompt", patch.systemPrompt],
  ];
  for (const [suffix, value] of mapping) {
    if (value === undefined) {
      continue;
    }
    const key = `llm.${suffix}`;
    if (value === null || (typeof value === "string" && value.trim() === "")) {
      await clearSetting(db, workspaceId, key);
    } else {
      await setSetting(db, workspaceId, key, value);
    }
  }
}
