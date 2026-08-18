import { describe, expect, it } from "vitest";

import {
  canSendFreeform,
  MESSENGER_WINDOW_MS,
  TIKTOK_WINDOW_MS,
  WHATSAPP_WINDOW_MS,
} from "./windows";

const NOW = new Date("2026-08-18T12:00:00Z");

describe("canSendFreeform", () => {
  it("always allows the widget", () => {
    const ancient = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(canSendFreeform("widget", ancient, NOW)).toEqual({ action: "send-freeform" });
  });

  it("allows messenger/instagram inside the 24h window and routes outside", () => {
    const inside = new Date(NOW.getTime() - MESSENGER_WINDOW_MS + 1_000);
    expect(canSendFreeform("messenger", inside, NOW)).toEqual({ action: "send-freeform" });
    expect(canSendFreeform("instagram", inside, NOW)).toEqual({ action: "send-freeform" });

    const outside = new Date(NOW.getTime() - MESSENGER_WINDOW_MS - 1_000);
    const decision = canSendFreeform("messenger", outside, NOW);
    expect(decision.action).toBe("route-to-inbox");
    if (decision.action === "route-to-inbox") {
      expect(decision.reason).toContain("human agent");
      expect(decision.reason).toContain("7 days");
    }
  });

  it("routes WhatsApp to templates outside the 24h window", () => {
    const inside = new Date(NOW.getTime() - WHATSAPP_WINDOW_MS + 1_000);
    expect(canSendFreeform("whatsapp", inside, NOW)).toEqual({ action: "send-freeform" });
    const template = canSendFreeform(
      "whatsapp",
      new Date(NOW.getTime() - WHATSAPP_WINDOW_MS - 1_000),
      NOW,
    );
    expect(template.action).toBe("send-template");
  });

  it("allows TikTok inside the 48h window and routes outside it", () => {
    const inside = new Date(NOW.getTime() - TIKTOK_WINDOW_MS + 1_000);
    expect(canSendFreeform("tiktok", inside, NOW)).toEqual({ action: "send-freeform" });
    const outside = canSendFreeform(
      "tiktok",
      new Date(NOW.getTime() - TIKTOK_WINDOW_MS - 1_000),
      NOW,
    );
    expect(outside.action).toBe("route-to-inbox");
    if (outside.action === "route-to-inbox") {
      expect(outside.reason).toContain("48h");
    }
  });

  it("uses the exact boundary (at the window edge freeform still applies)", () => {
    expect(
      canSendFreeform("messenger", new Date(NOW.getTime() - MESSENGER_WINDOW_MS), NOW).action,
    ).toBe("send-freeform");
    expect(canSendFreeform("tiktok", new Date(NOW.getTime() - TIKTOK_WINDOW_MS), NOW).action).toBe(
      "send-freeform",
    );
  });
});
