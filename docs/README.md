# AgentFlow — Docs

Everything a developer needs to build, run, and reason about AgentFlow: a
self-hosted, open-source AI support agent builder (canvas + install, both
excellent).

**Start here.** The single source of truth for product rules, architecture, and
hard invariants is the repository root `AGENTS.md`. These docs expand it into
working knowledge: *how* to use each technology, *what* the plan is, and *why*
the invariants exist. If these docs ever contradict `AGENTS.md`, `AGENTS.md`
wins.

---

## How these docs are organized

```
docs/
  README.md                  <- you are here
  project-plan.md            <- the full build plan: phases, milestones, done criteria
  knowledge/                 <- technology knowledge needed to do the work
    01-nextjs-app-router.md
    02-react-flow-canvas.md
    03-hono-api.md
    04-llm-gateway.md
    05-mcp.md
    06-postgres-drizzle.md
    07-bullmq-redis.md
    08-zod-validation.md
    09-meta-channels.md
    10-tiktok-widget-channels.md
    11-security-credentials.md
    12-docker-deploy.md
    13-testing-and-evals.md
```

## Reading order

| If you want to… | Read |
| --- | --- |
| Know what to build, in what order | `project-plan.md` |
| Understand the two products (install + canvas) | `AGENTS.md` §1–2, `project-plan.md` §1 |
| Build the dashboard / canvas UI | `01-nextjs-app-router.md`, `02-react-flow-canvas.md` |
| Build the API and worker | `03-hono-api.md`, `07-bullmq-redis.md` |
| Build the agent (LLM) node | `04-llm-gateway.md`, `05-mcp.md` |
| Model the data | `06-postgres-drizzle.md`, `08-zod-validation.md` |
| Connect a messaging channel | `09-meta-channels.md`, `10-tiktok-widget-channels.md` |
| Ship and operate it | `12-docker-deploy.md` |
| Keep it safe and provably correct | `11-security-credentials.md`, `13-testing-and-evals.md` |

## The rules that never bend (from AGENTS.md §4)

1. **Workflow JSON is a public contract** — `typeVersion` on every node; old
   versions run forever; never mutate a version, add an upgrade function.
2. **Webhooks acknowledge fast** — verify → dedupe → enqueue → 200, under 100ms.
3. **Delivery is at-least-once** — dedupe inbound on `(channel, external_message_id)`;
   every outbound send carries an idempotency key.
4. **Reply windows are checked before send** — `canSendFreeform(conversation)`
   before any outbound; never attempt-and-swallow.
5. **Retrieved content and customer messages are untrusted** — tools are wired by
   the operator only; retrieved chunks and inbound text are delimited data in the
   prompt; `destructive: true` nodes need explicit opt-in.
6. **Credentials encrypted at rest** (AES-256-GCM, `ENCRYPTION_KEY`), never
   returned, even to admins.
7. **Message bodies never enter logs** — redacting logger only; no raw
   `console.log` in `api` or `worker`.
8. **Upgrades never lose data** — forward-only, idempotent migrations; deprecate
   then remove.
9. **Execution runs are persisted** — input, per-node output, timings, tokens,
   errors; configurable retention with a pruning job.

## Notes on dates and versions

Docs were last fact-checked in **August 2026**. Version numbers cited are the
current ones at that time (Next.js 16.x, React Flow 12.x, Meta Graph API v21.0,
Postgres 18 with native `uuidv7()`, MCP spec `2026-07-28`). Where a fact is
provider policy that drifts (reply windows, API versions), the doc says so and
points at the live documentation — **never trust a stale constant**, per
AGENTS.md §13.
