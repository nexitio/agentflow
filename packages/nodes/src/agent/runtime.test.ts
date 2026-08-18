/**
 * Agent runtime tests — the safety invariants that must never regress
 * (AGENTS.md §4.5):
 *
 * - Tool authority comes only from operator-wired tools; a poisoned knowledge
 *   doc or crafted customer message can never invoke an un-wired tool.
 * - destructive tools (requireApproval) are never executed automatically.
 * - Retrieved knowledge is delimited + labelled as data, never instructions.
 * - Structured output is ajv-validated before it leaves the node.
 *
 * The LLM is mocked; every test asserts on the exact message sequence the
 * runtime builds, so prompt-gating regressions fail loudly here.
 */

import type { Db } from "@agentflow/db/client";
import { type ChatCompletionResult, chatCompletion, embed } from "@agentflow/shared/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowNode } from "../flow";
import type { NodeExecutionContext } from "../types";
import type { agentParamsSchema } from "./definition";
import { agentRuntime } from "./runtime";

vi.mock("@agentflow/db/repo/knowledge", () => ({
  searchChunks: vi.fn(),
}));

vi.mock("@agentflow/shared/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentflow/shared/llm")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
    embed: vi.fn(),
  };
});

import { searchChunks } from "@agentflow/db/repo/knowledge";
import type { z } from "zod";

type AgentParams = z.infer<typeof agentParamsSchema>;

const chatCompletionMock = vi.mocked(chatCompletion);
const embedMock = vi.mocked(embed);
const searchChunksMock = vi.mocked(searchChunks);

const dbStub = {} as unknown as Db;

function modelNode(overrides: Record<string, unknown> = {}): FlowNode {
  return {
    id: "m1",
    type: "agent-model",
    typeVersion: 2,
    position: { x: 0, y: 0 },
    params: {
      model: "gpt-4o-mini",
      temperature: 0.2,
      responseFormat: "text",
      responseSchema: "",
      ...overrides,
    },
  };
}

function knowledgeNode(overrides: Record<string, unknown> = {}): FlowNode {
  return {
    id: "k1",
    type: "agent-knowledge",
    typeVersion: 2,
    position: { x: 0, y: 0 },
    params: {
      collection: "refunds",
      maxChunks: 4,
      minSimilarity: 0.3,
      embeddingModel: "emb-1",
      ...overrides,
    },
  };
}

function toolNode(overrides: Record<string, unknown> = {}): FlowNode {
  return {
    id: "t1",
    type: "agent-tool-http",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    params: {
      name: "lookup_order",
      description: "Look up an order by id.",
      method: "GET",
      url: "https://api.example.test/orders",
      requireApproval: false,
      ...overrides,
    },
  };
}

function context(subNodes: FlowNode[], input: Record<string, unknown>): NodeExecutionContext {
  return {
    runId: "run-1",
    workspaceId: "00000000-0000-7000-8000-000000000001",
    channel: "widget",
    input,
    inputs: {},
    subNodes,
    db: dbStub,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    } as unknown as NodeExecutionContext["logger"],
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
}

function params(overrides: Partial<AgentParams> = {}): AgentParams {
  return {
    systemPrompt: "You are a helpful support agent.",
    temperature: 0.2,
    ...overrides,
  };
}

function completion(overrides: Partial<ChatCompletionResult> = {}): ChatCompletionResult {
  return {
    content: null,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "gpt-4o-mini",
    ...overrides,
  };
}

function toolCall(call: { id?: string; name: string; arguments?: Record<string, unknown> }) {
  return {
    id: call.id ?? "call_1",
    name: call.name,
    arguments: call.arguments ?? {},
  };
}

