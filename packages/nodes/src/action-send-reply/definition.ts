import { z } from "zod";

import type { NodeDefinition } from "../types";

export const actionSendReplyParamsSchema = z.object({
  label: z.string().default("Send reply"),
});

/**
 * The outbound edge of a support flow: whatever text arrives on its input
 * handle (e.g. the agent's answer) becomes the message the worker sends to
 * the customer on this channel (window-checked, idempotency-keyed — the
 * worker's job, not this node's). A flow without this node never sends.
 */
export const actionSendReplyDefinition: NodeDefinition<typeof actionSendReplyParamsSchema> = {
  type: "action-send-reply",
  category: "action",
  typeVersion: 1,
  label: "Send Reply",
  description: "Sends the incoming text to the customer as a message on this channel.",
  icon: "send",
  paramSchema: actionSendReplyParamsSchema,
  paramDefaults: () => ({ label: "Send reply" }),
  handles: { inputs: ["in"], outputs: ["out"] },
};
