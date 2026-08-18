/**
 * Reply windows (AGENTS.md §4.4, §7) — the ONLY place window durations live,
 * as named constants with doc links. Never inline `86400000` anywhere else.
 *
 * Verified against live documentation (Aug 2026):
 * - Meta 24h standard window: https://developers.facebook.com/docs/messenger-platform/policy
 * - Meta human-agent tag extends to 7 days:
 *   https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags
 * - WhatsApp 24h customer service window + templates outside it:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 * - TikTok 48h reply window from the user's last message (Business Messaging
 *   API "Messaging limits" doc — mirrored at
 *   https://xmcsl.cn/project/tiktok-business-api/1854823717597185.html;
 *   primary portal business-api.tiktok.com/portal/docs is JS-rendered and
 *   not crawlable, so the constant is pinned to the mirror + SleekFlow's
 *   integration docs as corroboration):
 *   https://sleekflow.io/en-us/channels-integrations/tiktok-business-messaging
 * - Widget: no window — the customer is on our site.
 */

import type { Channel } from "@agentflow/shared/types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const MESSENGER_WINDOW_MS = 24 * HOUR_MS;
export const INSTAGRAM_WINDOW_MS = 24 * HOUR_MS;
/** Human-agent tag (MESSAGE_TAG, HUMAN_AGENT) extends Messenger/IG to 7 days. */
export const META_HUMAN_AGENT_EXTENSION_MS = 7 * DAY_MS;
export const WHATSAPP_WINDOW_MS = 24 * HOUR_MS;
export const TIKTOK_WINDOW_MS = 48 * HOUR_MS;
/** Widget outbound is unrestricted — a sentinel, never a real duration. */
export const WIDGET_WINDOW_MS = Number.POSITIVE_INFINITY;

/**
 * What an outbound send may do, decided BEFORE any provider call. Window
 * closed → send an approved template (WhatsApp) or route to the human
 * inbox — never attempt the send and swallow the error (§4.4).
 */
export type FreeformDecision =
  | { action: "send-freeform" }
  | { action: "send-template"; reason: string }
  | { action: "route-to-inbox"; reason: string };

/**
 * The single reply-window check. `lastCustomerMessageAt` is the conversation's
 * last inbound message time (the window restarts on each customer message).
 */
export function canSendFreeform(
  channel: Channel,
  lastCustomerMessageAt: Date,
  now: Date = new Date(),
): FreeformDecision {
  const elapsed = now.getTime() - lastCustomerMessageAt.getTime();
  switch (channel) {
    case "widget":
      return { action: "send-freeform" };
    case "messenger":
    case "instagram":
      if (elapsed <= MESSENGER_WINDOW_MS) {
        return { action: "send-freeform" };
      }
      // Outside 24h the human-agent tag still allows a human to reply for
      // up to 7 days — the automated agent routes to the human inbox.
      return {
        action: "route-to-inbox",
        reason: `Reply window closed ${Math.round(elapsed / HOUR_MS)}h ago — route to a human agent (MESSAGE_TAG HUMAN_AGENT covers up to ${META_HUMAN_AGENT_EXTENSION_MS / DAY_MS} days).`,
      };
    case "whatsapp":
      if (elapsed <= WHATSAPP_WINDOW_MS) {
        return { action: "send-freeform" };
      }
      return {
        action: "send-template",
        reason:
          "WhatsApp 24h customer service window closed — send an approved template or route to the human inbox.",
      };
    case "tiktok":
      if (elapsed <= TIKTOK_WINDOW_MS) {
        return { action: "send-freeform" };
      }
      return {
        action: "route-to-inbox",
        reason: `TikTok 48h reply window closed ${Math.round(elapsed / HOUR_MS)}h after the user's last message — route to the human inbox.`,
      };
  }
}
