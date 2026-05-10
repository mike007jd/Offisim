## Why

Offisim has spent several rounds hardening the harness, but the durable truth still lets future work stop at "text-only preview", "blocked full-agent", or backend-only evidence. This change turns ClaudeSource / ClaudeRust parity from an audit note into a release-blocking implementation program.

The business goal is simple: Offisim's default harness and verified full-agent employee routes must be credible against Claude Code-class agent behavior, not just pass a narrow deterministic replay.

## What Changes

- Add `reference-feature-map.md` as the source-backed contract for every feature family in this change. Each row maps business logic to ClaudeSource anchors, ClaudeRust anchors, Offisim target behavior, gates, and explicit non-copy decisions.
- Establish a single Claude-parity capability floor covering the default `offisim-core` harness, full-agent employee runtime profiles, main-harness driver/replacement modes, and release evidence.
- Promote `sdk-native-full-power` from a placeholder blocked target into an implementation scope: it stays unavailable until gates pass, but the work is no longer allowed to end at "blocked by missing evidence".
- Require full-agent adapters to preserve real SDK/agent semantics: native tools, MCP, sessions, resume/fork, hooks/guardrails, subagents/handoffs, streaming, cancellation, budgets, telemetry, usage/cost, checkpoint/rollback, and typed partial failures.
- Require a cross-route parity benchmark that runs the same tasks through `offisim-core`, ClaudeSource-inspired/default harness flows, ClaudeRust-inspired CLI/local-tool flows, and each verified full-agent profile.
- Expand the parity floor beyond model/tool loop semantics into the local-productivity surface users actually judge: file tree, read/write/edit/patch, grep/search, shell/PTY/job lifecycle, git/worktree, artifacts/deliverables, memory/todo/skill, browser/desktop boundary, and provider credential safety.
- Add release `.app` verification as a hard gate for full-agent availability, including success, denied path, cancellation, resume/fork, MCP lifecycle, rollback, sandbox escape denial, budget exhaustion, and final evidence classification.
- Lock provider/product taxonomy language so `executionLane`/SDK-backed transport can never be confused with employee full-agent profiles, driver profiles, or replacement profiles.
- Convert stale truth-source cleanup from a hygiene suggestion into a blocking task: specs, ledgers, `CLAUDE.md`, `AGENTS.md`, provider matrices, archived searchable notes, and memory correction notes must not keep telling future agents to stop at the old blocked/text-only state.
- Remove fake completion language and fake SDK/tool parity paths from the acceptance criteria. A route either proves the behavior or remains explicitly unavailable with the missing evidence recorded.

## Capabilities

### New Capabilities

- `claude-parity-agent-runtime`: Defines the end-state parity floor, benchmark matrix, and promotion rules for Offisim's default harness plus verified full-agent routes.

### Modified Capabilities

- `default-agent-harness`: Make ClaudeSource/ClaudeRust parity a release-blocking completion floor, not a reference-only checklist.
- `sdk-agent-full-power-runtime`: Require implementation and release verification of full SDK-native agent semantics before product availability.
- `harness-agent-control-plane`: Require explicit promotion, rollback, and driver/replacement gates for full-agent and main-harness control modes.
- `runtime-engine-adapter`: Remove one-shot text behavior from full-agent adapters and require normalized native runtime activity.
- `runtime-live-verification-gates`: Add release `.app` parity evidence, cross-route benchmark evidence, and no-blocked-label archive gates.
- `backend-harness-verification`: Add deterministic and live harness gates for parity invariants, not just graph replay success.
- `agent-sdk-provider-lanes`: Keep SDK-backed provider bindings transport-only while allowing separate verified full-agent runtime profiles.
- `provider-product-taxonomy`: Separate provider product/access/transport choices from runtime profile availability in Settings and runtime copy.
- `provider-lane-matrix`: Record full-agent profile evidence separately from provider transport evidence.
- `project-workspace-binding`: Make workspace-root propagation and bounded project file access part of parity evidence.
- `desktop-llm-credential-isolation`: Keep trusted full-agent hosts behind Rust-owned credential and abort boundaries.
- `chat-attachments-end-to-end`: Treat attachment read/write authority as a gated evidence family, not implicit SDK capability.
- `deliverable-artifact-handoff`: Treat artifact/deliverable creation as evidence that cannot be replaced by final text.
- `agent-mediated-skill-install`: Keep skill mutation behind confirmation, staging, and vault safety for default and full-agent routes.
- `employee-node-boundaries`: Keep employee runtime routing modular while adding full-agent/external branches.
- `mcp-transport-decision`: Record which MCP transport scope is supported by parity gates and what remains future remote-MCP work.
- `settings-controller-boundaries`: Keep Settings save/runtime controls consistent with provider/product/runtime separation.
- `task-tool-intent`: Expand intent classification so parity evidence requirements match the actual local-productivity task family.
- `long-running-runtime`: Make completion verification consume route/evidence classes rather than accepting final text for tool-requiring work.
- `external-employee-install`: Prevent external/A2A employees from being counted as Claude-parity/full-agent evidence without the same gates.
- `openspec-docs-alignment`: Make stale/toxic memory cleanup a blocking deliverable when harness/runtime truth changes.
- `personnel-runtime-engine-binding`: Expose only truthful full-agent availability and missing-gate reasons in runtime binding surfaces.

## Impact

- **Core runtime**: `packages/core/src/agents/*`, `packages/core/src/engine/*`, `packages/core/src/runtime/*`, `packages/core/src/testing/*`, LLM gateway adapters, tool orchestration, permission engine, completion verifier, checkpoint/resume/rollback services.
- **Desktop trusted hosts**: Claude/Codex/OpenAI agent host scripts, Tauri engine adapters, sidecar IPC contracts, sandbox/project binding, native tool and MCP event mapping.
- **UI/product surfaces**: Personnel Runtime, activity feed, approval surfaces, runtime status/debug surfaces, provider/runtime matrices.
- **Verification**: deterministic scenarios, provider-adapter gates, engine-profile gates, stream-tools, context/resume/chaos/soak/model-bench, release `.app` Computer Use evidence, live provider smoke/load/edge where credentials are available.
- **Truth sources**: OpenSpec specs/changes, `openspec/harness-capability-map.md`, `openspec/protocols-ledger.md`, `openspec/provider-lane-matrix.md`, repo `CLAUDE.md` / `AGENTS.md`, and ad hoc memory correction notes under `~/.codex/memories/extensions/ad_hoc/notes/`.
- **Source drift control**: every parity feature, benchmark case, and release claim must map back to `reference-feature-map.md`; source-unmapped work is incomplete or out of scope.
