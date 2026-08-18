/**
 * LLM client — the only way AgentFlow talks to a model (AGENTS.md §2).
 *
 * Speaks the OpenAI-compatible `/chat/completions` protocol against a
 * configurable base URL. OmniRoute is bundled but NOT privileged: an operator
 * who sets LLM_BASE_URL to their own endpoint gets an identical product.
 * Never import an OmniRoute-specific SDK.
 *
 * Phase 0 ships the client + types; the agent node (Phase 4) wires it to
 * Model/Memory/Knowledge/Tool sub-nodes with Zod-validated structured output.
 */

import Ajv from "ajv";
import { z } from "zod";

import { ProviderError } from "./errors";

/**
 * Convert a Zod schema to JSON Schema for the provider's structured-output
 * mode (response_format json_schema). The operator's own schemas travel as
 * JSON through the workflow contract — Zod stays at the code boundary.
 */
export function zodSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "openapi-3.0" });
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that called tools. */
  toolCalls?: ToolCall[];
  /** Present on tool messages; links the result back to the call. */
  toolCallId?: string;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema for the tool's arguments — derived from the node's Zod schema. */
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Structured output — provider returns JSON matching this schema. */
  structuredOutput?: { name: string; jsonSchema: Record<string, unknown> };
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  model: string;
}

const completionSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
    return {};
  } catch {
    // Tool arguments arrive as untrusted strings; a malformed payload is a
    // data problem, not a crash.
    return {};
  }
}

async function requestJson(
  baseUrl: string,
  path: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new ProviderError(`LLM provider returned ${response.status}`, {
        provider: baseUrl,
        status: response.status,
        details: { status: response.status, errorBody: errorBody.slice(0, 500) },
      });
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ProviderError(`LLM provider timed out after ${timeoutMs}ms.`, {
        provider: baseUrl,
        cause: error,
      });
    }
    throw new ProviderError("LLM provider request failed.", { provider: baseUrl, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate arbitrary JSON against an operator-supplied JSON Schema (the
 * agent-model node's `responseSchema` travels as JSON through the workflow
 * contract). The model's output is untrusted — we verify before it reaches
 * the canvas or the customer.
 */
export function validateJsonAgainstSchema(
  data: unknown,
  jsonSchema: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  try {
    const validate = ajv.compile(jsonSchema);
    if (validate(data)) {
      return { ok: true, value: data };
    }
    const errors = (validate.errors ?? []).map((error) =>
      error.instancePath
        ? `${error.instancePath} ${error.message ?? "is invalid"}`
        : (error.message ?? "is invalid"),
    );
    return { ok: false, errors };
  } catch (error) {
    // A malformed operator schema is a configuration error — surface it as
    // validation failure with a clear message, not a crash.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`Schema itself is invalid: ${message}`] };
  }
}

export interface EmbeddingRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Texts to embed. The OpenAI-compatible protocol accepts a single string or
   * an array; we always send an array so callers get positional vectors back.
   */
  inputs: string[];
  timeoutMs?: number;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: { promptTokens: number; totalTokens: number } | null;
  model: string;
}

const embeddingSchema = z.object({
  model: z.string(),
  data: z.array(z.object({ embedding: z.array(z.number()) })),
  usage: z.object({ prompt_tokens: z.number(), total_tokens: z.number() }).optional(),
});

/**
 * Embed texts via the provider's `/embeddings` endpoint. Used by the
 * knowledge sub-node: queries are embedded at runtime, documents are embedded
 * at ingestion. Failures are typed ProviderErrors like every other LLM call.
 */
export async function embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
  const { baseUrl, apiKey, model, inputs, timeoutMs = 30_000 } = request;
  if (inputs.length === 0) {
    throw new ProviderError("Embedding request must contain at least one input.", {
      provider: baseUrl,
    });
  }
  const response = await requestJson(
    baseUrl,
    "/embeddings",
    apiKey,
    { model, input: inputs },
    timeoutMs,
  );
  const parsed = embeddingSchema.safeParse(response);
  if (!parsed.success) {
    throw new ProviderError("LLM provider returned an unexpected embeddings shape.", {
      provider: baseUrl,
      details: {
        issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
      },
    });
  }
  return {
    vectors: parsed.data.data.map((entry) => entry.embedding),
    usage: parsed.data.usage
      ? {
          promptTokens: parsed.data.usage.prompt_tokens,
          totalTokens: parsed.data.usage.total_tokens,
        }
      : null,
    model: parsed.data.model,
  };
}

export async function chatCompletion(
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    temperature,
    maxTokens,
    timeoutMs = 30_000,
    structuredOutput,
  } = request;

  try {
    const response = await requestJson(
      baseUrl,
      "/chat/completions",
      apiKey,
      {
        model,
        messages,
        ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(structuredOutput !== undefined
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: structuredOutput.name,
                  schema: structuredOutput.jsonSchema,
                },
              },
            }
          : {}),
      },
      timeoutMs,
    );

    const parsed = completionSchema.safeParse(response);
    if (!parsed.success) {
      throw new ProviderError("LLM provider returned an unexpected response shape.", {
        provider: baseUrl,
        details: {
          issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
        },
      });
    }

    const choice = parsed.data.choices[0];
    if (choice === undefined) {
      throw new ProviderError("LLM provider returned no choices.", { provider: baseUrl });
    }

    return {
      content: choice.message.content,
      toolCalls: (choice.message.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: parseToolCallArguments(toolCall.function.arguments),
      })),
      usage: parsed.data.usage
        ? {
            promptTokens: parsed.data.usage.prompt_tokens,
            completionTokens: parsed.data.usage.completion_tokens,
            totalTokens: parsed.data.usage.total_tokens,
          }
        : null,
      model: parsed.data.model,
    };
  } catch (error) {
    // requestJson already wraps transport failures in typed ProviderErrors.
    throw error instanceof ProviderError
      ? error
      : new ProviderError("LLM provider request failed.", { provider: baseUrl, cause: error });
  }
}
