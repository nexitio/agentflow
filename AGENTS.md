# AGENTS.md — AgentFlow

Instructions for AI coding agents (and humans) working in this repository.

**Project:** AgentFlow — self-hosted AI support agent builder.
Internal workspace packages use the `@agentflow/*` scope. Docker services,
volumes, and the CLI entrypoint all use lowercase `agentflow`. Never mix casing:
`AgentFlow` in prose and UI, `agentflow` everywhere a machine reads it.

---

## 1. What this is

AgentFlow is a **self-hosted, open-source AI support agent builder**. The operator
installs it on their own server with one command — the way Coolify installs — and
gets the whole stack: web UI, API, worker, Postgres, Redis, and a bundled LLM
gateway.

They then open the web UI and build support agents on a **React Flow canvas**,
n8n-style: drag nodes, connect them, publish. The published agent answers their
customers on Messenger, Instagram, WhatsApp, TikTok, and an embeddable widget.

**Who the operator is:** a technically comfortable business owner or a small
agency running agents for clients. They can point a domain at a VPS. They cannot
and will not read our source code to figure out why something broke.

**Two products in one repo, and both must be excellent:**

1. **The install.** One command, works on a clean Ubuntu box, upgrades without
   data loss. If installing is hard, nothing else matters.
2. **The canvas.** Building an agent must feel obvious within ten minutes.

**What we are not:** a hosted SaaS, a general workflow automation tool, or a
scripted decision-tree chatbot builder.

---

## 2. Architecture

```
apps/
  web/          Next.js (App Router) — dashboard + React Flow canvas
  api/          Hono — channel webhooks, widget SSE, REST for the UI
  worker/       BullMQ consumers — flow execution, ingestion, outbound sends
packages/
  db/           Drizzle schema + migrations
  engine/       Flow execution engine (graph traversal, run state)
  nodes/        Node registry: definitions + runtimes
  channels/     Channel adapters (meta, whatsapp, tiktok, widget)
  shared/       Zod schemas, types, errors, logger, crypto
deploy/
  docker-compose.yml
  install.sh
  Caddyfile
```

### Runtime services (what docker-compose brings up)

| Service     | Image             | Public?                                       |
| ----------- | ----------------- | --------------------------------------------- |
| `caddy`     | caddy             | Yes — only ingress, terminates TLS            |
| `web`       | built here        | Behind caddy                                  |
| `api`       | built here        | Behind caddy (`/api`, `/webhooks`, `/widget`) |
| `worker`    | built here        | No                                            |
| `postgres`  | pgvector/pgvector | No                                            |
| `redis`     | redis             | No                                            |
| `omniroute` | pinned tag        | No — internal network only                    |

**OmniRoute is bundled but not privileged.** It is reached only through
`packages/shared/src/llm.ts`, which speaks the OpenAI-compatible protocol. An
operator who sets `LLM_BASE_URL` to their own endpoint must get an identical
product. Never import an OmniRoute-specific SDK. Never link users to its
dashboard — ours is the only UI.

Pin the OmniRoute image to an exact tag. Never `:latest`. Upstream has shipped
releases that failed to boot; an unpinned tag turns that into our outage.

### Execution flow

```
Channel webhook → api: verify signature → dedupe → enqueue → 200 OK  (<100ms)
                                                    ↓
                            worker: load published flow → engine.run()
                                    → trigger node → agent node → tools
                                    → outbound adapter
```

---

## 3. Stack — decided, do not relitigate

- **TypeScript** strict. No `any`. No `@ts-ignore` without a comment and an issue link.
- **Next.js** (App Router) for `web`. **React Flow** for the canvas.
- **Hono** on **Node** for `api`. Not edge — one runtime across all services.
- **Postgres + pgvector** for relational data _and_ embeddings. No separate
  vector database. A self-hoster will not run one.
- **Drizzle ORM**. Migrations run automatically on container boot.
- **BullMQ + Redis** for queues.
- **Zod** at every boundary: HTTP input, webhook payloads, node params, LLM
  structured output, environment variables.
- **Caddy** for ingress and automatic TLS.
- **pnpm** workspaces, **Vitest**, **Biome**.

**Rejected:** any managed cloud service as a hard dependency. Every dependency
must run in a container on the operator's box. If a feature requires an external
SaaS, it is optional and the product works without it.

**Note:** UI should be very modern, animated, clean, user friendly and professional.

---

## 4. Hard invariants

Violating any of these is an incident, not a review comment.

### 4.1 The workflow JSON is a public contract

Saved flows are the operator's data and our export/import and template format.
Changing its shape without a migration breaks every existing agent and every
shared template.

- Every node carries `typeVersion`. Old versions keep executing forever.
- To change a node's params, ship a new `typeVersion` plus an upgrade function
  in `packages/nodes/src/<node>/migrations.ts`. Never mutate an existing version.
- The engine must load and run a flow exported six months ago.

### 4.2 Webhooks acknowledge fast and do nothing else

Verify signature → dedupe on the provider's message ID → enqueue → 200. Under
100ms. Meta disables webhook subscriptions after repeated slow or failed
deliveries, and it does so silently.

