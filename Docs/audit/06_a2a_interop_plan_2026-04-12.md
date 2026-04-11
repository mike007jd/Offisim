# Phase 6 — A2A Interop Development Introduction Plan

**Status**: 2.0 roadmap draft. Not a 1.0-rc.1 ship requirement.

**Framing** (locked with user in Phase 2 revision): A2A is an **external-agent interop extension point**, not a product architecture pillar. Core employee runtime stays `anthropic-adapter` / `openai-adapter` / `subscription-adapter (ACP)`. This phase plans how to *eventually* activate A2A as the sleeping-asset upgrade path, so future unknown agent runtimes can hand off work to Offisim employees (or vice versa) via an open standard — without research + development reinventing a new vendor adapter every time.

This is the "insurance policy" phase. Deliberately not ambitious. A2A gets turned on when a concrete user need triggers it; until then, it sits as documented roadmap.

---

## 1. Current state (post-Phase 5)

After Phase 5 cleanup commits land, the state is:

| Asset | Location | Lines | Status |
|---|---|---|---|
| Handwritten A2A client | `packages/core/src/a2a/a2a-client.ts` | 172 | Sleeping, untouched |
| Handwritten A2A server | `packages/core/src/a2a/a2a-server.ts` | 232 | Sleeping, untouched (`tasks/get` returns -32001) |
| Handwritten A2A types | `packages/core/src/a2a/a2a-types.ts` | 144 | Sleeping, v0.3.0 subset |
| A2A index re-export | `packages/core/src/a2a/index.ts` | 26 | Sleeping |
| OpenClaw WS v3 client | `packages/core/src/gateway/openclaw-client.ts` | ~523 | Sleeping, untouched |
| OpenClaw scene render hooks | `packages/ui-office/src/components/scene/office3d-employees.tsx:311-312` | — | Dead code (no path creates openclaw-role employees) |

- Zero UI wiring.
- Zero app-entry instantiation (`new A2AClient(...)` / `new A2ARequestHandler(...)` / `new OpenClawClient(...)` count: 0 in entire repo).
- One-line CLAUDE.md addendum clarifies positioning.

---

## 2. Research findings (2026-04)

Sources listed at end.

### 2.1 A2A ecosystem status

- **Governance**: Apache-2.0, Linux Foundation. Donated by Google early 2025, now community-governed with 100+ partner orgs.
- **Spec version**: v0.3.0 current (matches Offisim handwritten code header).
- **Transports** supported by the spec: JSON-RPC 2.0 over HTTP(S), HTTP+JSON REST, gRPC, SSE streaming, push notifications.
- **Discovery**: Agent Card served at `/.well-known/agent-card.json`.
- **Complementary to MCP**: MCP = agent↔tool (short-call stateless), A2A = agent↔agent (long-running stateful tasks). Offisim employees map more naturally to A2A task semantics than to MCP tool semantics because employees are multi-step agents with their own state, not functions.
- **Adoption**: by Feb 2026, MCP crossed 97M/month SDK downloads and is supported by every major LLM vendor. A2A has growing adoption but much smaller — primarily Google ADK, Vertex AI Agent Builder, and vendors targeting agent-to-agent interop. This matters for Offisim: **A2A is a bet on future growth, not an already-big ecosystem**.

### 2.2 Official JavaScript SDK: `@a2a-js/sdk@0.3.13`

- **Repo**: https://github.com/a2aproject/a2a-js (Apache-2.0)
- **Dependencies**: **only `uuid@^11.1.0`** (1 runtime dep)
- **Peer dependencies** (all optional):
  - `express ^4 || ^5` — for mounting A2A server
  - `@grpc/grpc-js` — gRPC transport (Node-only)
  - `@bufbuild/protobuf` — gRPC transport
- **Entry points** (modular, tree-shakeable):
  - `@a2a-js/sdk` — core types, `ClientFactory`
  - `@a2a-js/sdk/server` — `AgentExecutor`, `DefaultRequestHandler`, task/event management
  - `@a2a-js/sdk/server/express` — Express handlers (`agentCardHandler`, `jsonRpcHandler`, `restHandler`)
  - `@a2a-js/sdk/server/grpc` — gRPC server (Node-only)
  - `@a2a-js/sdk/client` — `ClientFactory`, interceptors, transports
  - `@a2a-js/sdk/client/grpc` — gRPC client (Node-only)
