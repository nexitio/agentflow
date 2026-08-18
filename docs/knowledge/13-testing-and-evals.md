# Testing + agent evals — knowledge for keeping the product provably correct

AGENTS.md §10 sets the required test surface. This doc is the working
knowledge for each test type, and how the **eval harness** protects the
product's most silent failure mode.

## Required test surface (AGENTS.md §10)

| Test | What it protects | Where it lives |
| --- | --- | --- |
| Flow compatibility corpus | Operator data — exported flows must load + execute on every commit | `packages/engine/fixtures/flows/` |
| Node round-trip | Every node's params serialize, deserialize, validate | `packages/nodes/*/__tests__` |
| typeVersion migrations | Old versions load, upgrade, produce expected new params | `packages/nodes/*/migrations.test.ts` |
| Channel adapters | Inbound normalization + outbound formatting against captured real payloads | `packages/channels/*/__tests__` |
| Webhooks | Valid signature, invalid signature, duplicate delivery | `apps/api` tests |
| Install | `install.sh` on a clean container + upgrade from previous release; data survives | `pnpm deploy:test` (CI) |

Every node needs all six pieces or it does not merge: definition, runtime,
migrations stub, fixtures, tests, icon (AGENTS.md §5).

## Practical guidance per test type

### Flow corpus

- Corpus flows are *exports* — they exercise the engine exactly like operator
  data. Add one when a new node type ships and when a node's behavior changes.
- Include at least one flow with an old `typeVersion` so migrations run in the
  regression path, and one "six months ago" shape flow (the contract test,
  invariant §4.1).

### Node round-trip + migrations

- Round-trip: serialize params → deserialize → validate → assert equality.
- Migration tests: load an old-version fixture → run the upgrade function →
  assert the new params are exactly what the new definition expects. A node
  that can't migrate its own previous version is a breaking change.

### Channel adapters

- Fixtures are **captured real payloads**, scrubbed (never commit customer
  data, AGENTS.md §12).
- Assert: inbound normalization fields (`channel`, `external_thread_id`,
  `external_message_id`, sender, text), outbound formatting, idempotency key
  plumbing, and `canSendFreeform` window decisions at boundary times (e.g.,
  23h59m vs 24h01m since last message).

### Webhooks

- Valid signature passes; invalid signature → 401/403 with typed error;
  duplicate delivery → dedupe no-op, still 200, still fast.
- Assert the handler never calls the LLM or the outbound adapter (it enqueues
  only) — this is the <100ms invariant, test it with a timing assertion.

### Install

- CI runs `install.sh` on a clean container, then upgrades from the previous
  release tag, asserting data survives (AGENTS.md §10). This is the invariant
  §4.8 test — an unattended upgrade with a year of conversations.

## The eval harness (`pnpm eval`)

**Agent evals** live in `packages/nodes/src/agent/evals/` — graded
conversations per vertical. Any change to a prompt, retrieval parameter, or
tool schema runs `pnpm eval` and reports the **before/after delta in the PR**.
Never ship a prompt change on vibes — this is how this class of product
silently regresses (AGENTS.md §10).

### How to build the harness

- **Graded conversations**: per vertical (e-commerce support, SaaS billing,
  travel, …), a set of scripted customer turns with a rubric per turn
  (e.g., "retrieved the order status", "did not invent a refund policy",
  "escalated on refund request").
- **Deterministic grading**: where possible, grade on structured outputs
  (agent's `{action, ...}` decision) rather than free text; free-text turns
  get rubric scores with a fixed rubric and, ideally, a second-model judge —
  but keep the judge stable across runs so deltas are comparable.
- **Deterministic seed / model pin**: evals must run against a pinned model
  and temperature so a delta is caused by *your change*, not noise.
- **Output**: a table of per-vertical scores, before/after, and a fail
  threshold — a prompt change that drops a vertical below threshold blocks the
  PR.
- Keep the eval corpus small enough to run in CI time (minutes, not hours) but
  broad enough to catch regressions per vertical.

### What must trigger an eval run

- Any change to agent prompts (system, knowledge framing, tool descriptions).
- Retrieval parameter changes (chunk size, top-k, similarity threshold).
- Tool schema changes (a worse tool description degrades agent behavior).
- Model/memory window changes.

## Useful links

- Vitest: <https://vitest.dev>
- Biome (lint/format): <https://biomejs.dev>
