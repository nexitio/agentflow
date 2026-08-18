import { z } from "zod";

import type { NodeDefinition } from "../types";

export const logicConditionParamsSchema = z.object({
  /** Dot path into the incoming value, e.g. "text" or "order.status". */
  path: z.string().min(1).default("text"),
  op: z.enum(["contains", "equals", "not-equals"]),
  value: z.string(),
  caseSensitive: z.boolean().default(false),
});

export const logicConditionDefinition: NodeDefinition<typeof logicConditionParamsSchema> = {
  type: "logic-condition",
  category: "logic",
  typeVersion: 2,
  label: "Condition",
  description: "Branches the flow when the incoming value matches.",
  icon: "git-branch",
  paramSchema: logicConditionParamsSchema,
  paramDefaults: () => ({
    path: "text",
    op: "contains",
    value: "",
    caseSensitive: false,
  }),
  handles: { inputs: ["in"], outputs: ["true", "false"] },
};