- **Engine**: Node >= 18
- **Module type**: ESM primary, CJS fallback via `.cjs`
- **Browser compatibility**: **no explicit browser exports**. Core client (JSON-RPC/HTTP transport) likely works in browser via `fetch` but not officially supported. gRPC definitely Node-only.

### 2.3 Offisim handwritten A2A vs official SDK

| Feature | Handwritten (v0.3.0 subset) | `@a2a-js/sdk@0.3.13` |
|---|---|---|
| JSON-RPC over HTTP transport | ✓ | ✓ |
| Agent Card discovery | ✓ (`.well-known/agent-card` endpoint) | ✓ (`agentCardHandler`) |
| `message/send` blocking | ✓ | ✓ |
| `tasks/get` polling | ✗ (-32001) | ✓ (via `AgentExecutor` + `ExecutionEventBus`) |
| SSE streaming | ✗ | ✓ (`sendMessageStream()` async generator) |
| HTTP+JSON REST transport | ✗ | ✓ (`restHandler`, `RestTransport`) |
| gRPC transport | ✗ | ✓ (Node-only) |
| Push notifications webhook | ✗ | ✓ |
| Authentication pluggable | ✗ (Bearer only) | ✓ (`AuthenticationHandler` + `CallInterceptor` chain, 401 refresh) |
| Signed agent cards | ✗ | ✓ |
| Task artifact event lifecycle | ✗ (returns complete task in one shot) | ✓ (`eventBus.publish()` + `eventBus.finished()`) |
| Maintenance | Offisim team | Upstream community |

**Implication**: continuing to maintain the handwritten code is wasted effort. When 2.0 decides to activate A2A, the handwritten files should be replaced with SDK usage. The ~570 lines of handwritten code become ~50 lines of thin wiring.

### 2.4 Tauri hosting options for an A2A server

A2A server needs a real TCP port that other agent processes can reach. Options evaluated:

| Option | Exposes real TCP port? | Rust code needed? | Node infra reused? | Fit for A2A |
|---|---|---|---|---|
| `tauri-plugin-axum` | ❌ (custom `axum://` protocol, not TCP) | Yes | No | **Unsuitable** |
| `tauri-plugin-localhost` | ✓ (binds 127.0.0.1:port) | Yes (routes) | No | Suitable but requires Rust-side A2A impl (contradicts "use official SDK") |
| Tauri sidecar Node subprocess | ✓ (child process runs Node+Express+SDK) | Minimal (spawn) | ✓ full | **Best fit** |
| Handwritten Rust Axum in setup hook | ✓ | Most | No | Over-engineered |

**Recommended**: **Tauri sidecar Node subprocess** running `express` + `@a2a-js/sdk/server/express`. Tauri side is a minimal process spawner (reuse the existing pattern for `claude` ACP subprocess in `subscription-adapter.ts`), Node side is a standard Express app with SDK handlers mounted.

Security: bind to `127.0.0.1` only, Bearer token provisioned via existing `runtime_secret_*` Tauri commands.

---

## 3. Goals and non-goals

### 3.1 Goals (what "activated A2A interop" means)

1. **Outbound (Offisim → external agent)**: An Offisim employee can hand off a task to an external A2A peer (e.g. Google ADK agent, OpenClaw lobster, any future runtime with A2A support) and get a result back.
2. **Inbound (external agent → Offisim)**: An external A2A client can discover Offisim's employees via agent card, send them tasks, and receive results.
3. **Settings UI**: User can add / remove / test A2A peers (name, URL, token).
4. **Observability**: A2A traffic appears in Activity Log alongside core runtime events.
5. **Security**: Inbound server bound to localhost only, Bearer auth, audit log.
6. **Replace handwritten code**: Delete Offisim's `a2a-*.ts` in favor of `@a2a-js/sdk`.
7. **No regression to core runtime**: `anthropic-adapter` / `openai-adapter` / `subscription-adapter` remain unmodified.

### 3.2 Explicit non-goals (Phase 6 does NOT include)

- **MCP server mode** (Offisim exposing employees as MCP tools) — separate roadmap item, orthogonal decision.
- **Multi-tenant A2A** — single-user desktop deployment only.
- **Push notifications** — out of scope for v1 activation.
- **gRPC transport** — Node-only, optional, adds binary dependency weight.
- **Reviving OpenClaw Gateway WebSocket Protocol v3** — remains sleeping asset. If a future need for OpenClaw realtime event streams surfaces, re-evaluate then.
- **Enabling A2A in browser-only mode** — desktop (Tauri) only for server. Browser mode may get a client-only subset if the SDK's JSON-RPC client works in browser via `fetch`, but no server.
- **Re-wiring the `useOpenClaw` hook** — it's deleted in Phase 5 and does not come back.

