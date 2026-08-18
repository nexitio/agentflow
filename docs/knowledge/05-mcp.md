# Model Context Protocol (MCP) — knowledge and integration plan

**Model Context Protocol** is the open protocol (introduced by Anthropic,
Nov 2024) for connecting LLM applications to external tools and data. The
current spec is **`2026-07-28`** — a major revision that turned MCP from a
stateful, bidirectional protocol into a **stateless, request/response HTTP
protocol**. Tier 1 SDKs (TypeScript, Python, Go, C#) all speak it; Rust is in
beta.

## Why MCP matters to AgentFlow

AgentFlow's agent node already has a **Tool** sub-node concept: the operator
wires tools onto the agent in the canvas, and the agent decides at runtime
which to call. MCP is the ecosystem standard for exposing exactly that kind of
capability (a server exposes tools; a client calls them). Two integration
options:

1. **MCP as a Tool source** — a Tool sub-node can be backed by an MCP server
   (the operator configures a server URL/command; the node lists its tools and
   the agent calls them). This turns AgentFlow into a consumer of the MCP
   ecosystem (thousands of servers) with one integration.
2. **MCP as an export surface** — expose an AgentFlow flow as an MCP server so
   other agent apps can call the published agent as a tool.

For v1, option 1 is the higher-value, lower-risk add. Option 2 is a natural
later milestone. Both must respect the same invariants: tool authority comes
from what the operator wired; every MCP tool call is validated with Zod; MCP
tools that map to destructive actions require the `destructive: true` opt-in.

## The 2026-07-28 spec — what changed (relevant for implementation)

From the official announcement (blog.modelcontextprotocol.io, Jul 28, 2026):

- **Stateless core.** The `initialize`/`initialized` handshake and
  `Mcp-Session-Id` are gone. Every request carries protocol version, client
  identity, and capabilities in `_meta`. Requests can land on any instance
  behind a plain load balancer. A `server/discover` RPC exists for clients
  that want capabilities up front, but it's optional.
- **Header-based routing.** Streamable HTTP requests must include
  `Mcp-Method` and `Mcp-Name` headers, so gateways/WAFs can route and meter
  without parsing bodies.
- **Multi Round-Trip Requests (MRTR).** Server→client requests (elicitation,
  sampling, roots) are redesigned: a tool returns `resultType: "input_required"`
  with the requests it needs answered; the client retries the call with
  `inputResponses`. This replaces held-open bidirectional streams — relevant
  for human-in-the-loop confirmation (e.g., a destructive tool asks the
  operator for approval mid-run).
- **Cacheable lists.** `tools/list`, `prompts/list`, `resources/list`,
  `resources/read` responses carry `ttlMs` and `cacheScope` — clients cache
  tool catalogs and stop re-fetching on every request.
- **Authorization hardening.** RFC 9207 `iss` validation; client credentials
  bound to the issuing authorization server; Dynamic Client Registration (DCR)
  deprecated in favor of Client ID Metadata Documents (CIMD).
- **Tasks extension.** Long-running work moves into the
  `io.modelcontextprotocol/tasks` extension with poll-based `tasks/get` and a
  new `tasks/update`.
- **Deprecations (12-month minimum window):** Roots, Sampling, Logging, and
  the legacy HTTP+SSE transport. New implementations should not adopt them.

## Implementation guidance for AgentFlow

### Server URL config (self-hosted, no hosted SaaS)

- A Tool sub-node backed by MCP points at either a local process (stdio — not
  great in the worker container) or an HTTP URL (`POST /mcp` Streamable HTTP).
  Prefer HTTP: the worker can pool connections, and the operator can host MCP
  servers as sidecar containers on the same box.
- Validate the URL with Zod in the node definition; never let the model choose
  the URL (tool authority stays operator-only).

### Client choice

- Use the official TypeScript SDK (`@modelcontextprotocol/sdk`), which speaks
  `2026-07-28`. Verify the pinned version supports the stateless core; do not
  hand-roll the wire protocol for v1.
- Cache `tools/list` per server using the cache hints; refresh on TTL expiry.

### Safety integration with the agent node

- On agent startup (per run), load tool schemas from each wired MCP server,
  translate to the LLM's `tools` format.
- Route `tool_calls` to MCP `tools/call`; validate arguments with Zod before
  sending; validate results after.
- For destructive MCP tools: require `destructive: true` opt-in on the node
  *and* handle the `input_required`/MRTR confirmation path so the operator can
  approve mid-run (or fail closed).

### Testing

- Fixtures of real `tools/list` / `tools/call` payloads; a fake MCP server in
  tests that exercises MRTR and error paths.
- Eval coverage: an MCP-backed tool must be exercised in the eval harness the
  same way built-in tools are.

## Useful links

- Spec (current): <https://modelcontextprotocol.io/specification/2026-07-28>
- Announcement: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- Spec repo: <https://github.com/modelcontextprotocol/modelcontextprotocol>
- TS SDK: <https://github.com/modelcontextprotocol/typescript-sdk>
