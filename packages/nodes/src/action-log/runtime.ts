import type { NodeRuntime } from "../types";
import type { actionLogParamsSchema } from "./definition";

export const actionLogRuntime: NodeRuntime<typeof actionLogParamsSchema> = {
  type: "action-log",
  typeVersion: 1,
  async execute(ctx, params) {
    // The message is operator-authored config, recorded as run data — it is
    // never customer content, and logs stay minimal (invariant §4.7).
    return { type: "success", output: { message: params.message, at: ctx.now().toISOString() } };
  },
};