### 4.3 Delivery is at-least-once

Providers retry. Inbound is deduped on `(channel, external_message_id)` with a
unique index. Every outbound send carries an idempotency key. Assume any handler
runs twice.

### 4.4 Reply windows are checked before send

Every channel restricts unsolicited messaging. Call
`canSendFreeform(conversation)` before any outbound. Window closed means send an
approved template (WhatsApp) or route to the human inbox — never attempt the
send and swallow the error.

### 4.5 Retrieved content and customer messages are untrusted

A poisoned knowledge document or a crafted customer message must never invoke a
tool. Tool authority comes only from what the operator wired onto the agent node
in the canvas. Retrieved chunks and inbound text are delimited and labelled as
data in the prompt. Nodes marked `destructive: true` require explicit operator
opt-in on that node.

### 4.6 Credentials are encrypted at rest and never returned

Channel tokens and provider keys are encrypted with AES-256-GCM using
`ENCRYPTION_KEY` from the environment. The API returns credential _references_
and masked hints — never the plaintext, not even to an admin, not even over
localhost. Losing `ENCRYPTION_KEY` means losing every credential; the installer
generates it, prints it once, and the docs say to back it up.

### 4.7 Message bodies never enter logs

Log run IDs, node IDs, latencies, token counts, error codes. Never message text,
customer names, phone numbers, or email addresses. Use the redacting logger in
`packages/shared/src/logger.ts`. No raw `console.log` in `api` or `worker`.

### 4.8 Upgrades never lose data

Migrations are forward-only and idempotent. `docker compose pull && up -d` on a
box with a year of conversations must work unattended. Test every migration
against a seeded database before merge. Never drop a column in the same release
that stops writing to it — deprecate, then remove one release later.

### 4.9 Execution runs are persisted

Every flow run stores its input, per-node output, timings, token usage, and
errors. This is how operators debug their own agents, and it is the single
feature that makes a node-graph tool usable. Retention is configurable and
enforced by a pruning job — an unbounded run table will fill the operator's disk.

---

## 5. The node system

### Definition and runtime are separate files

```
packages/nodes/src/agent/
  definition.ts   # type, version, UI metadata, Zod param schema, ports
  runtime.ts      # execute(ctx, params) — no UI imports, ever
  migrations.ts   # typeVersion upgrades
```

`web` imports only definitions. `worker` imports only runtimes. A runtime that
imports React has broken the build for a reason worth understanding.

### Node categories

- **Trigger** — starts a run. One per flow. Channel triggers, widget, schedule, manual test.
- **Agent** — the LLM reasoning node. Has _attached_ sub-node ports.
- **Sub-node** — attaches to an agent, does not sit in the main sequence: Model, Memory, Knowledge, Tool.
- **Action** — HTTP request, send message, create ticket, run after the agent.
- **Logic** — condition, switch, wait, human handoff.

### The agent node pattern — read this before touching the canvas

Support agents are **not decision trees**. Do not build sequential
question-and-branch flows. The correct model, which n8n's AI nodes get right:

```
[WhatsApp Trigger] → [Agent] → [Send Reply]
                        │
              ┌─────────┼──────────┬─────────────┐
           [Model]  [Memory]  [Knowledge]  [Tool: Order Lookup]
                                           [Tool: Escalate]
```

Sub-nodes hang _below_ the agent and declare what it may use. The agent decides
at runtime which tool to call and in what order. Main-sequence edges describe
what happens _after_ the agent finishes, not how it thinks.

If a design requires the operator to draw every possible conversation path, the
design is wrong. Push it back.

### Node rules

- Params validated by Zod in the definition; the canvas form is generated from
  that schema. Do not hand-write param forms.
- Every node handles its own errors and returns a typed result. A thrown error
  fails the run — that must be a deliberate choice, not an oversight.
- New nodes need: definition, runtime, migrations stub, fixtures, tests, and an
  icon. All six, or it does not merge.

---

## 6. Data model rules

- `id` on every table: UUID v7 (time-sortable).
- **Every table carries `workspace_id`**, defaulting to the single built-in
  workspace. We are single-tenant today; agencies will ask for client separation,
  and retrofitting this later is a painful migration. Add the column now.
- Conversation identity key: `(channel, external_thread_id)`, unique. Do not
  shortcut this — cross-channel identity merging depends on it.
- Timestamps `timestamptz`, always UTC. Zone conversion happens in `web` only.
- Money is integer minor units plus a currency code. Never a float.
- Flows are versioned: an editable draft and an immutable published snapshot.
  Runs reference the published snapshot ID, so editing a flow never changes the
  history of past runs.

---

## 7. Channels

Each adapter in `packages/channels` implements one interface: normalize inbound
to `NormalizedMessage`, send outbound from `NormalizedReply`. The engine must
never branch on channel type — if it needs to, the adapter is leaking.

| Channel      | Transport                     | Window                                                                                         |
| ------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Messenger    | Meta Graph API                | 24h; human agent tag extends to 7 days                                                         |
| Instagram DM | Meta Graph API, same app      | Same as Messenger                                                                              |
| WhatsApp     | Meta Cloud API                | 24h customer service window; outside it needs an approved template                             |
| TikTok       | TikTok Business Messaging API | Reply window applies — verify current duration in TikTok's docs, do not trust a stale constant |
| Web widget   | Our SSE endpoint              | None                                                                                           |

