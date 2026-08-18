# AgentFlow — Project Plan

The complete plan for building AgentFlow: a self-hosted, open-source AI support
agent builder. One command install, a React Flow canvas, agents that answer on
Messenger, Instagram, WhatsApp, TikTok, and an embeddable widget.

**Two products in one repo, both must be excellent:**

1. **The install** — one command on a clean Ubuntu VPS, upgrades without data
   loss. If installing is hard, nothing else matters.
2. **The canvas** — building an agent feels obvious within ten minutes.

---

## 1. Non-negotiables (drives every phase)

- Every service runs in a container on the operator's box. No managed cloud
  service as a hard dependency.
- TypeScript strict, no `any`. `pnpm typecheck && pnpm test && pnpm lint` must
  pass before any commit.
- The workflow JSON is a public contract (`typeVersion` + migrations).
- Webhooks acknowledge in <100ms; delivery is at-least-once.
- Runs are persisted so operators can debug their own agents.
- Credentials encrypted at rest; message bodies never in logs.
- Single-tenant today, but **every table carries `workspace_id`** — agencies are
  coming.

## 2. Delivery order

Dependencies force the order: schema before engine, engine before canvas,
engine before channels, agent node before channel evals. Each phase ends
green (typecheck + tests + lint) and ships as its own PR set.

| Phase | Name | Builds on | Exit criteria |
| --- | --- | --- | --- |
| 0 | Foundations | — | monorepo boots, shared package ships, CI green |
| 1 | Data layer | 0 | migrations apply; all invariants in schema |
| 2 | Engine + node system | 1 | fixture flows load and run; runs persisted |
| 3 | Canvas | 0, 1 | operator builds + publishes an agent in the UI |
| 4 | Agent (LLM) node | 2 | agent node runs with model/memory/knowledge/tools; evals harness works |
| 5 | Channels | 1, 2 | end-to-end inbound → agent → outbound on all channels |
| 6 | Install & ops | all | one-command install + upgrade on a clean box, tested in CI |
| 7 | Hardening | all | evals, security pass, pruning, load test, docs |

---

## Phase 0 — Foundations

**Status: ✅ complete.** Workspace, shared package (logger/errors/crypto/env/llm/uuid), app shells, CI gate.

**Goal:** a workspace where the whole stack can be built without friction.

**Deliverables:**

- pnpm workspace with `apps/web`, `apps/api`, `apps/worker`, `packages/{db,engine,nodes,channels,shared}`.
- TypeScript strict config shared across packages; Biome; Vitest.
- `packages/shared`: redacting logger, typed errors, Zod schemas, crypto utils
  (AES-256-GCM helpers), env-var validation (Zod), LLM client stub.
- `pnpm dev` runs all services via turbo.
- CI runs typecheck, test, lint on every commit.

**Acceptance:** a fresh clone runs `pnpm dev`; a trivial end-to-end route
(web → api → db) works; logging redacts a sample message body.

---

## Phase 1 — Data layer

**Status: ✅ complete.** Drizzle schema (workspaces, flows draft+snapshot, conversations, messages, runs, credentials), migration runner, built-in workspace seed, integration tests against Postgres 18 in CI.

**Goal:** schema that encodes every data invariant.

**Deliverables:**

- Postgres 18 (`pgvector/pgvector` image) + Drizzle. IDs are UUIDv7
  (`uuidv7()` is built into Postgres 18).
- Every table carries `workspace_id` (default: single built-in workspace).
- Core tables:
  - `flows` — draft + immutable published snapshot; runs reference the snapshot id.
  - `conversations` — identity key `(channel, external_thread_id)` unique;
    the cross-channel identity merge depends on this exact key.
  - `messages` — dedupe key `(channel, external_message_id)` unique index.
  - `runs` — input, per-node output, timings, token usage, errors; retention
    column + pruning job hook.
  - `credentials` — encrypted blobs (AES-256-GCM), never returned.
- Migration workflow: forward-only, idempotent, auto-run on container boot.
  Deprecate-then-remove policy for columns.

**Acceptance:** `pnpm db:generate && pnpm db:migrate` from clean; unique-index
violations fire on duplicate webhook deliveries; a seeded database upgrades
unattended (tested in CI).

**Docs:** `06-postgres-drizzle.md`, `11-security-credentials.md`.

---

