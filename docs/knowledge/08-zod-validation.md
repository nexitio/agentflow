# Zod — knowledge for every boundary

**Zod** is AgentFlow's validation layer, and it is used at *every* boundary:
HTTP input, webhook payloads, node params, LLM structured output, environment
variables, job payloads, outbound replies.

## The boundaries

| Boundary | What Zod validates | Where |
| --- | --- | --- |
| HTTP input | query, body, params, headers | `apps/api` route handlers |
| Webhook payloads | raw provider payloads (untrusted!) | `packages/channels` adapters → `NormalizedMessage` |
| Node params | the node's param schema (from its definition) | `packages/nodes/*/definition.ts` |
| Node outputs | typed results per node | `packages/nodes/*/runtime.ts` |
| LLM output | structured responses, tool-call arguments | `packages/shared/src/llm.ts`, agent node |
| Job payloads | enqueued → consumed | `apps/api` → `apps/worker` |
| Environment variables | config at boot; fail fast with a clear message | `packages/shared` |
| Outbound | `NormalizedReply` → channel adapter | `packages/channels` |

## Rules (AGENTS.md §3, §4)

- **Never trust inbound data.** A poisoned knowledge doc, a crafted customer
  message, or a malformed webhook must be validated and *delimited*, never
  executed.
- **Schema and form are one thing.** The canvas param form is generated from
  the node's Zod schema — do not hand-write forms (AGENTS.md §5). Changing the
  schema changes the form; that's the contract.
- **Typed errors.** Validation failures produce typed errors from
  `packages/shared/src/errors.ts`, never thrown strings, never empty catches.
- Zod also validates **structured LLM output**: the model's JSON is untrusted
  input to the system.

## Practical patterns

```ts
// One schema per boundary, exported from the definition
const OrderLookupParams = z.object({
  orderIdPath: z.string().min(1),
  statuses: z.array(z.enum(["open", "shipped", "refunded"])).optional(),
});

// Parsing style — `safeParse`, never `parse` in hot paths
const result = OrderLookupParams.safeParse(raw);
if (!result.success) {
  return nodeError(result.error); // typed error, not a throw
}
```

- Use `.safeParse` at runtime boundaries; reserve `.parse` for boot-time config
  where failing fast is the point.
- `z.enum` over strings for anything finite (channel types, node categories,
  run status) — typos become type errors.
- **Type inference**: `z.infer<typeof X>` keeps param types and schemas in
  lockstep. No hand-written duplicate types.

## Schema evolution (workflow JSON is a public contract)

- Node params belong to a `typeVersion`. Changing a schema for existing flows
  is a **breaking change** to operator data — ship a new `typeVersion` + an
  upgrade function in `packages/nodes/src/<node>/migrations.ts`
  (AGENTS.md §4.1). Never mutate an existing version.
- The engine must load and run a flow exported six months ago. The corpus in
  `packages/engine/fixtures/flows/` regression-tests exactly this.

## Gotchas

- **Error messages for operators must be plain English.** A Zod error is a
  great developer tool and a terrible operator message. Map validation
  failures to human-readable field errors in the UI; log the Zod details (no
  message bodies, invariant §4.7).
- **`z.any()`/`z.unknown()`** only at true JSON boundaries (e.g., a
  knowledge-doc chunk) — then immediately narrow with a purpose-built schema.
- **Performance**: a webhook handler that runs several `safeParse` calls is
  still fast; but don't validate the same body three times in one request
  path — validate once, hand the typed value down.

## Useful links

- Zod docs: <https://zod.dev>
