# Harness Architecture — Pi Agent Host

This document describes the current desktop AI execution path.

Current fact check: **2026-07-16 NZST**. `package.json` and `pnpm-lock.yaml`
pin **exactly `@earendil-works/pi-coding-agent@0.80.7`**; npm registry metadata
reported the same version as `latest` when checked with
`npm view @earendil-works/pi-coding-agent version dist-tags time --json`.

## Current Runtime

Offisim has one active AI runtime: Pi Agent.

The desktop renderer uses `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`
as a thin client. It sends user turns to the Tauri command
`agent_runtime_execute`, receives Pi session events, and projects them into:

- assistant-ui message state
- run/tool telemetry
- 3D office work-state animation

The Tauri side lives in `apps/desktop/src-tauri/src/pi_agent_host/`. It starts
the bundled Node host `apps/desktop/src-tauri/resources/pi-agent-host.mjs`, binds
the active project workspace as the Pi session cwd, and forwards JSONL events to
the renderer.

The Node entrypoint is `scripts/tauri-pi-agent-host.entry.mjs`. It uses the
official `@earendil-works/pi-coding-agent` SDK:

- `AuthStorage.create()`
- `ModelRegistry.create()`
- `SessionManager`
- `createAgentSession`

SDK source check: npm registry metadata for
`@earendil-works/pi-coding-agent` shows `0.80.7` as both the local exact pin
and npm `latest` on the check date. The installed package exports the
high-level SDK from `./dist/index.js`; Offisim embeds that SDK in its bundled
host and does not require a separately installed `pi` executable.

Pi owns provider auth, model registry, sessions, compaction, tool loop,
streaming protocol, and retries. Offisim does not maintain a provider catalog or
parse model-provider SDK transports.

## Current Host Capabilities

The desktop bridge intentionally exposes a small, useful subset of Pi rather
than recreating Pi's TUI or RPC product.

### Real attachments

- Documents and text files are persisted in Offisim's attachment vault, parsed,
  and included in the current turn with bounded readable content.
- PNG, JPEG, GIF, and WebP bytes are encoded as Pi `ImageContent` and forwarded
  through `session.prompt(..., { images })`. They are not path-only metadata.
- The same native image payload is accepted by live queued messages. Whether a
  model can inspect an image remains a Pi model capability, not an Offisim
  fallback or vision shim.

### Live-turn control and queue visibility

- A message sent while the root run is active is explicitly classified as
  `steer` or `followUp` and delivered through Pi's native
  `session.sendCustomMessage(..., { deliverAs })` API. The custom message is the
  real instruction that enters model context, not a second bookkeeping entry.
- The active composer follows Pi's keyboard contract: Enter steers,
  Option/Alt+Enter schedules a follow-up, and Shift+Enter inserts a newline.
  IME composition and an in-flight admission lock prevent accidental duplicates.
  An edit revision travels with the submitted snapshot, so an ACK clears only
  unchanged text; typing during admission is preserved even if the user later
  happens to enter the same characters again.
- `steer` is delivered after the current assistant turn's tool calls and before
  the next model call. `followUp` waits until the agent otherwise becomes idle.
- Pi owns queue ordering and delivery policy. Because Pi's public text queue
  tracker does not count custom messages, Offisim projects its accepted custom
  controls alongside Pi's native `queue_update` counts; it does not run a second
  prompt queue or a second agent loop.
- A renderer send is acknowledged only after the live host admits the correlated
  control id. Pi's matching custom `message_end` marks it consumed;
  accepted-but-unconsumed controls remain retryable after a host failure, while
  consumed controls are never replayed. Late controls receive an explicit
  rejection rather than a misleading stdin-write success.
- Each consumed instruction is one Pi JSONL `custom_message` entry with
  `customType: offisim.control`. Its details carry the root run, control id,
  action, and SHA-256 payload fingerprint while its content carries the actual
  text and images. On exact-open recovery, the new host hydrates the consumed
  ledger from that session's active branch. Re-sending the same payload returns
  `consumed` without invoking Pi again; reusing the id with different content is
  rejected. The terminal ACK is deferred until Pi has synchronously appended the
  JSONL entry, so it cannot outrun its durable proof.
