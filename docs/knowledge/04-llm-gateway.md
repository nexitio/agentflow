# LLM gateway — knowledge for the agent node

All LLM access goes through **`packages/shared/src/llm.ts`**, which speaks the
**OpenAI-compatible protocol** (`/v1/chat/completions`). AgentFlow bundles
OmniRoute as a self-hosted gateway, but OmniRoute is **not privileged**: an
operator who sets `LLM_BASE_URL` to their own endpoint must get an identical
product.

## Hard rules

- Never import an OmniRoute-specific SDK. Only the OpenAI-compatible protocol.
- Never link users to OmniRoute's dashboard — ours is the only UI.
- Zod at the LLM boundary: structured output is validated, tool call
  arguments are validated, and everything is treated as **untrusted** until it
  passes (invariant §4.5).

## What the client supports (Phase 4)

Implemented in `packages/shared/src/llm.ts`:

- **Chat completions**: `model`, `messages`, `temperature`, `max_tokens`,
  `response_format` (structured output `json_schema`).
- **Tool calling** — the agent node decides at runtime which tool to call, in
  what order (that's the whole point of the agent pattern). The client exposes
  `tools`, parses `tool_calls` responses, routes each call to the
  operator-wired tool runtime, and feeds results back as `tool` messages.
- **Embeddings** (`/embeddings`) for knowledge retrieval.
- Bounded timeout per call (`LLM_TIMEOUT_MS`, default 30s) — a stuck
  provider must not wedge the worker. Transport failures and unexpected
  response shapes become typed `ProviderError`s.

Not yet implemented (future): streaming for the widget/run inspector,
retries/backoff, and a `stop` parameter. The client falls back cleanly —
non-streaming is the only mode today.

## Prompting

### Structure of the agent prompt

1. **System**: role, personality, product knowledge (operator-configured),
   policies (escalate when…, refunds, human handoff).
2. **Data, clearly delimited and labelled** (invariant §4.5): retrieved
   knowledge chunks in a `<knowledge>` block, the conversation history in a
   `<history>` block, and the latest customer message in a `<message>` block.
   Delimiting keeps poisoned docs and crafted messages from being read as
   instructions.
3. **Tool descriptions**: only what the operator wired onto the agent node.
   Retrieved content and customer messages must never be able to add tools.

### Prompting practices

- Put instructions before data; put the most important instruction last.
- Ask for one thing at a time; prefer structured output over prose when the
  run needs a decision (e.g., `{ action: "answer" | "escalate" | "tool", ... }`).
- Few-shot examples from the eval corpus where the model hesitates.
- **Every prompt change runs `pnpm eval` and reports the delta.** Never ship a
  prompt change on vibes.

## Structured output

- Operator schemas travel through the workflow contract as **JSON** (the
  `responseSchema` param on the model sub-node); code-side schemas convert
  with `z.toJSONSchema`.
- When the provider supports `response_format: json_schema`, the agent requests
  it (only when no tools are wired — provider support varies). The agent
  **always** re-validates the final content with ajv
  (`validateJsonAgainstSchema`) before it leaves the node: provider
  enforcement is defense in depth, not the contract.
- A validation failure returns a typed `VALIDATION` error — the run shows the
  operator exactly what failed.

## Tool authority (invariant §4.5)

- Tool authority comes only from what the operator wired on the canvas.
- Nodes marked `destructive: true` require explicit operator opt-in on that
  node (e.g., "refund", "cancel order").
- Tool results come back as `tool` messages — validate their shape too; a
  hostile tool response must not be able to inject instructions either.

## Evals

`packages/nodes/src/agent/evals/` holds graded conversations per vertical
(e.g., e-commerce order support, SaaS billing, travel). See
`13-testing-and-evals.md` for the harness mechanics. The eval harness is what
protects the product's silent-regression failure mode — this class of product
regresses invisibly when a prompt changes.

## Cost and latency hygiene

- Token usage is recorded per run (invariant §4.9) — the client must return
  `usage` from the provider.
- Cap context: bound memory window, cap knowledge chunk count, cap tool result
  sizes. An unbounded prompt is a cost bug and a quality bug.
- Timeouts + retries with backoff; surface provider errors as typed run errors,
  not stack traces.

## Useful links

- OpenAI Chat Completions API reference: <https://platform.openai.com/docs/api-reference/chat>
- Function/tool calling: <https://platform.openai.com/docs/guides/function-calling>
- OmniRoute docs (protocol only — never link operators to it):
  <https://omniroute.ai> (verify current URL)
