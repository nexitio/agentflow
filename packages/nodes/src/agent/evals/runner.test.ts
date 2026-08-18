/**
 * Eval runner unit test — grading logic against a scripted LLM. The three
 * shipped cases must pass when the model behaves, and unmet expectations
 * must flip the verdict to fail.
 */

import type { Db } from "@agentflow/db/client";
import {
  type ChatCompletionRequest,
  type ChatCompletionResult,
  chatCompletion,
  embed,
} from "@agentflow/shared/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agentflow/db/repo/knowledge", () => ({
  upsertChunks: vi.fn(),
  deleteSource: vi.fn(),
  searchChunks: vi.fn(),
}));

vi.mock("@agentflow/shared/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentflow/shared/llm")>();
  return { ...actual, chatCompletion: vi.fn(), embed: vi.fn() };
});

import { searchChunks } from "@agentflow/db/repo/knowledge";
import { runEvals } from "./runner";

const chatCompletionMock = vi.mocked(chatCompletion);
const embedMock = vi.mocked(embed);
const searchChunksMock = vi.mocked(searchChunks);

const dbStub = {} as unknown as Db;

function completion(overrides: Partial<ChatCompletionResult> = {}): ChatCompletionResult {
  return {
    content: null,
    toolCalls: [],
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    model: "gpt-4o-mini",
    ...overrides,
  };
}

function lastUserContent(request: ChatCompletionRequest): string {
  const last = request.messages[request.messages.length - 1];
  return typeof last?.content === "string" ? last.content : "";
}

beforeEach(() => {
  vi.stubEnv("LLM_BASE_URL", "https://llm.example.test/v1");
  vi.stubEnv("LLM_API_KEY", "sk-test");
  chatCompletionMock.mockReset();
  embedMock.mockReset();
  embedMock.mockResolvedValue({
    vectors: [[0.1, 0.2, 0.3]],
    usage: { promptTokens: 3, totalTokens: 3 },
    model: "emb-1",
  });
  searchChunksMock.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"status":"shipped"}',
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runEvals", () => {
  it("grades the three cases as passing when the model behaves", async () => {
    chatCompletionMock.mockImplementation(async (request) => {
      const text = lastUserContent(request);
      if (text.includes("ORD-123")) {
        return completion({
          toolCalls: [{ id: "c1", name: "lookup_order", arguments: { orderId: "ORD-123" } }],
        });
      }
      if (text.includes("ORD-9")) {
        return completion({
          toolCalls: [{ id: "c2", name: "delete_everything", arguments: { all: true } }],
        });
      }
      // After the un-wired attempt came back "not available", the model
      // falls back to the real wired tool.
      if (text.includes("not available")) {
        return completion({
          toolCalls: [{ id: "c3", name: "lookup_order", arguments: { orderId: "ORD-9" } }],
        });
      }
      if (text.includes('"shipped"')) {
        return completion({ content: "Your order is shipped and arrives in 2-5 business days." });
      }
      if (text.includes('"processing"')) {
        return completion({ content: "Your order ORD-9 is processing." });
      }
      return completion({ content: "Refunds take 5 business days." });
    });

    const summary = await runEvals({
      llm: { baseUrl: "https://llm.example.test/v1", apiKey: "sk-test", embeddingModel: "emb-1" },
      db: dbStub,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);

    const security = summary.results.find((r) => r.caseId === "security-injection-defense");
    expect(security?.verdict).toBe("pass");
    // The poisoned tool was attempted by the model but never executed.
    expect(security?.toolCalls).toEqual(["lookup_order"]);
  });

  it("flags unmet expectations as failures", async () => {
    chatCompletionMock.mockImplementation(async (request) => {
      const text = lastUserContent(request);
      if (text.includes("ORD-123")) {
        return completion({
          toolCalls: [{ id: "c1", name: "lookup_order", arguments: { orderId: "ORD-123" } }],
        });
      }
      if (text.includes("ORD-9")) {
        return completion({
          toolCalls: [{ id: "c2", name: "delete_everything", arguments: { all: true } }],
        });
      }
      // Never answers with the refund policy — mustInclude fails.
      return completion({ content: "I don't know." });
    });

    const summary = await runEvals({
      llm: { baseUrl: "https://llm.example.test/v1", apiKey: "sk-test", embeddingModel: "emb-1" },
      db: dbStub,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    const refunds = summary.results.find((r) => r.caseId === "retail-refund-policy");
    expect(refunds?.verdict).toBe("fail");
    expect(refunds?.notes.some((note) => note.includes('"5 business"'))).toBe(true);
    expect(summary.failed).toBeGreaterThan(0);
  });

  it("skips knowledge cases without a database instead of weakening them", async () => {
    delete process.env.DATABASE_URL;
    chatCompletionMock.mockResolvedValue(completion({ content: "Refunds take 5 business days." }));
    const summary = await runEvals({
      llm: { baseUrl: "https://llm.example.test/v1", apiKey: "sk-test", embeddingModel: "emb-1" },
    });
    expect(summary.skipped).toBe(3);
    expect(summary.results.every((r) => r.verdict === "skipped")).toBe(true);
  });
});
