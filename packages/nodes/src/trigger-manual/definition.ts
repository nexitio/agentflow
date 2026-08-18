import { z } from "zod";

import type { NodeDefinition } from "../types";

export const triggerManualParamsSchema = z.object({
  label: z.string().default("Manual test"),
});

export const triggerManualDefinition: NodeDefinition<typeof triggerManualParamsSchema> = {
  type: "trigger-manual",
  category: "trigger",
  typeVersion: 1,
  label: "Manual Trigger",
  description: "Starts a run from the UI with test input. One trigger per flow.",
  icon: "zap",
  paramSchema: triggerManualParamsSchema,
  paramDefaults: () => ({ label: "Manual test" }),
  handles: { inputs: [], outputs: ["out"] },
};