## Phase 2 — Engine + node system

**Status: ✅ complete.** Node registry (definition/runtime split, six pieces), engine with typeVersion upgrades, branch routing, timings/token sums/error policy, run persistence via `packages/db`, and a compatibility corpus incl. a legacy `typeVersion 1` flow.

**Goal:** flows load, execute, and record their own history.

**Deliverables:**

- Node registry with the six-piece rule per node: definition, runtime,
  migrations stub, fixtures, tests, icon.
- Node categories: Trigger, Agent (with attached sub-nodes), Sub-node (Model,
  Memory, Knowledge, Tool), Action, Logic.
- The **agent node pattern** is the core design: sub-nodes hang *below* the
  agent and declare what it may use; the model decides tool order at runtime.
  No scripted decision trees, ever.
- Engine: graph traversal, run state, per-node typed results, deliberate
  error policy (a thrown error fails the run — it must be a choice).
- Flow compatibility corpus in `packages/engine/fixtures/flows/` — exported
  flows that must load and execute on every commit (protects operator data).
- Runs persisted end-to-end (input → per-node output → timings → tokens → errors).

**Acceptance:** corpus executes; a flow exported "six months ago" still loads;
a node with old `typeVersion` runs via its migration.

**Docs:** `02-react-flow-canvas.md` (canvas-side shapes), `13-testing-and-evals.md`.

---

## Phase 3 — Canvas

**Status: ✅ complete.** React Flow editor in `apps/web` with a Zod-generated param form, palette from the definitions registry, draft autosave, publish-to-snapshot, and a manual-run panel with persisted run history. The remaining Phase 3 item — the per-channel setup screen — is folded into Phase 5, where the channel adapters land.

**Goal:** an operator builds and publishes an agent in the UI within ten minutes.

**Deliverables:**

- Next.js 16 (App Router) dashboard: flows list, editor, publish, run history.
- React Flow canvas (@xyflow/react): drag nodes, connect edges, sub-nodes
  docked under agents.
- Param forms **generated from the node's Zod schema** — no hand-written forms.
- Channel setup screen per channel: exact webhook URL to paste, live
  verification status, plain-English errors ("invalid OAuth token" is not
  acceptable).
- Publish creates the immutable published snapshot; runs use the snapshot.

**Acceptance:** new user builds a "welcome + FAQ" agent in under ten minutes,
publishes it, sees a manual test run execute with per-node output.

**Docs:** `01-nextjs-app-router.md`, `02-react-flow-canvas.md`, `08-zod-validation.md`.

---

## Phase 4 — Agent (LLM) node

**Status: ✅ complete.** Real LLM agent loop in `packages/nodes/src/agent/runtime.ts` — model/memory/knowledge/tool sub-nodes wired in (model + knowledge bumped to `typeVersion 2` with migrations), pgvector knowledge retrieval (`knowledge_chunks` + HNSW + repo), structured output via `z.toJSONSchema` + ajv, and the eval harness (`pnpm eval`, graded cases per vertical). Verified against a real harness run: 3/3 cases passed against a mock OpenAI-compatible provider on real Postgres — including the security case where a poisoned doc made the model attempt an un-wired tool and the runtime refused it. CI now runs the `pgvector/pgvector` image.

**Goal:** the reasoning core, grounded and safe.

**Deliverables:**

- `packages/shared/src/llm.ts` speaks the **OpenAI-compatible protocol** only.
  OmniRoute is bundled but not privileged; `LLM_BASE_URL` must yield an
  identical product. Never import an OmniRoute SDK.
- Model sub-node: provider/model config; structured output via Zod.
- Memory sub-node: conversation history (bounded, windowed).
- Knowledge sub-node: pgvector retrieval; chunks delimited and labelled as
  **data** in the prompt — never tool authority.
- Tool sub-node: operator-wired tools only; `destructive: true` requires
  explicit opt-in on the node; retrieved content + customer messages are
  untrusted (invariant §4.5).
- Eval harness: `packages/nodes/src/agent/evals/` — graded conversations per
  vertical; `pnpm eval` reports before/after deltas. **Never ship a prompt
  change on vibes.**

**Acceptance:** agent answers a support conversation using a knowledge doc and
a tool; a poisoned knowledge doc cannot invoke a tool; eval delta is reported
on prompt changes.

