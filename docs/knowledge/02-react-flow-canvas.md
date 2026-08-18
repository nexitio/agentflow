# React Flow — knowledge for the canvas

The canvas is built with **React Flow** (`@xyflow/react`), current line v12.x.
It is an n8n-style node editor: drag nodes, connect ports, attach sub-nodes.

## Package and setup

- Package: `@xyflow/react` (the v12 package name; `react-flow-renderer` and
  `react-flow` are old names). Import its CSS: `@xyflow/react/dist/style.css`.
- It is a **client-side** library — the canvas page must be a `"use client"`
  component, and the flow must be serialized to JSON and re-hydrated once on
  the client (avoids hydration mismatch on node positions).
- Server-side: only the node *definitions* (UI metadata, Zod param schemas)
  are imported from `packages/nodes` — never runtimes.

## Core concepts

- **Nodes** — `{ id, type, position, data }`. Custom node types map a string
  type to a React component via `nodeTypes` on the `<ReactFlow>` component.
- **Edges** — connections between handles. Main-sequence edges describe what
  happens *after* the agent finishes, not how it thinks.
- **Handles** — `Handle` components (`source`/`target`) rendered inside custom
  nodes; they are the draggable connection points.
- **Sub-nodes** — in AgentFlow, sub-nodes (Model, Memory, Knowledge, Tool)
  attach **below** an agent node rather than sitting in the main sequence.
  Implement as a distinct connection mode or a docked panel on the agent node
  — never as main-sequence edges. The design rule: *if a design requires the
  operator to draw every possible conversation path, the design is wrong.*
- **Controls** — `<Controls />`, `<MiniMap />`, `<Background />` for the
  standard editor chrome.

## The agent node pattern (critical)

```
[WhatsApp Trigger] → [Agent] → [Send Reply]
                        │
              ┌─────────┼──────────┬─────────────┐
           [Model]  [Memory]  [Knowledge]  [Tool: Order Lookup]
                                           [Tool: Escalate]
```

- Support agents are **not decision trees**. Do not build sequential
  question-and-branch flows.
- Sub-nodes declare what the agent *may* use; the agent decides at runtime
  which tool to call and in what order.
- The canvas must make this obvious within ten minutes — enforce the layout
  pattern in the editor (agent node gets a sub-node dock), don't just document
  it.

## Form generation from Zod

- Every node's params are validated by Zod in its definition; the canvas form
  is generated from that schema. No hand-written param forms.
- Map schema types to controls: `z.string()` → text input, `z.enum([...])` →
  select, `z.number()` → number input, `z.boolean()` → toggle,
  `z.array()` → list editor, `z.record()/z.any()` JSON → code editor.
- Validate on save with the same schema; surface errors inline in plain English.

## State management

- Keep the editable flow JSON in a store (React state or a small store like
  Zustand — check what's already in the repo before adding a dependency).
- React Flow's `onNodesChange`/`onEdgesChange` with `applyNodeChanges` /
  `applyEdgeChanges` is the idiomatic controlled approach.
- Autosave draft → explicit **Publish** → the API stores an immutable
  published snapshot; runs reference the snapshot id.

## Persistence and the public contract

- The workflow JSON is a **public contract** (AGENTS.md §4.1). The canvas must
  never write a shape that isn't what the engine reads.
- Every node carries `typeVersion`; the editor renders the latest version but
  must still load old versions (migrations live in
  `packages/nodes/src/<node>/migrations.ts`).
- When in doubt about changing node params: ship a new `typeVersion` + upgrade
  function. Never mutate an existing version.

## Gotchas

- **`nodeTypes`/`edgeTypes` must be defined outside the component** (or
  memoized) or React Flow re-creates all nodes on every render → cursor
  jank/flicker.
- **Performance**: a flow with hundreds of nodes needs `onlyRenderVisibleElements`
  and `nodeOrigin` tweaks; keep default node size small.
- **Hydration**: don't compute positions on the server; store them in the
  serialized JSON and let the client render them.
- **Custom handles**: label source/target handles so the operator understands
  main-sequence vs. sub-node ports.

## Useful links

- React Flow docs: <https://reactflow.dev>
- What's new (v12.x): <https://reactflow.dev/whats-new>
- Examples: <https://reactflow.dev/examples>
