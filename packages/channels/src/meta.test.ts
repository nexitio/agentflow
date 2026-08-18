import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ProviderError } from "@agentflow/shared/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

import { instagramAdapter, messengerAdapter, verifyMetaSignature, whatsappAdapter } from "./meta";
import type { ChannelCredentials } from "./types";

const APP_SECRET = "test-app-secret";

function sign(rawBody: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8");
}

const CREDENTIALS: ChannelCredentials = {
  appSecret: APP_SECRET,
  accessToken: "page-token",
  phoneNumberId: "333333333333333",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyMetaSignature", () => {
  it("accepts a valid signature", () => {
    const raw = '{"entry":[]}';
    expect(verifyMetaSignature(APP_SECRET, raw, sign(raw))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const raw = '{"entry":[]}';
    expect(verifyMetaSignature(APP_SECRET, `${raw} `, sign(raw))).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyMetaSignature(APP_SECRET, "{}", undefined)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, "{}", "sha1=abc")).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, "{}", "sha256=zzz")).toBe(false);
  });

  it("adapter.verifyWebhook throws ForbiddenError on mismatch", () => {
    expect(() =>
      messengerAdapter.verifyWebhook(CREDENTIALS, {
        rawBody: '{"entry":[]}',
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
      }),
    ).toThrow(ProviderError);
  });
});

describe("Meta inbound normalization", () => {
  it("normalizes a Messenger customer message and filters echoes/receipts", () => {
    const event = messengerAdapter.normalizeInbound(JSON.parse(fixture("meta-messenger")));
    expect(event).toEqual({
      externalThreadId: "999888777",
      externalMessageId: "mid.1787000000123:abcdef1234",
      sender: { id: "999888777" },
      text: "Where is my order?",
      attachments: [],
    });
  });

  it("normalizes a WhatsApp text message and ignores status callbacks", () => {
    const event = whatsappAdapter.normalizeInbound(JSON.parse(fixture("meta-whatsapp")));
    expect(event).toEqual({
      externalThreadId: "15551112222",
      externalMessageId: "wamid.ABGGFlM5abcdef",
      sender: { id: "15551112222" },
      text: "How long do refunds take?",
      attachments: [],
    });
  });

  it("returns null for payloads with no customer message", () => {
    expect(whatsappAdapter.normalizeInbound({ entry: [{ changes: [] }] })).toBeNull();
    expect(messengerAdapter.normalizeInbound({ entry: [] })).toBeNull();
    expect(messengerAdapter.normalizeInbound({ nope: true })).toBeNull();
  });

  it("maps Messenger attachments to type/url", () => {
    const event = messengerAdapter.normalizeInbound({
      entry: [
        {
          messaging: [
            {
              sender: { id: "s1" },
              message: {
                mid: "m1",
                text: "",
                attachments: [
                  { type: "image", payload: { url: "https://cdn.example.test/x.jpg" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(event?.attachments).toEqual([{ type: "image", url: "https://cdn.example.test/x.jpg" }]);
  });
});

describe("Meta outbound", () => {
  it("sends Messenger replies via /me/messages with the page token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"recipient_id":"999888777","message_id":"mid.outbound1"}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await messengerAdapter.sendOutbound(CREDENTIALS, {
      id: "reply-1",
      workspaceId: "00000000-0000-7000-8000-000000000001",
      channel: "messenger",
      externalThreadId: "999888777",
      idempotencyKey: "run-1:step-2",
      text: "Your order is shipped.",
      attachments: [],
    });

    expect(result.providerMessageId).toBe("mid.outbound1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("graph.facebook.com/v21.0/me/messages");
    expect(url).toContain("access_token=page-token");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      recipient: { psid: "999888777" },
      messaging_type: "RESPONSE",
      message: { text: "Your order is shipped." },
    });
  });

  it("sends WhatsApp replies to /{phone-number-id}/messages with a Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"messages":[{"id":"wamid.outbound2"}]}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await whatsappAdapter.sendOutbound(CREDENTIALS, {
      id: "reply-2",
      workspaceId: "00000000-0000-7000-8000-000000000001",
      channel: "whatsapp",
      externalThreadId: "15551112222",
      idempotencyKey: "run-2:step-1",
      text: "Refunds take 5 days.",
      attachments: [],
    });

    expect(result.providerMessageId).toBe("wamid.outbound2");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("graph.facebook.com/v21.0/333333333333333/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer page-token");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "15551112222",
      type: "text",
      text: { body: "Refunds take 5 days." },
    });
  });

  it("throws a typed ProviderError when Meta returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"bad"}}',
      }),
    );
    await expect(
      messengerAdapter.sendOutbound(CREDENTIALS, {
        id: "reply-3",
        workspaceId: "00000000-0000-7000-8000-000000000001",
        channel: "messenger",
        externalThreadId: "999888777",
        idempotencyKey: "k",
        text: "hi",
        attachments: [],
      }),
    ).rejects.toThrow(ProviderError);
  });

  it("fails fast with a typed error when the token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      instagramAdapter.sendOutbound(
        {},
        {
          id: "r",
          workspaceId: "00000000-0000-7000-8000-000000000001",
          channel: "instagram",
          externalThreadId: "t",
          idempotencyKey: "k",
          text: "hi",
          attachments: [],
        },
      ),
    ).rejects.toThrow(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