**Docs:** `04-llm-gateway.md`, `05-mcp.md` (optional MCP-powered tools).

---

## Phase 5 — Channels

**Goal:** real inbound → agent → outbound on every channel, safely.

**Deliverables:**

- One adapter interface: normalize inbound → `NormalizedMessage`, send outbound
  from `NormalizedReply`. The engine never branches on channel type.
- **Meta** (Messenger, Instagram, WhatsApp Cloud API): webhook signature
  verification, dedupe, enqueue, 200 <100ms; 24h window + human-agent tag
  (7 days) for Messenger/Instagram; WhatsApp templates outside the window.
- **TikTok** Business Messaging: reply window constant sourced from live docs
  (see `10-tiktok-widget-channels.md`), not a stale guess.
- **Widget**: our SSE endpoint, no reply window.
- Reply windows live in `packages/channels/src/windows.ts` as named constants
  with doc links. **Never inline `86400000`.**
- Every outbound send carries an idempotency key; `canSendFreeform(conversation)`
  is called before any send; window closed → approved template or human inbox,
  never attempt-and-swallow.

**Acceptance:** captured real-payload fixtures pass adapter tests; a duplicate
webhook delivery is a no-op; a closed-window outbound is refused with a
routing decision, not a swallowed error.

**Docs:** `09-meta-channels.md`, `10-tiktok-widget-channels.md`.

---

## Phase 6 — Install & operations

**Goal:** `curl -fsSL https://get.agentflow.sh | bash` works, idempotently.

**Deliverables:**

- `deploy/docker-compose.yml`: caddy, web, api, worker, postgres, redis,
  omniroute — every image tag **pinned** (never `:latest`; OmniRoute pins to an
  exact tag because upstream has shipped boot failures).
- Resource names `agentflow-*`, config at `/opt/agentflow`, volumes
  `agentflow_pgdata`, `agentflow_uploads`.
- `deploy/install.sh` (the script operators actually run — reviewed like
  application code): install Docker if missing → generate `ENCRYPTION_KEY`, DB
  password, admin credentials → write `.env` → pull pinned images → start stack →
  provision TLS via Caddy → print URL, login, and a loud backup warning.
- Real healthchecks per service; `worker` waits for migrations.
- `deploy/backup.sh` / `deploy/restore.sh`: Postgres + uploads volume + `.env`.
- Footprint fits a 2 vCPU / 4 GB VPS; tested there.

**Acceptance:** CI runs `install.sh` on a clean container, then an upgrade from
the previous release tag, and asserts data survives.

**Docs:** `12-docker-deploy.md`.

---

## Phase 7 — Hardening

**Goal:** production trust.

**Deliverables:**

- Full eval pass on all verticals; delta report.
- Security review: encryption at rest, redacting logger audit, webhook
  signature paths, untrusted-content boundaries, dependency CVEs.
- Run retention + pruning job verified (unbounded run table fills disks).
- Load test: webhook path under sustained traffic stays <100ms p95.
- Operator-facing docs: install, upgrade, backup/restore, channel setup,
  troubleshooting in plain English.

**Acceptance:** every AGENTS.md §4 invariant has a test that fails if violated.

---

## 3. Cross-cutting concerns

| Concern | Where it lands |
| --- | --- |
| Workflow JSON contract | `packages/nodes` migrations + `packages/engine` fixture corpus |
| At-least-once | unique index `(channel, external_message_id)`; idempotency keys on sends |
| Log hygiene | `packages/shared` redacting logger; lint rule bans raw `console.log` in api/worker |
| `workspace_id` | every Drizzle table, now (not retrofitted later) |
| Money/currency | integer minor units + currency code, never float |
| Time | `timestamptz`, UTC; zone conversion in `web` only |

## 4. Definition of done (whole project)

- [ ] `curl -fsSL https://get.agentflow.sh | bash` on a clean Ubuntu VPS brings
      up the full stack with TLS.
- [ ] Upgrade from the previous release preserves a year of conversations.
- [ ] A first-time operator publishes a working agent in under ten minutes.
- [ ] Agents answer on Messenger, Instagram, WhatsApp, TikTok, and the widget.
- [ ] Every flow run is inspectable (input, per-node output, timings, tokens, errors).
- [ ] `pnpm typecheck && pnpm test && pnpm lint && pnpm eval` all pass in CI.
