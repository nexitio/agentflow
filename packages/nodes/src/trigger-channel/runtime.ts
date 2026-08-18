import type { NodeRuntime } from "../types";
import type { triggerChannelParamsSchema } from "./definition";

export const triggerChannelRuntime: NodeRuntime<typeof triggerChannelParamsSchema> = {
  type: "trigger-channel",
  typeVersion: 1,
  async execute(ctx, params) {
    // Guard against wrong-flow routing: a webhook on channel X must never
    // start a flow whose trigger is wired to channel Y.
    if (ctx.channel !== params.channel) {
      return {
        type: "error",
        code: "CONFIGURATION",
        message: `This flow's trigger is wired to ${params.channel}, but the run arrived on ${ctx.channel}.`,
      };
    }
    // Pass the NormalizedMessage through unchanged, like every trigger.
    return { type: "success", output: ctx.input };
  },
};
