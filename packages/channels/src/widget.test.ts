import { describe, expect, it, vi } from "vitest";

import { createWidgetAdapter } from "./widget";

describe("widget adapter", () => {
  it("normalizes the API-supplied inbound payload", () => {
    const adapter = createWidgetAdapter({ publish: vi.fn() });
    const event = adapter.normalizeInbound({
      conversationId: "conv-1",
      messageId: "msg-1",
      text: "hello from the embed",
      senderId: "visitor-42",
    });
    expect(event).toEqual({
      externalThreadId: "conv-1",
      externalMessageId: "msg-1",
      sender: { id: "visitor-42" },
      text: "hello from the embed",
      attachments: [],
    });
  });

  it("rejects malformed payloads (forged or broken embeds)", () => {
    const adapter = createWidgetAdapter({ publish: vi.fn() });
    expect(adapter.normalizeInbound({})).toBeNull();
    expect(adapter.normalizeInbound({ conversationId: "c" })).toBeNull();
    expect(adapter.normalizeInbound({ conversationId: "c", messageId: "m", text: 42 })).toBeNull();
  });

  it("routes outbound replies through the injected publisher", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const adapter = createWidgetAdapter({ publish });
    const reply = {
      id: "reply-1",
      workspaceId: "00000000-0000-7000-8000-000000000001",
      channel: "widget" as const,
      externalThreadId: "conv-1",
      idempotencyKey: "run-1:step-1",
      text: "Hi there!",
      attachments: [],
    };
    const result = await adapter.sendOutbound({}, reply);
    expect(result.providerMessageId).toBe("reply-1");
    expect(publish).toHaveBeenCalledWith("conv-1", reply);
  });
});
