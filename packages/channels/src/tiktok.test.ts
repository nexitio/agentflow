import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ProviderError } from "@agentflow/shared/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tiktokAdapter, verifyTikTokSignature } from "./tiktok";
import type { ChannelCredentials } from "./types";

const CLIENT_SECRET = "tiktok-client-secret";
const NOW = new Date("2026-08-18T12:00:00Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

function sign(rawBody: string, timestamp = TIMESTAMP, secret = CLIENT_SECRET): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},s=${signature}`;
}

function fixture(): string {
  return readFileSync(fileURLToPath(new URL("../fixtures/tiktok.json", import.meta.url)), "utf8");
}

const CREDENTIALS: ChannelCredentials = {
  clientSecret: CLIENT_SECRET,
  tiktokAccessToken: "tk-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTikTokSignature", () => {
  it("accepts a valid signature with a fresh timestamp", () => {
    const raw = '{"app_id":"1"}';
    expect(verifyTikTokSignature(CLIENT_SECRET, raw, sign(raw), NOW)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const raw = '{"app_id":"1"}';
    expect(verifyTikTokSignature(CLIENT_SECRET, `${raw} `, sign(raw), NOW)).toBe(false);
  });

  it("rejects a stale timestamp (replay protection)", () => {
    const raw = '{"app_id":"1"}';
    const stale = sign(raw, Math.floor(NOW.getTime() / 1000) - 600);
    expect(verifyTikTokSignature(CLIENT_SECRET, raw, stale, NOW)).toBe(false);
  });

  it("rejects missing/malformed headers", () => {
    expect(verifyTikTokSignature(CLIENT_SECRET, "{}", undefined, NOW)).toBe(false);
    expect(verifyTikTokSignature(CLIENT_SECRET, "{}", "t=abc,s=zzz", NOW)).toBe(false);
  });

  it("adapter throws ForbiddenError on mismatch", () => {
    expect(() =>
      tiktokAdapter.verifyWebhook(CREDENTIALS, {
        rawBody: '{"app_id":"1"}',
        headers: { "tiktok-signature": sign('{"app_id":"2"}') },
      }),
    ).toThrow(ProviderError);
  });
});

describe("TikTok inbound normalization", () => {
  it("normalizes a business messaging event from the fixture", () => {
    const event = tiktokAdapter.normalizeInbound(JSON.parse(fixture()));
    expect(event).toEqual({
      externalThreadId: "tt_open_4455667788",
      externalMessageId: "tt_msg_7890123456",
      sender: { id: "tt_open_4455667788", name: "TikTok Customer" },
      text: "Do you ship internationally?",
      attachments: [],
    });
  });

  it("returns null for unrecognized payloads", () => {
    expect(tiktokAdapter.normalizeInbound({})).toBeNull();
    expect(tiktokAdapter.normalizeInbound({ event: { msg_id: "m1" } })).toBeNull();
    expect(tiktokAdapter.normalizeInbound({ event: { sender: { open_id: "o1" } } })).toBeNull();
  });
});

describe("TikTok outbound", () => {
  it("sends a text reply with a Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"data":{"message_id":"tt_out_1"}}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await tiktokAdapter.sendOutbound(CREDENTIALS, {
      id: "reply-1",
      workspaceId: "00000000-0000-7000-8000-000000000001",
      channel: "tiktok",
      externalThreadId: "tt_open_4455667788",
      idempotencyKey: "run-1:step-1",
      text: "Yes, we ship worldwide.",
      attachments: [],
    });

    expect(result.providerMessageId).toBe("tt_out_1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("message/send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tk-token");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      to_user: { open_id: "tt_open_4455667788" },
      message_type: "text",
      content: { text: "Yes, we ship worldwide." },
    });
  });

  it("fails fast when the token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      tiktokAdapter.sendOutbound(
        {},
        {
          id: "r",
          workspaceId: "00000000-0000-7000-8000-000000000001",
          channel: "tiktok",
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
