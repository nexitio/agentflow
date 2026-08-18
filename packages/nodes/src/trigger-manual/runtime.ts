import type { NodeRuntime } from "../types";
import type { triggerManualParamsSchema } from "./definition";

export const triggerManualRuntime: NodeRuntime<typeof triggerManualParamsSchema> = {
  type: "trigger-manual",
  typeVersion: 1,
  async execute(ctx, _params) {
    // A trigger passes the run input through unchanged — downstream nodes
    // receive the message itself (e.g. the NormalizedMessage), not a wrapper.
    return { type: "success", output: ctx.input };
  },
};
