/**
 * Agent sub-nodes — they hang below the agent, never in the main sequence.
 * The agent runtime (Phase 4) wires them into the LLM loop: Model config,
 * Memory window, Knowledge retrieval, Tools. TypeVersions here are part of
 * the workflow JSON contract — changes ship as new versions + migrations.
 */

import { z } from "zod";

import type { NodeDefinition } from "../types";

/** v1 (Phase 2) — no structured output. Migrated to v2, never mutated. */
export const agentModelParamsSchemaV1 = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().optional(),
});

export const agentModelParamsSchema = agentModelParamsSchemaV1.extend({
  /** Structured output mode: "text" for plain answers, "json_schema" for validated JSON. */
  responseFormat: z.enum(["text", "json_schema"]).default("text"),
  /** Operator-supplied JSON Schema (as JSON text) for json_schema mode. */
  responseSchema: z.string().default(""),
});

/** v1 (Phase 2) — no embedding model. Migrated to v2, never mutated. */
export const agentKnowledgeParamsSchemaV1 = z.object({
  /** Knowledge source the chunks were ingested under (the operator's document id). */
  collection: z.string().min(1),
  maxChunks: z.number().int().min(1).max(20).default(4),
  minSimilarity: z.number().min(0).max(1).default(0.3),
});

export const agentKnowledgeParamsSchema = agentKnowledgeParamsSchemaV1.extend({
  /**
   * Model used to embed queries at runtime (must match ingestion and the
   * 1536-dim vector column). Empty string falls back to EMBEDDING_MODEL.
   */
  embeddingModel: z.string().default(""),
});

export const agentMemoryParamsSchema = z.object({
  /** Conversation turns kept in context (bounded, windowed). */
  windowSize: z.number().int().min(1).max(50).default(10),
});

export const agentToolHttpParamsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  url: z.string().url(),
  /** HTTP tools can mutate remote state — destructive tools need opt-in. */
  requireApproval: z.boolean().default(false),
});

export const agentModelDefinition: NodeDefinition<typeof agentModelParamsSchema> = {
  type: "agent-model",
  category: "sub-node",
  typeVersion: 2,
  label: "Model",
  description: "Which model the agent reasons with, plus structured output.",
  icon: "cpu",
  paramSchema: agentModelParamsSchema,
  paramDefaults: () => ({
    model: "",
    temperature: 0.2,
    responseFormat: "text",
    responseSchema: "",
  }),
  handles: { inputs: [], outputs: [] },
};

export const agentMemoryDefinition: NodeDefinition<typeof agentMemoryParamsSchema> = {
  type: "agent-memory",
  category: "sub-node",
  typeVersion: 1,
  label: "Memory",
  description: "Bounded conversation history the agent may use.",
  icon: "database",
  paramSchema: agentMemoryParamsSchema,
  paramDefaults: () => ({ windowSize: 10 }),
  handles: { inputs: [], outputs: [] },
};

export const agentKnowledgeDefinition: NodeDefinition<typeof agentKnowledgeParamsSchema> = {
  type: "agent-knowledge",
  category: "sub-node",
  typeVersion: 2,
  label: "Knowledge",
  description:
    "Retrieval over your documents (pgvector). Retrieved chunks are data, never instructions.",
  icon: "book-open",
  paramSchema: agentKnowledgeParamsSchema,
  paramDefaults: () => ({ collection: "", maxChunks: 4, minSimilarity: 0.3, embeddingModel: "" }),
  handles: { inputs: [], outputs: [] },
};

export const agentToolHttpDefinition: NodeDefinition<typeof agentToolHttpParamsSchema> = {
  type: "agent-tool-http",
  category: "sub-node",
  typeVersion: 1,
  label: "HTTP Tool",
  description:
    "A tool the agent may call. Tool authority comes only from what the operator wires here.",
  icon: "wrench",
  paramSchema: agentToolHttpParamsSchema,
  paramDefaults: () => ({
    name: "",
    description: "",
    method: "GET",
    url: "",
    requireApproval: false,
  }),
  handles: { inputs: [], outputs: [] },
  destructive: true,
};