Window durations live in `packages/channels/src/windows.ts` as named constants
with doc links. Never inline `86400000`.

**Self-hosted channel setup is our problem, not theirs.** Each channel needs a
publicly reachable HTTPS webhook with a valid certificate, plus Meta app review
or TikTok partner approval. The UI must show, per channel: the exact webhook URL
to paste, live verification status, and a plain-English error when it fails.
"Invalid OAuth token" is not an acceptable thing to show an operator.

---

## 8. Install and operations

The published install command is:

```bash
curl -fsSL https://get.agentflow.sh | bash
```

It serves `deploy/install.sh` unchanged — the script in this repo is the script
operators run, so it is reviewed with the same care as application code. Docker
resources are named `agentflow-web`, `agentflow-api`, `agentflow-worker`,
`agentflow-postgres`, `agentflow-redis`, `agentflow-omniroute`, `agentflow-caddy`;
volumes `agentflow_pgdata`, `agentflow_uploads`. Config lives at
`/opt/agentflow`.

`deploy/install.sh` must, on a clean Ubuntu VPS:

1. Install Docker if missing.
2. Generate `ENCRYPTION_KEY`, DB password, and admin credentials.
3. Write `.env`, pull pinned images, start the stack.
4. Provision TLS through Caddy for the operator's domain.
5. Print the URL, the admin login, and a loud warning to back up `ENCRYPTION_KEY`.

Rules:

- Idempotent. Re-running it never destroys data.
- Every image tag pinned in `docker-compose.yml`.
- Default resource footprint must fit a 2 vCPU / 4 GB VPS. Test it there.
- Ship `deploy/backup.sh` and `deploy/restore.sh`. Backups cover Postgres plus
  the uploads volume plus `.env`.
- Health endpoint per service. Compose uses real healthchecks, and `worker`
  waits for migrations to complete.

---

## 9. Code style

- Named exports only, except Next.js pages and layouts.
- Files `kebab-case.ts`; types and components `PascalCase`.
- Typed errors from `packages/shared/src/errors.ts`. Never throw strings. Never
  an empty catch.
- No barrel files — they break tree-shaking and create import cycles.
- Comments explain _why_. Delete commented-out code.
- No new dependency without justification in the PR. This ships as a Docker
  image an operator runs on their own hardware; every megabyte and every CVE is
  their problem.

---

## 10. Testing

Required, no exceptions:

- **Flow compatibility:** a corpus of exported flows in
  `packages/engine/fixtures/flows/` that must load and execute on every commit.
  This is the regression test that protects operator data.
- **Node round-trip:** every node's params serialize, deserialize, and validate.
- **typeVersion migrations:** old version loads, upgrades, produces the expected new params.
- **Channel adapters:** inbound normalization and outbound formatting against
  captured real payload fixtures.
- **Webhooks:** valid signature, invalid signature, duplicate delivery.
- **Install:** CI runs `install.sh` on a clean container, then an upgrade from
  the previous release tag, and asserts data survives.

**Agent evals.** `packages/nodes/src/agent/evals/` holds graded conversations
per vertical. Any change to a prompt, retrieval parameter, or tool schema runs
`pnpm eval` and reports the before/after delta in the PR. Never ship a prompt
change on vibes — this is how this class of product silently regresses.

---

## 11. Commands

```bash
pnpm dev                # all services via turbo
pnpm dev --filter api   # one service
pnpm db:generate        # generate migration from schema changes
pnpm db:migrate         # apply migrations
pnpm test
pnpm eval               # agent eval harness
pnpm lint               # biome check --write
pnpm typecheck          # tsc --noEmit across the workspace
pnpm deploy:test        # install.sh + upgrade against a clean container
```

`pnpm typecheck && pnpm test && pnpm lint` must pass before any commit.

---

## 12. Git and PRs

- Conventional commits: `feat(nodes): add whatsapp trigger`.
- One logical change per PR. Schema change plus feature is two PRs.
- PR description states what changed, why, how it was tested, and — for agent
  behaviour changes — the eval delta.
- Never commit `.env`, credentials, or unscrubbed customer payloads.
- Public releases are semver-tagged and carry an upgrade note if operator action
  is required.

---

## 13. When you are unsure

Do not guess. Stop and ask:

- Anything changing the workflow JSON shape or a node's existing `typeVersion`.
- Anything touching credential storage, `ENCRYPTION_KEY`, or PII handling.
- Adding a service to `docker-compose.yml` or a new external dependency.
- Any migration that drops a column or changes the conversation identity key.
- Giving a node the ability to take a destructive action.
- Behaviour that depends on a channel provider's current policy — check their
  live documentation rather than trusting a constant in our code.

Also stop and ask if a request pulls the canvas toward scripted decision trees,
or the install toward requiring a hosted service. Those two drifts kill the
product slowly, and they usually arrive as reasonable-sounding individual tickets.