---

## 4. Task breakdown

**Prerequisite**: Phase 5 complete. A2A / OpenClaw sleeping assets unchanged. CLAUDE.md addendum in place.

### Task 6.1 — Spike: validate `@a2a-js/sdk` in Offisim environment (0.5 day)
- Install `@a2a-js/sdk@0.3.13` in a scratch branch.
- Write a 30-line Node script that mounts a trivial A2A server (one employee stub) on `127.0.0.1:18800` using `@a2a-js/sdk/server/express`.
- Write a matching client script that calls the server.
- Confirm: SDK works standalone without pulling Node-only deps that would break the main monorepo.
- **Output**: go/no-go decision. If SDK integration is clean, continue. If SDK has hidden requirements (node-gyp, native modules, etc.), fall back to Plan B: adopt the handwritten code as permanent and only add `tasks/get` support.

### Task 6.2 — Package structure decision (0.5 day)
- Decide: does `@a2a-js/sdk` live in `packages/core` (reuse existing a2a subdir) or a new `packages/interop-a2a`?
- Recommended: `packages/core/src/a2a/` — replaces handwritten files in place, minimal refactor elsewhere.
- Update `packages/core/package.json` dependencies: add `@a2a-js/sdk ^0.3.13`, add `express` as peer dep (or direct dep if sidecar hosts it).
- Ensure `core/src/browser.ts` does not import any Node-only paths from the SDK (use core client only, not server/express).

### Task 6.3 — Replace handwritten A2A client (1 day)
- Delete `packages/core/src/a2a/a2a-client.ts` (172 lines).
- Rewrite `packages/core/src/a2a/index.ts` to re-export from `@a2a-js/sdk`:
  - `ClientFactory`, `A2AClient`, relevant types
- Update callsites — **there are zero production callsites**, so only test code (if any added in Task 6.1 spike) needs updates.
- Verify `packages/core/src/browser.ts` A2A re-exports still work for the browser bundle. If SDK client is Node-only, add a thin browser-only wrapper using `fetch` directly.

### Task 6.4 — Replace handwritten A2A server (1 day)
- Delete `packages/core/src/a2a/a2a-server.ts` (232 lines).
- Implement a minimal `OffisimAgentExecutor` that adapts the SDK's `AgentExecutor` interface to Offisim's orchestration service:
  - On `execute(context, eventBus)`: extract message text + optional `agentId` from the incoming A2A task, call `orchestrationService.run(...)` with a dedicated thread, stream graph events to `eventBus.publish()`, close with `eventBus.finished()` when the employee returns.
- Provide a `createA2AServerApp()` factory returning a configured Express app with mounted handlers.

### Task 6.5 — Delete handwritten types, re-export from SDK (0.5 day)
- Delete `packages/core/src/a2a/a2a-types.ts` (144 lines).
- Anything that imported local A2A types now imports from `@a2a-js/sdk` directly.
- Update `core/src/index.ts` + `core/src/browser.ts` A2A re-export blocks.

### Task 6.6 — Tauri sidecar Node process for A2A server (2-3 days)
- **Desktop only**. Browser mode skips this entirely.
- Reuse the pattern from `subscription-adapter.ts` which spawns `claude` ACP subprocess via `node:child_process` (`packages/core/src/llm/subscription-adapter.ts:31` — "ACP server command").
- New file: `packages/core/src/a2a/a2a-sidecar.ts` — starts a Node subprocess that runs `createA2AServerApp()`, passes config via env vars (port, token, agent card metadata).
- New Tauri commands in `apps/desktop/src-tauri/src/lib.rs`:
  - `a2a_server_start(config)` — spawn sidecar, return pid + port
  - `a2a_server_stop()` — kill sidecar
  - `a2a_server_status()` — process alive check
- **Security**: sidecar binds `127.0.0.1` only (enforce in the Node code, not just Rust). Port is ephemeral (ask OS for a free port, report back to frontend). Token is generated at startup and stored via existing `runtime_secret_set(...)` flow.
- **Lifecycle**: sidecar starts when user explicitly enables A2A in settings. Stopped when disabled or app quits.
- **Audit**: sidecar stdout/stderr piped into main process, logged via `Logger` with namespace `a2a-sidecar`.

