/**
 * Cross-package contracts (AGENTS.md §7).
 *
 * Every channel adapter normalizes inbound to `NormalizedMessage` and sends
 * outbound from `NormalizedReply`; the engine never branches on channel type.
 * Conversation identity is `(channel, external_thread_id)` — do not shortcut.
 */

import { z } from "zod";

export const CHANNELS = ["messenger", "instagram", "whatsapp", "tiktok", "widget"] as const;

export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

const attachmentSchema = z.object({
  type: z.string(),
  url: z.string(),
});

export const normalizedMessageSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channel: channelSchema,
  externalThreadId: z.string().min(1),
  externalMessageId: z.string().min(1),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  text: z.string(),
  attachments: z.array(attachmentSchema).default([]),
  receivedAt: z.string().datetime(),
});
export type NormalizedMessage = z.infer<typeof normalizedMessageSchema>;

export const normalizedReplySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channel: channelSchema,
  externalThreadId: z.string().min(1),
  /** At-least-once guard: providers may retry; a keyed send is idempotent. */
  idempotencyKey: z.string().min(1),
  text: z.string(),
  attachments: z.array(attachmentSchema).default([]),
  inReplyToMessageId: z.string().optional(),
});
export type NormalizedReply = z.infer<typeof normalizedReplySchema>;
