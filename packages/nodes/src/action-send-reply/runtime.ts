import type { NodeRuntime } from "../types";
import type { actionSendReplyParamsSchema } from "./definition";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    if (typeof value.content === "string") {
      return value.content;
    }
    if (typeof value.text === "string") {
      return value.text;
    }
  }
  return undefined;
}

export const actionSendReplyRuntime: NodeRuntime<typeof actionSendReplyParamsSchema> = {
  type: "action-send-reply",
  typeVersion: 1,
  async execute(ctx) {
    const text = extractText(ctx.inputs.in);
    if (text === undefined || text.length === 0) {
      return {
        type: "error",
        code: "VALIDATION",
        message:
          "Send Reply has no text to send — connect it after the agent or a message-producing node.",
      };
    }
    return { type: "success", output: { text } };
  },
};
