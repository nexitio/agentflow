# Next.js (App Router) — knowledge for `apps/web`

AgentFlow's dashboard and canvas live in `apps/web`, a Next.js 16 app using the
App Router. Current stable line as of Aug 2026: **Next.js 16.x** (released Oct
2025), Turbopack as the default bundler, React 19.x, and the newer caching
model (Cache Components).

## What the app contains

- **Dashboard** — flows list, run history, settings, channel setup screens.
- **Canvas** — the React Flow editor (see `02-react-flow-canvas.md`).
- **Server-rendered UI + client-side interactive bits.** Default to Server
  Components; mark interactive islands with `"use client"`.

## Key patterns to use

### Route structure (App Router)

```
app/
  layout.tsx            # root layout: shell, auth guard
  (dashboard)/
    flows/
      page.tsx          # flows list (server component, reads DB via API or direct query)
      [flowId]/
        page.tsx        # canvas page
        publish/route.ts
    runs/
      [runId]/page.tsx  # run inspector (per-node output, timings)
    channels/
      messenger/page.tsx   # per-channel setup + verification status
      instagram/page.tsx
      whatsapp/page.tsx
      tiktok/page.tsx
      widget/page.tsx
  api/                  # if needed; prefer proxying to apps/api for business logic
```

Rules that matter here:

- **Only Next.js pages/layouts may use default exports** (AGENTS.md §9).
- Named exports everywhere else.
- Zone/currency conversion happens **only in `web`** — the API always emits UTC
  `timestamptz` and integer minor units.

### Server Components vs. client components

- Data fetching, auth checks, initial render → Server Components.
- Canvas, node param forms, live status polling → `"use client"` components.
- Never put heavy client logic in the layout; keep the shell server-rendered.

### Data fetching

- The API is Hono (see `03-hono-api.md`). `web` calls it over HTTP or direct
  DB reads via `packages/db` for internal pages. Prefer one consistent path:
  use the API for anything that mutates, direct read models are fine for
  server components that render lists.
- Validate everything that crosses the boundary with Zod (`08-zod-validation.md`).

### Forms from Zod schemas

The canvas generates node param forms from the node definition's Zod schema —
no hand-written forms (AGENTS.md §5). Practical approach:

1. Schema lives in `packages/nodes/src/<node>/definition.ts`.
2. `web` renders controls from `zod-to-form`-style mapping (type → input):
   string → text, enum → select, number → number input, boolean → toggle,
   array → list editor, JSON → code editor.
3. On save, validate with the same schema before sending to the API.

### Streaming

- Run progress on the run inspector can stream via SSE (the API already uses
  SSE for the widget) or poll. Prefer SSE for live run updates.
- Use `ReadableStream`/`AsyncIterable` responses in Route Handlers for
  streaming — but keep it minimal; a poll endpoint is often simpler and fine.

## Gotchas

- **Canvas needs client rendering** — React Flow is a client library; the
  canvas page must be a client component, and hydration errors happen if the
  server and client render different node positions. Serialize the flow JSON,
  hydrate once.
- **Caching model changed in Next 16** — Cache Components and the new defaults
  differ from Next 13/14 mental models. Read the Next 16 release notes before
  tuning caching; don't sprinkle `cache: 'no-store'` from muscle memory.
- **Turbopack is default** — custom webpack configs from old tutorials won't
  apply. Check `next.config` docs for the Turbopack equivalents.
- **Never import node runtimes into `web`** — the web app imports only node
  *definitions* (`packages/nodes`), never runtimes. A runtime importing React
  breaks the worker build; the split is enforced by design.
- **Images/fonts** — Next Image optimization runs at request time; for a
  self-hosted box, keep it configured so it doesn't eat CPU on a 2 vCPU VPS.

## Useful links

- Next.js 16 release notes: <https://nextjs.org/blog/next-16>
- App Router docs: <https://nextjs.org/docs/app>
- React 19 docs: <https://react.dev>