- Here `consumed` means Pi has drained the control into agent state and durable
  session context; it does not claim that the next model response has completed.
  Pi 0.80.7 awaits that `message_end` persistence before starting the next
  provider call. If the host dies in that gap, exact-open reconstructs the same
  custom message in `buildSessionContext()`, and the Resume prompt continues with
  the instruction present instead of queueing a duplicate or losing the intent.
- `pending`, `accepted`, `failed`, and `rejected` remain live-host ledger states.
  Only `consumed` is rehydrated across a sidecar restart; an accepted control
  with no consumed JSONL proof is intentionally retried from Offisim's durable
  visible-message queue.
- The host waits for `session.waitForIdle()` so a root turn does not report a
  terminal result while queued work is still running.

### Pi lifecycle projection

Wire protocol **v8** adds one additive `lifecycle` envelope. The host projects
Pi's native `queue_update`, `compaction_start` / `compaction_end`,
`auto_retry_start` / `auto_retry_end`, `agent_settled`, and
`session.getContextUsage()` facts into neutral renderer status. This is
observability only: retry, compaction, context accounting, and queue policy stay
inside Pi.

### Four blocking Pi UI requests

The headless host supplies a forwarding `ExtensionUIContext` for Pi's four
blocking primitives:

- `confirm` — boolean approval
- `select` — one value from Pi-provided options
- `input` — single-line text
- `editor` — multi-line text, optionally prefilled

Each request is correlated by id and admitted through a single FIFO, rendered in
the conversation, and answered on the running host's stdin channel. Cancel,
timeout, host abort, and stale restored requests unwind explicitly rather than
leaving the Pi session parked. Non-blocking TUI-only primitives remain no-ops.

### Project trust and utility-session isolation

The root and delegated worktrees use Pi's own `ProjectTrustStore`,
`hasTrustRequiringProjectResources`, and `defaultProjectTrust` semantics. A
workspace with executable or local project resources must have a saved trust
decision or the global `always` default; Offisim does not invent a second trust
database or silently mark unknown worktrees trusted. Each child receives a
cwd-bound `SettingsManager`, so trust cannot leak from its parent workspace.

Prompt Enhance and employee collaboration are utility sessions, not project
runs. They use `SessionManager.inMemory(...)` and disable auto-discovered
extensions, skills, prompt templates, themes, and context files. Enhance has no
tools; collaboration registers only its explicit profile allowlist and read-only
MCP factory. Neither lane discovers project resources or writes a Pi transcript.

### Renderer reload and recovery ownership

The Pi host and Rust stream can outlive a renderer reload. On bootstrap the
conversation controller first claims every still-running root, restores its
visible user turns and partial assistant checkpoint, subscribes to the existing
stream, and asks the host to resurface the active UI request, queue counts, and
non-pending control outcomes. Startup recovery receives those claimed root ids
and may park only the remaining dead runs. This prevents both a duplicate Pi
invocation and the race where recovery marks a live run interrupted before the
controller adopts it.

The terminal Pi result is authoritative over a restored streaming checkpoint.
Reload support does not create a second session implementation: the same Rust
stream, host process, Pi session, and controller event projection continue. The
assistant checkpoint and Rust stream cursor are persisted atomically; reattach
subscribes before replay, drains live events that arrive during replay, and then
returns the latest terminal snapshot. An abort that wins during replay therefore
cannot be mistaken for a still-running host.

The Rust stream retains at most the latest 4,096 events and 8 MiB of serialized
event payload, while always retaining the newest event (including Result/Error).
For a running stream, a durable renderer cursor older than that window fails before partial replay and the
renderer aborts the host before marking the run failed. For an already-terminal
stream, retained post-checkpoint events are replayed when available; otherwise
reattach falls back to the last authoritative Result/Error instead of losing a
successful terminal outcome. A live reattach pins terminal stream state;
`release_stream` waits until replay, pending live events, and the final snapshot
complete. A failure while rebuilding durable controller ownership follows the
same fail-closed abort path. If two durable live rows contend for one thread,
only the request already owned by that controller survives; any different
unclaimed host is aborted rather than left running invisibly.

Run admission is durable before the visible boss message and before host launch.
If message persistence fails, no Pi host starts and the admitted root closes as
failed; if the renderer disappears in that narrow handoff, startup recovery sees
the running discovery row and exposes it as interrupted instead of leaving a
sent-looking message with no recoverable run. At the other end, Result/Error is
not the root commit marker by itself: the controller first commits the final
ChatMessage and removes `active_interactions`, then `settleRun` reconciles child
rows, writes the root terminal status last, and releases the retained Rust stream.
A failure before that root commit keeps the row running and the stream replayable.
Stop uses the same order after waiting for Rust to report a terminal abort, and a
concurrent Stop always wins over a late Result.

