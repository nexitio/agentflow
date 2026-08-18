/**
 * Sub-node runtimes — not called directly by the engine (sub-nodes are never
 * in the main sequence). The agent runtime (Phase 4) executes their logic
 * inside the LLM loop. These exist so every node in the registry has a
 * runtime (six-piece rule) and any accidental direct execution fails loudly.
 */

import type { NodeRuntime } from "../types";
import type {
  agentKnowledgeParamsSchema,
  agentMemoryParamsSchema,
  agentModelParamsSchema,
  agentToolHttpParamsSchema,
} from "./sub-nodes";

const NOT_DIRECTLY_EXECUTABLE = {
  type: "error" as const,
  code: "CONFIGURATION" as const,
  message: "Sub-nodes execute through their agent node (Phase 4).",
};

export const agentModelRuntime: NodeRuntime<typeof agentModelParamsSchema> = {
  type: "agent-model",
  typeVersion: 2,
  async execute() {
    return NOT_DIRECTLY_EXECUTABLE;
  },
};

export const agentMemoryRuntime: NodeRuntime<typeof agentMemoryParamsSchema> = {
  type: "agent-memory",
  typeVersion: 1,
  async execute() {
    return NOT_DIRECTLY_EXECUTABLE;
  },
};

export const agentKnowledgeRuntime: NodeRuntime<typeof agentKnowledgeParamsSchema> = {
  type: "agent-knowledge",
  typeVersion: 2,
  async execute() {
    return NOT_DIRECTLY_EXECUTABLE;
  },
};

export const agentToolHttpRuntime: NodeRuntime<typeof agentToolHttpParamsSchema> = {
  type: "agent-tool-http",
  typeVersion: 1,
  async execute() {
    return NOT_DIRECTLY_EXECUTABLE;
  },
};
