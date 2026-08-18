import { z } from "zod";

import type { NodeDefinition } from "../types";

export const actionLogParamsSchema = z.object({
  message: z.string().min(1),
});

export const actionLogDefinition: NodeDefinition<typeof actionLogParamsSchema> = {
  type: "action-log",
  category: "action",
  typeVersion: 1,
  label: "Log Message",
  description: "Records a message into the run output — useful for testing and debugging.",
  icon: "terminal",
  paramSchema: actionLogParamsSchema,
  paramDefaults: () => ({ message: "log line" }),
  handles: { inputs: ["in"], outputs: ["out"] },
};