Conversation navigation does not detach an active run. The controller retains
ownership across company/thread route changes and persists its terminal assistant
message even when the originating conversation is not mounted. Visible Office,
Computer, pipeline, and Stop controls remain scoped to the selected company;
with no selected company, no global run control is exposed.

### Durable Resume

Resume is a controller-owned continuation of the same durable root, not a direct
runtime shortcut. It immediately claims the thread, keeps the old partial
assistant message marked `interrupted`, creates a distinct assistant checkpoint,
starts a replacement host under the same run/attempt id, restores Pi UI/Stop
handling, and replays only durable controls that were not consumed.

The runtime opens thread admission synchronously before any asynchronous durable
row or workspace preflight. Stop during that window records a pending abort, and
queued controls wait for host readiness. Any preflight failure clears admission
and rejects those controls instead of leaving a ghost active run.

If the interrupted row has a Pi `session_file`, the host uses
`SessionManager.open(...)` on that exact JSONL file after validating that it is a
direct child of the thread session directory. Only when the durable row has no
recorded `session_file` does recovery use `SessionManager.create(...)` and replay
the durable objective and native attachments. A recorded path that is missing,
outside the directory, or not JSONL fails closed; it never degrades to a fresh
session. Ordinary new turns continue to use `SessionManager.continueRecent(...)`;
Resume never guesses a different recent session.

## Ownership Boundary

| Pi Agent owns | Offisim owns |
|---|---|
| provider auth and `models.json` resolution | safe status/config summaries and links to Pi config |
| built-in tools, extension tools, and the tool loop | permission/UI projection and product-scoped custom bridge tools |
| steering/follow-up queue semantics | composer controls and visible queued-message persistence |
| provider retries and context compaction | lifecycle/status rendering |
| JSONL session history, branches, and session tree | one chat thread's stable Pi session directory and current-run records |

The active scope deliberately does **not** add an Offisim tool loop, provider
retry policy, compaction algorithm, model/provider catalog, or full Pi session
tree/fork browser. Ordinary turns continue the current thread session; durable
recovery opens its recorded exact session, or starts a fresh replay only when no
session file was recorded. Deeper history navigation remains Pi-owned until a
separate product decision demonstrates that it is needed.

## Superseded Runtime

The old `packages/core/src/pi-bridge` loop and `packages/pi-ai` /
`packages/pi-agent` fork have been removed. They must not be recreated or
reconnected to Settings/chat without a new architecture decision.

The following paths are retired from product runtime:

- Offisim provider/model catalog
- `ProviderPane`
- Claude Code SDK sidecar
- Codex sidecar
- OpenAI Agents adapter
- Rust raw LLM transport commands

## Validation

Active runtime validation is:

- `pnpm harness:review-fixes` — keeps the old lanes/catalog removed
- `pnpm harness:pi-agent-host` — checks the exact Pi pin, native attachments,
  correlated steer/follow-up admission, crash-durable consumed-control JSONL
  deduplication and live-host state handling,
  lifecycle projection, FIFO/cancellation for all four blocking UI requests,
  trust/isolation, exact-open versus fresh Resume, reattach wiring, host wiring,
  and release resources
- `pnpm harness:ui-run-scope` — checks company-scoped display/control and
  revision-safe composer clearing after ACK
- `pnpm harness:conversation-run-controller` — checks UI ownership, durable queue
  replay, reload adoption, company-navigation continuity, Stop, and terminal
  message persistence
- `pnpm harness:run-recovery` — checks crash reconciliation plus the controller
  and exact-session Resume seams
- `node scripts/pi-delegation-smoke.mjs` — checks concurrent in-process Pi
  sessions remain isolated on the installed SDK
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml pi_agent_host` —
  checks cross-language wire behavior, replay gaps, release pinning, and terminal
  races during reattach
- `pnpm validate` — combines typecheck, Pi-only guards, Studio placement, and Pi
  Agent Host checks

Release evidence still requires the current worktree release `.app` driven by
Computer Use when desktop behavior changes.
