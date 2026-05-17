## Why

A six-domain fan-out audit (2026-05-17) compared the `offisim-core` harness against the two Claude Code reference trees (`ClaudeSource/claude-code-haha`, `ClaudeRust/claw-code`). Verdict: form-layer (provider abstraction, SSE parsing, abort/timeout, skills, the Rust filesystem/bash sandbox, and the compaction *machinery*) is mainstream-aligned or better, but the harness has concrete code-level gaps that the existing `complete-claude-parity-full-agent-harness` change did not close because that change is a contract/verification/evidence-classification program, not a behavioral-implementation program. Its `default-agent-harness` parity floor lists capabilities as a release checklist; it does not impose testable obligations like "prompt caching SHALL be set" or "shell commands SHALL be classified before execution".

Four gaps will bite in production:

1. **No prompt caching at all** — no `cache_control` anywhere; `LlmUsage` has no cache-token fields. Every multi-turn loop re-pays full input price (typically 5–10× cost on agent loops) and cost accounting structurally cannot represent cached traffic.
2. **Bash executes with zero command validation** — `bash-tool.ts` forwards the raw string; the Rust sandbox only does path containment, so `rm -rf .`, `curl|bash`, fork bombs, and `git push` run unchecked inside a bound workspace.
3. **Compaction is aimed at the wrong number** — triggers fire on a fixed `~90k` char-derived estimate, never the resolved model's real context window, with no reactive recovery when a provider rejects an over-long prompt.
4. **Default provider loop caps at 5 tool rounds and fails on exhaustion**, with no `stop_reason`/output-truncation handling and coarse abort that can leave unmatched `tool_use` blocks (breaking checkpoint resume).

Plus high-severity gaps in tool-input validation, missing core Edit/Glob/Grep builtins, retry classification, extensible tool-lifecycle hooks, and a stale `MCP ❌` ledger entry that materially misstates a shipped capability.

This change converts those audit findings into source-mapped, testable OpenSpec obligations so implementation can borrow business logic directly from the two reference trees.

## What Changes

- Add `reference-feature-map.md` rows `G01`–`G10`, the source-backed business-logic contract for every gap, mapped to ClaudeSource anchors, ClaudeRust anchors, the Offisim target behavior, and the gate. Rows cross-link the parity change's `F`-rows where the obligation refines an already-mapped feature family.
- Make Anthropic-route **prompt caching** a hard transport obligation: ephemeral `cache_control` on the stable system/tools/conversation prefix, `cacheReadInputTokens`/`cacheCreationInputTokens` added to `LlmUsage`, parsed, persisted, and priced. Non-Anthropic routes gate behind a per-provider capability flag (no-op when unsupported).
- Make **shell command classification** a fail-closed gate before execution: catastrophic patterns denied, destructive patterns routed through the existing approval flow, with parsing into subcommands.
- Make **context budgeting context-window-real**: a per-model `contextWindow` in the model registry, threshold derived from it with reserved output headroom, reactive compact-and-retry on provider context-overflow, and a tool-pair-safe compaction boundary.
- Make the default provider loop **soft-stop** on round exhaustion (typed partial completion, not error), thread a `stopReason` through `LlmResponse`, and reconcile aborts by synthesizing tool-results for in-flight tool calls.
- Add **tool input validation** before dispatch and a **model-facing tool-result size cap** with spill-to-disk preview.
- Add core **Edit / Glob / Grep** builtins (and `WebFetch`), plus read offset/limit + line numbers and write read-before-write guard.
- Broaden **retry classification** (connection errors, `Retry-After`, `x-should-retry`, mid-stream overloaded body), add a streaming idle watchdog, and a deterministic model fallback.
- Add an extensible **PreToolUse/PostToolUse** hook contract with veto, and make the permission decision **argument-aware** (drop spoofable name-regex auto-allow for MCP).
- Scope a genuine **isolated-context sub-run primitive** for delegated work while keeping the org-graph product metaphor (deliberate divergence, recorded).
- Correct the stale `MCP ❌` truth-source entry to `client ✓; resources/prompts surfacing + Streamable HTTP + OAuth pending`.

## Capabilities

### Modified Capabilities

- `harness-model-transport-boundary`: add prompt-caching, cache-token accounting, retry classification, streaming idle, and model fallback obligations to the transport boundary.
- `default-agent-harness`: turn parity-floor checklist bullets into testable obligations for the tool loop (soft cap + `stop_reason` + abort reconciliation), shell command classification, tool input/result-size validation, core edit/search builtins, extensible tool hooks + argument-aware permission, and an isolated sub-run primitive.
- `conversation-budget-service-boundaries`: replace char-estimate triggering with real model-context-window budgeting + reactive overflow recovery + tool-pair-safe boundary; narrow the "behavior unchanged after refactor" invariant so this deliberate evolution is not blocked.
- `openspec-docs-alignment`: make the MCP ledger correction a blocking truth-source fix.

## Impact

- **Core runtime**: `packages/core/src/llm/*` (adapters, gateway, retry, errors, model-registry, recorded-call), `packages/core/src/tools/*` and `tools/builtin/*`, `packages/core/src/runtime/tool-executor.ts`, `packages/core/src/agents/employee-node*.ts` / `employee-turn-runner.ts` / `employee-tool-round.ts`, `packages/core/src/services/conversation-budget/*`, `packages/core/src/permissions/tool-permission-engine.ts`, `packages/core/src/runtime/hook-registry.ts`, `packages/core/src/graph/*`.
- **Desktop sandbox**: `apps/desktop/src-tauri/src/builtin_tools.rs` (shell classification lives in front of the existing path-containment layer; do not weaken the Rust layer).
- **Cost/usage surfaces**: `cost-calculation-service`, `session-cost-tracker`, pricing source registry, and any UI showing token/cost (cache tokens become first-class).
- **Truth sources**: `openspec/protocols-ledger.md`, `openspec/harness-capability-map.md`, `openspec/provider-lane-matrix.md`, and the repo-local root `CLAUDE.md` memory index. System-level Codex memory is outside this OpenSpec change unless the user explicitly requests a memory update.
- **Verification**: deterministic harness scenarios for caching headers/usage, shell-deny, context-window trigger, 413 recovery, soft-cap terminal, abort reconciliation, tool-input rejection, hook veto; optional live provider smoke for cache-hit token deltas when Anthropic credentials are supplied, plus MiniMax/OpenAI-compat no-op caching.
- **Source drift control**: every implementation task, scenario, and claim must map back to a `reference-feature-map.md` `G`-row or be explicitly out of scope.