### Task 6.7 — A2A client for outbound (desktop + browser) (1 day)
- Desktop: use `@a2a-js/sdk/client` directly (Node).
- Browser: if SDK client works in browser via `fetch`, use directly. Otherwise, write a 50-line thin client using `fetch` that implements JSON-RPC `message/send` + `getAgentCard`. This thin client is throwaway when the SDK adds official browser support.
- Expose through an injection point in `OffisimRuntime` — new optional field `a2aClient: A2AClient | null`.

### Task 6.8 — Settings UI "A2A Peers" tab (2 days)
- New component: `packages/ui-office/src/components/settings/A2APeersPanel.tsx`.
- New hook: `packages/ui-office/src/hooks/useA2APeers.ts` (localStorage-backed peer list, CRUD).
- Add tab entry to `SettingsTabNav.tsx` with icon + label `A2A Peers`.
- Per-peer UI: name, URL, optional token, optional default `agentId`.
- Test connect button: fetches agent card, displays peer name + declared skills.
- Delete button per peer.
- **Do not** call this tab "Gateway" or use lobster branding. Generic `A2A Peers` language only.

### Task 6.9 — Employee tool `call_a2a_peer` (1 day)
- New built-in tool registered in `packages/core/src/runtime/tool-executor.ts` style.
- Tool schema: `call_a2a_peer(peerName: string, message: string, blocking?: boolean)`.
- Implementation: look up peer by name from runtime config, instantiate `A2AClient`, call `sendBlocking` or `sendAndWait` depending on `blocking`, return text artifact.
- Timeout: default 120s, configurable.
- Tool shows up in LLM tool list only when at least one A2A peer is configured (graceful degradation).
- Audit: each call logged to `runtimeEvents` with new event type `a2a.peer.called`.

### Task 6.10 — Inbound A2A → graph wiring (2 days)
- Sidecar side: `OffisimAgentExecutor.execute()` calls back to main process via Tauri IPC → main process invokes `orchestrationService.run(...)` with a new thread ID and the incoming message.
- IPC protocol: new channel `a2a:inbound-task`, payload `{ taskId, message, agentId?, peerInfo }`. Main process replies with `{ artifactText }` or `{ error }`.
- Graph routing: if `agentId` is specified, boss node uses `targetEmployeeId` directly (bypass LLM routing). If not, boss node does normal routing.
- Result streaming: sidecar consumes main-process event stream via a second IPC channel `a2a:inbound-task-events`, republishes to SDK's `eventBus.publish()`.
- **Security**: incoming A2A task counts as an untrusted input source. Pass through the existing `NodeContextMiddleware` + tool permission gates — do not bypass them.

### Task 6.11 — Observability integration (1 day)
- New event types: `a2a.server.started`, `a2a.server.stopped`, `a2a.peer.called`, `a2a.inbound.received`, `a2a.inbound.completed`, `a2a.inbound.failed`.
- Add to `packages/shared-types/src/events.ts` (the 50+ event payload file).
- Wire into Activity Log page filter list (`EVENT_PREFIXES` + `TYPE_PREFIX_MAP`).
- Display in workspace notification center with neutral styling (not celebratory, not alarming).

### Task 6.12 — Security hardening (1 day)
- Sidecar port bind verification: test that `0.0.0.0` binds are rejected at start.
- Bearer token rotation: new `rotateA2AToken()` Tauri command, atomic swap.
- Rate limiter: reuse the pattern from `apps/platform/src/middleware/rate-limit.ts` but adapted for localhost (drop `X-Forwarded-For` trust, use direct socket peer).
- Optional IP allowlist (localhost only by default).
- Documentation: new section in `Docs/04_runtime_experience/` or a new `Docs/02_contracts_and_schemas/a2a-security.md` — **only** if doc is needed for actual user-facing config, not for internal architecture explanation.

### Task 6.13 — Testing strategy (2 days)
- **Unit tests**: `OffisimAgentExecutor` mock graph stream, verify SDK event lifecycle. Tool `call_a2a_peer` mock SDK client, verify timeout / error paths.
- **Integration**: start real sidecar in a test environment, run local client ↔ local server loopback, assert end-to-end task completion.
- **Manual**: install Google ADK sample agent (from `a2aproject/a2a-js` examples), connect to it from Offisim Settings, send a "hello world" task from an Offisim employee, verify result round-trips.
- **No CI gate** (consistent with existing no-hosted-CI policy per CLAUDE.md). Husky `biome --staged` stays.

