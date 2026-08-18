/**
 * Channel adapter registry (AGENTS.md §7) — lookup table, not a barrel.
 * The widget adapter needs an injected publisher (our SSE machinery), so it
 * is constructed where the delivery path lives (api/worker), not here.
 */

import type { Channel } from "@agentflow/shared/types";
import { instagramAdapter, META_ADAPTERS, messengerAdapter, whatsappAdapter } from "./meta";
import { tiktokAdapter } from "./tiktok";
import type { ChannelAdapter } from "./types";

const adapters: Record<Channel, ChannelAdapter | undefined> = {
  ...META_ADAPTERS,
  tiktok: tiktokAdapter,
  widget: undefined,
};

/** Provider adapters (widget is injected by the delivery path). */
export function getProviderAdapter(channel: Channel): ChannelAdapter | undefined {
  return adapters[channel];
}

export { instagramAdapter, messengerAdapter, tiktokAdapter, whatsappAdapter };
