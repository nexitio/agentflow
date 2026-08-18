import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../errors";
import { chatCompletion, embed, validateJsonAgainstSchema } from "../llm";

const BASE_URL = "https://llm.example.test/v1";

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  body: unknown;
}): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatCompletion", () => {
  it("parses a plain completion and usage", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      body: {
        id: "cmpl-1",
        model: "some-model",
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });

    const result = await chatCompletion({
      baseUrl: BASE_URL,
      apiKey: "sk-test",
      model: "some-model",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("hello");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage?.totalTokens).toBe(15);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("parses tool calls and their arguments", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        id: "cmpl-2",
        model: "some-model",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "lookup_order", arguments: '{"orderId":"ORD-42"}' },
                },
              ],
            },
          },
        ],
      },
    });

    const result = await chatCompletion({
      baseUrl: BASE_URL,
      apiKey: "sk-test",
      model: "some-model",
      messages: [{ role: "user", content: "where is my order" }],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: "call_1",
      name: "lookup_order",
      arguments: { orderId: "ORD-42" },
    });
  });

  it("tolerates malformed tool-call arguments as empty data", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        id: "cmpl-3",
        model: "some-model",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "call_1", function: { name: "lookup_order", arguments: "not json" } },
              ],
            },
          },
        ],
      },
    });

    const result = await chatCompletion({
      baseUrl: BASE_URL,
      apiKey: "sk-test",
      model: "some-model",
      messages: [],
    });
    expect(result.toolCalls[0]?.arguments).toEqual({});
  });

  it("maps non-2xx responses to ProviderError", async () => {
    mockFetchOnce({ ok: false, status: 429, body: { error: "rate limited" } });
    await expect(
      chatCompletion({ baseUrl: BASE_URL, apiKey: "sk-test", model: "m", messages: [] }),
    ).rejects.toThrow(ProviderError);
  });

  it("maps unexpected response shapes to ProviderError", async () => {
    mockFetchOnce({ ok: true, body: { nope: true } });
    await expect(
      chatCompletion({ baseUrl: BASE_URL, apiKey: "sk-test", model: "m", messages: [] }),
    ).rejects.toThrow(ProviderError);
  });

  it("rejects on network failure with ProviderError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    await expect(
      chatCompletion({ baseUrl: BASE_URL, apiKey: "sk-test", model: "m", messages: [] }),
    ).rejects.toThrow(ProviderError);
  });
});

describe("embed", () => {
  it("returns positional vectors and usage", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      body: {
        model: "emb-model",
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        usage: { prompt_tokens: 9, total_tokens: 9 },
      },
    });

    const result = await embed({
      baseUrl: BASE_URL,
      apiKey: "sk-test",
      model: "emb-model",
      inputs: ["refund policy", "shipping times"],
    });

    expect(result.vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result.usage?.totalTokens).toBe(9);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/embeddings`);
  });

  it("rejects empty input lists before any request", async () => {
    const fetchMock = mockFetchOnce({ ok: true, body: { model: "m", data: [] } });
    await expect(
      embed({ baseUrl: BASE_URL, apiKey: "sk-test", model: "m", inputs: [] }),
    ).rejects.toThrow(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps unexpected shapes to ProviderError", async () => {
    mockFetchOnce({ ok: true, body: { nope: true } });
    await expect(
      embed({ baseUrl: BASE_URL, apiKey: "sk-test", model: "m", inputs: ["x"] }),
    ).rejects.toThrow(ProviderError);
  });
});

describe("validateJsonAgainstSchema", () => {
  const orderSchema = {
    type: "object",
    required: ["orderId", "status"],
    properties: {
      orderId: { type: "string" },
      status: { type: "string" },
    },
  };

  it("accepts conforming JSON", () => {
    const result = validateJsonAgainstSchema({ orderId: "ORD-1", status: "shipped" }, orderSchema);
    expect(result.ok).toBe(true);
  });

  it("rejects non-conforming JSON with instance paths", () => {
    const result = validateJsonAgainstSchema({ orderId: "ORD-1" }, orderSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes("status"))).toBe(true);
    }
  });

  it("reports a malformed operator schema as a validation failure", () => {
    const result = validateJsonAgainstSchema({}, { type: "definitely-not-a-type" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Schema itself is invalid");
    }
  });
});