### Task 6.14 — Migration notes + CLAUDE.md update (0.5 day)
- **Remove** the sleeping-asset one-liner added in Phase 5.
- **Add** a new CLAUDE.md Gotchas entry about A2A being an active feature:
  - location of A2A code (paths)
  - how to enable (Settings tab)
  - sidecar lifecycle (start/stop)
  - security model (localhost only, Bearer token)
- **Do not** add an architecture doc or top-level section. Stay terse.

### Task 6.15 — Ship A2A as opt-in 2.0 feature (0 days)
- Feature lands disabled by default.
- Settings tab visible but marked clearly "Preview" or behind a single toggle.
- User has to explicitly start the sidecar.
- After one or two release cycles of real-world feedback, remove Preview label.

---

## 5. Rough size estimate

- **Code delta**: net **negative** (delete 548 lines handwritten, add ~300 lines of SDK integration + UI + IPC)
- **Dependencies added**: `@a2a-js/sdk@^0.3.13`, `express@^4` or `^5`, and transitively `uuid` (already a common dep)
- **Work**: ~2-3 focused weeks (15 tasks × avg 1 day, with some overlap)
- **Risk**: medium — sidecar lifecycle on Tauri + Node IPC is the biggest unknown. Spike (Task 6.1) mitigates by validating the SDK fit before commitment.

---

## 6. Out of scope (things this plan does NOT address)

- Reviving OpenClaw Gateway Protocol v3 (stays sleeping, can be deleted in 3.0 if never needed)
- MCP server mode (separate roadmap)
- Multi-tenant or hosted Offisim A2A
- A2A push notifications
- A2A gRPC transport
- Browser-mode A2A server
- Migrating existing `subscription-adapter (ACP)` to use A2A — **keep ACP for LLM subscription**; A2A is for agent-to-agent, not LLM provider

---

## 7. Decision points the user must revisit before 2.0 starts

These are left open. Phase 6 plan does NOT lock them:

1. **Is A2A actually the right bet vs. MCP server mode?** MCP has 100x the adoption today. But MCP's tool-call semantics don't fit multi-step agent tasks cleanly. Decision: should Offisim do **both** (A2A + MCP server) or just one? Plan 6 assumes A2A only; if both, add a parallel Phase 6B.
2. **Sidecar cost**: starting a Node subprocess per desktop launch adds startup time + memory. Is this acceptable, or should A2A server be conditional on user explicitly enabling it in settings? Plan 6 defaults to opt-in.
3. **`OpenClawClient` WebSocket code fate**: if 2.0 lands A2A without ever needing OpenClaw-specific realtime streams, the ~523 lines become permanent dead weight. Plan 6 leaves it alone; a follow-up sprint can delete if still unused.
4. **Does Offisim publish its own agent card publicly?** Right now A2A is inbound from trusted peers only. If Offisim wants to appear in agent discovery directories, that's a separate product question.

---

## 8. Sources

Research done 2026-04-12 via web search and github raw fetch.

- [a2aproject/A2A (main repo)](https://github.com/a2aproject/A2A)
- [a2aproject/a2a-js (official TypeScript SDK)](https://github.com/a2aproject/a2a-js)
- [@a2a-js/sdk on npm](https://www.npmjs.com/package/@a2a-js/sdk)
- [A2A Protocol latest spec](https://a2a-protocol.org/latest/)
- [Announcing the Agent2Agent Protocol (Google)](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [A2A gets an upgrade (Google Cloud blog)](https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade)
- [Google open-sources A2A (InfoQ 2025-04)](https://www.infoq.com/news/2025/04/google-agentic-a2a/)
- [A2A vs MCP comparison (DigitalOcean)](https://www.digitalocean.com/community/tutorials/a2a-vs-mcp-ai-agent-protocols)
- [MCP vs A2A (auth0 blog)](https://auth0.com/blog/mcp-vs-a2a/)
- [tauri-plugin-localhost crate](https://crates.io/crates/tauri-plugin-localhost)
- [tauri-plugin-axum docs](https://docs.rs/tauri-plugin-axum/latest/tauri_plugin_axum/)
- [Tauri HTTP plugin (client)](https://v2.tauri.app/plugin/http-client/)
- [A2A JS SDK tutorial](https://a2aprotocol.ai/blog/a2a-javascript-sdk)