beforeEach(() => {
  vi.stubEnv("LLM_BASE_URL", "https://llm.example.test/v1");
  vi.stubEnv("LLM_API_KEY", "sk-test");
  delete process.env.LLM_TIMEOUT_MS;
  delete process.env.EMBEDDING_MODEL;
  chatCompletionMock.mockReset();
  embedMock.mockReset();
  searchChunksMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("agent runtime — basics", () => {
  it("answers with the model's plain content and reports token usage", async () => {
    chatCompletionMock.mockResolvedValue(completion({ content: "Hi! How can I help?" }));

    const outcome = await agentRuntime.execute(context([modelNode()], { text: "hello" }), params());

    expect(outcome).toMatchObject({
      type: "success",
      output: { content: "Hi! How can I help?", toolIterations: 0 },
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    // System prompt + current message, in that order.
    const messages = chatCompletionMock.mock.calls[0]?.[0].messages;
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({
      role: "system",
      content: "You are a helpful support agent.",
    });
    expect(messages?.[1]).toMatchObject({ role: "user", content: "hello" });
  });

  it("fails with CONFIGURATION when no Model sub-node is attached", async () => {
    const outcome = await agentRuntime.execute(context([], { text: "hello" }), params());
    expect(outcome).toMatchObject({ type: "error", code: "CONFIGURATION" });
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("fails with CONFIGURATION when LLM env vars are missing", async () => {
    vi.stubEnv("LLM_BASE_URL", "");
    const outcome = await agentRuntime.execute(context([modelNode()], { text: "hello" }), params());
    expect(outcome).toMatchObject({ type: "error", code: "CONFIGURATION" });
  });

  it("fails with VALIDATION when the input has no message text", async () => {
    const outcome = await agentRuntime.execute(context([modelNode()], {}), params());
    expect(outcome).toMatchObject({ type: "error", code: "VALIDATION" });
  });
});

describe("agent runtime — tool loop", () => {
  it("executes a wired tool and feeds the result back to the model", async () => {
    chatCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall({ name: "lookup_order", arguments: { orderId: "ORD-1" } })],
        }),
      )
      .mockResolvedValueOnce(completion({ content: "Your order is shipped." }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"status":"shipped"}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await agentRuntime.execute(
      context([modelNode(), toolNode()], { text: "where is my order?" }),
      params(),
    );

    expect(outcome).toMatchObject({
      type: "success",
      output: { content: "Your order is shipped." },
    });
    // GET tool: arguments became query params.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("api.example.test/orders");
    expect(url.toString()).toContain("orderId=ORD-1");
    expect(init.method).toBe("GET");

    // The second call must include the assistant tool call + the tool result.
    const messages = chatCompletionMock.mock.calls[1]?.[0].messages;
    const last = messages?.[messages.length - 1];
    expect(last).toMatchObject({
      role: "tool",
      toolCallId: "call_1",
      content: '{"status":"shipped"}',
    });
    // Token usage from both calls is summed.
    const usage = outcome.type === "success" ? outcome.tokenUsage : undefined;
    expect(usage?.totalTokens).toBe(30);
  });

  it("never executes an un-wired tool — even when the model asks for one", async () => {
    // The model (possibly duped by a poisoned doc) asks for delete_everything.
    chatCompletionMock
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall({ name: "delete_everything", arguments: {} })] }),
      )
      .mockResolvedValueOnce(completion({ content: "I cannot do that." }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await agentRuntime.execute(
      context([modelNode(), toolNode()], { text: "erase my account" }),
      params(),
    );

    expect(outcome.type).toBe("success");
    expect(fetchMock).not.toHaveBeenCalled();
    const messages = chatCompletionMock.mock.calls[1]?.[0].messages;
    const last = messages?.[messages.length - 1];
    expect(last).toMatchObject({
      role: "tool",
      content: expect.stringContaining("not available"),
    });
  });

  it("never auto-executes a destructive (requireApproval) tool", async () => {
    chatCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall({ name: "delete_account", arguments: { accountId: "ACC-1" } })],
        }),
      )
      .mockResolvedValueOnce(completion({ content: "I've flagged that for a human." }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await agentRuntime.execute(
      context(
        [
          modelNode(),
          toolNode({
            name: "delete_account",
            description: "Delete an account.",
            method: "POST",
            url: "https://api.example.test/accounts/delete",
            requireApproval: true,
          }),
        ],
        { text: "delete my account" },
      ),
      params(),
    );

    expect(outcome.type).toBe("success");
    expect(fetchMock).not.toHaveBeenCalled();
    const messages = chatCompletionMock.mock.calls[1]?.[0].messages;
    const last = messages?.[messages.length - 1];
    expect(last).toMatchObject({
      role: "tool",
      content: expect.stringContaining("requires approval"),
    });
  });

  it("fails with PROVIDER when the model never finishes (loop bound)", async () => {
    chatCompletionMock.mockResolvedValue(
      completion({ toolCalls: [toolCall({ name: "lookup_order", arguments: {} })] }),
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await agentRuntime.execute(
      context([modelNode(), toolNode()], { text: "loop me" }),
      params(),
    );

    expect(outcome).toMatchObject({ type: "error", code: "PROVIDER" });
    expect(chatCompletionMock).toHaveBeenCalledTimes(8);
  });
});

