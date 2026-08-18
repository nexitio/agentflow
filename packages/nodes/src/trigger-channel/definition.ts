import { channelSchema } from "@agentflow/shared/types";
import { z } from "zod";

import type { NodeDefinition } from "../types";

export const triggerChannelParamsSchema = z.object({
  /** Which channel's inbound messages start this flow. */
  channel: channelSchema,
  label: z.string().default("Channel"),
});

/**
 * The real inbound trigger — the worker routes each channel's webhook to the
 * published flow whose trigger declares that channel (AGENTS.md §5). One
 * trigger per flow; the runtime refuses to run a flow on the wrong channel.
 */
export const triggerChannelDefinition: NodeDefinition<typeof triggerChannelParamsSchema> = {
  type: "trigger-channel",
  category: "trigger",
  typeVersion: 1,
  label: "Channel Trigger",
  description:
    "Starts a run when a customer message arrives on Messenger, Instagram, WhatsApp, TikTok, or the widget.",
  icon: "radio",
  paramSchema: triggerChannelParamsSchema,
  paramDefaults: () => ({ channel: "widget", label: "Channel" }),
  handles: { inputs: [], outputs: ["out"] },
};
