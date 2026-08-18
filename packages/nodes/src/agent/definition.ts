import { z } from "zod";

import type { NodeDefinition } from "../types";

export const agentParamsSchema = z.object({
  systemPrompt: z.string().default("You are a helpful support agent."),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * The agent node (AGENTS.md §5). Sub-nodes hang below it and declare what it
 * may use — Model, Memory, Knowledge, Tool. The model decides at runtime
 * which tool to call and in what order; main-sequence edges describe what
 * happens AFTER the agent finishes, not how it thinks. Support agents are not
 * decision trees.
 */
export const agentDefinition: NodeDefinition<typeof agentParamsSchema> = {
  type: "agent",
  category: "agent",
  typeVersion: 1,
  label: "Agent",
  description: "The LLM reasoning node. Attach Model, Memory, Knowledge, and Tool sub-nodes.",
  icon: "bot",
  paramSchema: agentParamsSchema,
  paramDefaults: () => ({
    systemPrompt: "You are a helpful support agent.",
    temperature: 0.2,
  }),
  handles: { inputs: ["in"], outputs: ["out"] },
};