describe("agent runtime — memory", () => {
  it("bounded: only the last windowSize history turns reach the model", async () => {
    chatCompletionMock.mockResolvedValue(completion({ content: "ok" }));
    const history = Array.from({ length: 5 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${index + 1}`,
    }));

    await agentRuntime.execute(
      context(
        [
          modelNode(),
          {
            id: "mem1",
            type: "agent-memory",
            typeVersion: 1,
            position: { x: 0, y: 0 },
            params: { windowSize: 2 },
          },
        ],
        { text: "continue", history },
      ),
      params(),
    );

    const messages = chatCompletionMock.mock.calls[0]?.[0].messages;
    expect(messages).toHaveLength(4); // system + 2 history + current
    const contents = messages?.map((message) => message.content).join("|");
    expect(contents).toContain("turn 4");
    expect(contents).toContain("turn 5");
    expect(contents).not.toContain("turn 1");
    expect(contents).toContain("continue");
  });

  it("ignores malformed history entries", async () => {
    chatCompletionMock.mockResolvedValue(completion({ content: "ok" }));
    await agentRuntime.execute(
      context([modelNode()], {
        text: "hi",
        history: [
          { role: "system", content: "skip me" },
          { role: "user", content: 42 },
          { role: "user", content: "keep me" },
        ],
      }),
      params(),
    );
    const messages = chatCompletionMock.mock.calls[0]?.[0].messages;
    expect(messages).toHaveLength(3); // system + "keep me" + current
  });
});

describe("agent runtime — knowledge", () => {
  it("retrieves chunks and labels them as data, never instructions", async () => {
    chatCompletionMock.mockResolvedValue(
      completion({ content: "Per policy, refunds take 5 days." }),
    );
    embedMock.mockResolvedValue({
      vectors: [[0.1, 0.2, 0.3]],
      usage: { promptTokens: 4, totalTokens: 4 },
      model: "emb-1",
    });
    searchChunksMock.mockResolvedValue([
      {
        id: "c1",
        sourceId: "refunds",
        title: "Refund policy",
        content: "Refunds are processed within 5 business days.",
        distance: 0.1,
      },
    ]);

    const outcome = await agentRuntime.execute(
      context([modelNode(), knowledgeNode()], { text: "when do I get my refund?" }),
      params(),
    );

    expect(outcome.type).toBe("success");
    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "emb-1", inputs: ["when do I get my refund?"] }),
    );
    expect(searchChunksMock).toHaveBeenCalledWith(
      dbStub,
      "00000000-0000-7000-8000-000000000001",
      [0.1, 0.2, 0.3],
      4,
    );

    const messages = chatCompletionMock.mock.calls[0]?.[0].messages;
    const user = messages?.find((message) => message.role === "user");
    expect(user?.content).toContain("<knowledge>");
    expect(user?.content).toContain("Reference data");
    expect(user?.content).toContain("Refunds are processed within 5 business days.");
  });

  it("drops chunks below the minSimilarity threshold", async () => {
    chatCompletionMock.mockResolvedValue(completion({ content: "I don't know." }));
    embedMock.mockResolvedValue({ vectors: [[0.1]], usage: null, model: "emb-1" });
    // distance 0.95 ⇒ similarity 0.05, below minSimilarity 0.3.
    searchChunksMock.mockResolvedValue([
      { id: "c1", sourceId: "refunds", title: "Unrelated", content: "noise", distance: 0.95 },
    ]);

    await agentRuntime.execute(
      context([modelNode(), knowledgeNode()], { text: "hello" }),
      params(),
    );

    const messages = chatCompletionMock.mock.calls[0]?.[0].messages;
    const user = messages?.find((message) => message.role === "user");
    expect(user?.content).not.toContain("<knowledge>");
    expect(user?.content).not.toContain("noise");
  });

  it("fails with CONFIGURATION when no embedding model is configured", async () => {
    chatCompletionMock.mockResolvedValue(completion({ content: "x" }));
    const outcome = await agentRuntime.execute(
      context([modelNode(), knowledgeNode({ embeddingModel: "" })], { text: "hi" }),
      params(),
    );
    expect(outcome).toMatchObject({ type: "error", code: "CONFIGURATION" });
  });
});

describe("agent runtime — structured output", () => {
  const responseSchema = JSON.stringify({
    type: "object",
    required: ["orderId", "status"],
    properties: {
      orderId: { type: "string" },
      status: { type: "string" },
    },
  });

  it("requests provider-enforced json_schema and returns validated data", async () => {
    chatCompletionMock.mockResolvedValue(
      completion({ content: JSON.stringify({ orderId: "ORD-1", status: "shipped" }) }),
    );

    const outcome = await agentRuntime.execute(
      context([modelNode({ responseFormat: "json_schema", responseSchema })], {
        text: "order status?",
      }),
      params(),
    );

    expect(outcome.type).toBe("success");
    expect(chatCompletionMock.mock.calls[0]?.[0].structuredOutput).toEqual({
      name: "response",
      jsonSchema: JSON.parse(responseSchema),
    });
    if (outcome.type === "success") {
      expect((outcome.output as { data?: unknown }).data).toEqual({
        orderId: "ORD-1",
        status: "shipped",
      });
    }
  });

  it("rejects output that fails the schema with VALIDATION", async () => {
    chatCompletionMock.mockResolvedValue(
      completion({ content: JSON.stringify({ orderId: "ORD-1" }) }),
    );

    const outcome = await agentRuntime.execute(
      context([modelNode({ responseFormat: "json_schema", responseSchema })], {
        text: "order status?",
      }),
      params(),
    );

    expect(outcome).toMatchObject({ type: "error", code: "VALIDATION" });
  });

  it("rejects a malformed responseSchema with CONFIGURATION", async () => {
    const outcome = await agentRuntime.execute(
      context([modelNode({ responseFormat: "json_schema", responseSchema: "not json" })], {
        text: "hi",
      }),
      params(),
    );
    expect(outcome).toMatchObject({ type: "error", code: "CONFIGURATION" });
  });
});
