import type { NodeMigrations } from "../types";

/**
 * agent-model v1 → v2 (Phase 4): structured output gained
 * `responseFormat`/`responseSchema`. Old flows default to plain text — the
 * same behaviour as v1 — and keep executing forever (AGENTS.md §4.1).
 */
export const agentModelMigrations: NodeMigrations = {
  1: (params) => ({
    ...params,
    responseFormat: "text",
    responseSchema: "",
  }),
};

/**
 * agent-knowledge v1 → v2 (Phase 4): retrieval gained an explicit
 * `embeddingModel`. Old flows fall back to the environment default — same
 * behaviour as v1.
 */
export const agentKnowledgeMigrations: NodeMigrations = {
  1: (params) => ({
    ...params,
    embeddingModel: "",
  }),
};

/** Memory and tools are still typeVersion 1 — no migrations yet. */
export const agentSubNodeMigrations: NodeMigrations = {};
