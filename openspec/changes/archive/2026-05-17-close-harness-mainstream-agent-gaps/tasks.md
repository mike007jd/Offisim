## 0. Scope Discipline

- [x] 0.1 Every task, scenario, and PR below maps to a `reference-feature-map.md` `G`-row or is explicitly marked out of scope.
- [x] 0.2 Spot-check each cited Offisim gap anchor still resolves before implementing the row (code is the live truth, not the audit note).
- [x] 0.3 Borrow business logic from the cited ClaudeSource/ClaudeRust anchors; do not copy source, prompts, or UI.

## 1. Prompt Caching (G01 — CRITICAL, first)

- [x] 1.1 Add `cacheReadInputTokens` / `cacheCreationInputTokens` to `LlmUsage` (`packages/core/src/llm/gateway.ts`) and thread them through `recorded-call.ts` persistence.
- [x] 1.2 Add a per-provider `supportsPromptCaching` capability flag; default false for OpenAI-compatible/MiniMax.
- [x] 1.3 In `anthropic-adapter.ts`, attach ephemeral `cache_control` to the system prefix, tool block, and one rolling stable conversation message; never on a per-turn volatile suffix. REMEDIATED 2026-05-17 (audit): original impl skipped all tool/assistant-toolcall messages so the rolling breakpoint collapsed onto an early message in tool loops (near-zero real cache benefit). Fixed: `cacheableMessageIndex` no longer skips tool_use/tool_result, and `mapMessages` stamps `cache_control` on the last block of tool_use / tool_result / text messages. New tool-heavy assertion in `mainstream-gap-cases.ts` proves the breakpoint rolls forward and is not on msg[0] or the volatile suffix.
- [x] 1.4 Parse cache-read/creation tokens from `message_start`/`message_delta` usage; persist them.
- [x] 1.5 Price cache-read (~0.1×) and cache-creation (~1.25×) tokens distinctly in the cost service / pricing source.
- [x] 1.6 Establish the system-prompt stable/volatile split in `employee-prompt-assembly.ts` so the cached prefix is actually stable (shared prerequisite with 3.x).
- [x] 1.7 Deterministic scenario: request carries breakpoints; unsupported provider sends none and does not error. PASS 2026-05-17: `mainstream-agent-gap-boundary`.
- [x] 1.8 Live smoke: two consecutive same-prefix turns show non-zero cache-read tokens and lower cached-prefix cost on turn 2. DESCOPED 2026-05-17: user explicitly said Anthropic does not need testing; deterministic G01 remains required evidence, and no fake live cache-token evidence is recorded.

## 2. Shell Command Classification (G02 — CRITICAL)

- [x] 2.1 Add a command-classification gate in front of `shellExec` in `packages/core/src/tools/builtin/bash-tool.ts` (TS side, before the Tauri boundary).
- [x] 2.2 Parse the command into segments (`;` `&&` `||` pipes) and classify the first token per segment (borrow `bash_validation.rs:103-274` posture).
- [x] 2.3 Catastrophic denylist → fail closed; destructive list → route through `interactionService` ask-flow (non-interactive fails closed).
- [x] 2.4 Add a per-run read-only mode that blocks write commands, `>`/`>>`, `sed -i`, mutating `git` subcommands. DEFERRED 2026-05-17 (audit): the classifier MECHANISM existed and was correct (`classifyShellCommand(cmd,{readOnly:true})`), but there was no product activation path — no plan/read-only run-mode policy field and no caller passed `readOnly`. REMEDIATED 2026-05-23 (P1 continuation audit): `RunScope.toolPolicy.readOnly` now activates per-run read-only mode; `/readonly` and `/inspect` create a read-only run from chat; `bash`, `write_file`, and `edit_file` fail closed from run scope as well as global config; `mainstream-agent-gap-boundary` now proves shell redirection and file mutation tools do not execute under a read-only run.
- [x] 2.5 Confirm the Rust path-containment layer in `apps/desktop/src-tauri/src/builtin_tools.rs` is unchanged and still in force.
- [x] 2.6 Deterministic scenarios: catastrophic denied, destructive-approved, destructive-denied, read-only-blocked. REMEDIATED 2026-05-17 (audit): original gate avoided the broken paths (no fork bomb / no `sudo`). Classifier fixed — robust fork-bomb regex (classic + named-fn), `sudo`/`doas` unwrap (`stripPrivilegeEscalation`), `wipefs` + `chmod -R 000` catastrophic, `shred` destructive. `assertShellClassification` now asserts `:(){ :|:& };:`, `bomb(){...}`, `sudo rm -rf /`, `sudo -u root rm -rf /`, `doas rm -rf /`, `wipefs`, `chmod -R 000`, `shred` — all green on fresh dist.

## 3. Real Context-Window Budget + Recovery (G03 — CRITICAL/HIGH)

- [x] 3.1 Add per-model `contextWindow` to `llm/model-registry.ts` / `model-resolver.ts`. REMEDIATED 2026-05-17 (audit): the type field existed but was never populated in production (`TauriProviderModelRegistry.findById` returned no window; `browser-runtime` set no `modelRegistry`) → prod silently used a fixed 128k for every model. Fixed via a continuously-updated source per user directive (manual per-model table rejected): `resolveModelContextWindow` reads the provider-source-registry catalog (litellm `model_prices_and_context_window.json` + openrouter, refreshed by `scripts/provider-source-registry/refresh.mjs`); injected as `ConversationBudgetServiceOptions.contextWindowResolver` in BOTH `tauri-runtime` and `browser-runtime`. Anthropic→1M, Kimi→262k, DeepSeek→131k, Gemini, OpenAI, OpenRouter now real; litellm-gap models (e.g. MiniMax) fall to the conservative 128k default (safe under-estimate, not the prior "constant for 1M models" bug).
- [x] 3.2 Replace the hardcoded `90_000` trigger (`conversation-budget/options-resolver.ts:51-52`) with `contextWindow * ratio` minus reserved output headroom. REMEDIATED 2026-05-17 (audit): now consumes the injected `contextWindowResolver` (real per-model window) in production, not only test-injected defaults.
- [x] 3.3 Replace `estimateTokens = len/4` (`message-utils.ts:27-36`) with a CJK-aware/byte-based estimate.
- [x] 3.4 Catch provider context-overflow / 413 / prompt-too-long in `llm/recorded-call.ts`; force full compact and retry once.
- [x] 3.5 Make the compaction slice in `full-compact-orchestrator.ts:82-85` tool-pair-safe (walk the boundary back; borrow `compact.rs:121-158`).
- [x] 3.6 Deterministic scenarios: window-derived trigger across two model windows, CJK not under-counted, 413 recovery, orphaned-tool-message rejection. PASS 2026-05-17: `mainstream-agent-gap-boundary` covers window trigger + CJK estimate via `context-budget-boundary`, and forced compact retry + tool-pair-safe cut via `context-overflow-recovery-and-tool-boundary`.

## 4. Soft Loop Cap + stop_reason + Abort Reconciliation (G04 — HIGH)

- [x] 4.1 Raise/parametrize `MAX_TOOL_ROUNDS` (`employee-node-constants.ts:12`) by role/model. PARTIAL/DEFERRED 2026-05-17 (audit): the constant was raised and a single global `runtimePolicy.toolLoop.maxRounds` override existed, but there was NO per-role or per-model resolution. REMEDIATED 2026-05-23 (P1 continuation audit): `RuntimeToolLoopPolicy` now supports `roleMaxRounds` and `modelMaxRounds`; `employeeNode` resolves caps by model > role > global > default via `resolveToolLoopMaxRounds`; `mainstream-agent-gap-boundary` includes `tool-loop-role-model-policy` coverage for global, role, model, and clamp behavior.
- [x] 4.2 On exhaustion, synthesize a typed partial completion instead of `finalizeEmployeeFailure` (`employee-node.ts:235-246`).
- [x] 4.3 Thread `stopReason` through `LlmResponse`/`TeeResult` (`employee-turn-runner.ts:209-214`); detect output truncation. PASS 2026-05-17: `stopReason` is plumbed and `loop-truncation-abort-checkpoint` proves `max_tokens` is surfaced as `[OUTPUT_TRUNCATED]`.
- [x] 4.4 On mid-round abort, append synthetic error tool-results for in-flight calls before finalizing (`employee-tool-round.ts`). REMEDIATED 2026-05-17 (audit): original change only deleted a `throwIfAborted` and left the real production cancel path (`recordCancellation`) unreconciled → persisted snapshot kept unmatched `tool_use` (breaks checkpoint resume); the cited gate self-proved with `signal:undefined` + always-throw executor. Fixed: reconciliation centralized in `RunConversationState.recordCancellation` (SSOT) — synthesizes failed tool-results for every unmatched pending call across ALL cancel paths. New assertion drives `recordPendingToolCalls` + `recordToolResults` (one done) + `recordCancellation` and proves no unmatched `tool_use` remains.
- [x] 4.5 Deterministic scenarios: soft-cap partial terminal, truncation detected, abort leaves no unmatched `tool_use`, checkpoint resume well-formed. PASS 2026-05-17: `tool-loop-max-rounds-fails-fast` covers soft-cap partial + checkpoint identity; `loop-truncation-abort-checkpoint` covers truncation and synthetic tool-result reconciliation.

## 5. Tool Input Validation + Result Size Cap + Core Builtins (G05, G06 — HIGH)

- [x] 5.1 Add per-tool input validation (zod over existing JSON schema) in `CompositeToolExecutor.execute` before dispatch; structured rejection.
- [x] 5.2 Add `maxResultSizeChars` to `ToolDef`; spill oversized results to disk with a bounded preview in the result-formatting block.
- [x] 5.3 Add `edit_file` (old/new-string + ambiguous-match guard), `glob`, `grep`, `web_fetch` on the existing Rust sandbox.
- [x] 5.4 Add `offset`/`limit` + 1-based line numbers to `read_file`; add read-before-write guard to `write_file`.
- [x] 5.5 Deterministic scenarios: malformed-input rejection, oversized-result spill, ambiguous-edit rejection, glob/grep scoped result. PASS 2026-05-17: `mainstream-agent-gap-boundary`.

## 6. Retry / Idle / Fallback (G07 — HIGH)

- [x] 6.1 Classify SDK connection/timeout errors as recoverable in `errors.ts` (status `undefined` today → never retried).
- [x] 6.2 Honor `Retry-After` in `llm/retry.ts:computeDelay` (overrides backoff cap).
- [x] 6.3 Detect mid-stream overloaded body in `anthropic-adapter.ts` stream-path `mapError`. REMEDIATED 2026-05-17 (audit): original detection was dead code on the real SDK path (overloaded regex ran after the `instanceof APIError` branch; SDK wraps overloaded as `APIConnectionError` with the body in `.cause`). Fixed: `mapError` now scans the full surface (`extractAnthropicErrorText`: message + cause chain + body) and forces status 529 so `isCapacityError`/capacity-fallback fires; also added `x-should-retry` directive support (`errors.ts` `shouldRetry` option, server directive overrides) and fixed the `timed out` regex gap. CLOSED 2026-05-23 P1 continuation: `recordedLlmStream` now buffers per-attempt chunks when capacity fallback is available, discards failed mid-stream partial output, and emits only the successful attempt's chunks, so the fallback boundary no longer leaks stale partial UI/event content.
- [x] 6.4 Add a stream inactivity watchdog (reset on each event; abort after the idle window).
- [x] 6.5 Expose a deterministic registry fallback model + downgrade after N consecutive capacity errors (`model-registry.ts:91-114`).
- [x] 6.6 Deterministic scenarios: connection-error retry, Retry-After honored, stalled-stream abort, unknown-model fallback. PASS 2026-05-17: `mainstream-agent-gap-boundary` covers Retry-After, stopReason, unknown-model fallback, and repeated capacity downgrade; idle watchdog remains covered by adapter code path, not a timed soak. PASS 2026-05-23 P1 continuation: same scenario now simulates a mid-stream capacity error after stale partial output and asserts only fallback stream chunks are emitted/recorded.

## 7. Veto Hook + Argument-Aware Permission (G08 — HIGH)

- [x] 7.1 Add `tool.before`/`tool.after` hook events with `allow()/block()/updateInput()` consumed in `AuditingToolExecutor.execute`.
- [x] 7.2 Feed tool arguments into `ToolPermissionRequest`; match rules on command/path content (`tool-permission-engine.ts:202`).
- [x] 7.3 Remove name-regex MCP auto-allow (`tool-permission-engine.ts:96`); unknown MCP defaults to ask; trust read-only only from server annotations.
- [x] 7.4 Deterministic scenarios: hook-deny, hook-update-input, arg-matched destructive, spoofed-name not auto-allowed. PASS 2026-05-17: `mainstream-agent-gap-boundary`.

## 8. Isolated Sub-Run Primitive (G09 — HIGH, divergence recorded)

- [x] 8.1 Implement an isolated sub-run (fresh message list + scoped tool subset + typed summary handoff) reusing the `a2a/fork-sub-context.ts` seam.
- [x] 8.2 Route delegated work through it instead of shared-`OffisimGraphState` re-entry (`employee-handoff.ts:99-131`) where the org metaphor allows. PASS 2026-05-17: `executeHandoff` now keeps handoff records/taskRuns but routes receiver work through `forkSubContext`; parent receives typed summary and no handoff continuation is pushed into shared `pendingAssignments`.
- [x] 8.3 Record the org-graph product divergence as a non-copy decision (kept by design).
- [x] 8.4 Deterministic scenario: sub-run context isolated, tools scoped, parent gets summary not full transcript. PASS 2026-05-17: `mainstream-agent-gap-boundary`.

## 9. Truth-Source Correction (G10 — blocking)

- [x] 9.1 Code-verify the MCP client implementation against `packages/core/src/mcp/` before editing any doc.
- [x] 9.2 Correct `openspec/protocols-ledger.md`, `openspec/harness-capability-map.md`, and the repo-local memory MCP entry to `client ✓; resources/prompts/HTTP/OAuth pending`. PASS 2026-05-17: `openspec/protocols-ledger.md`, `openspec/harness-capability-map.md`, and root `CLAUDE.md` are corrected; system-level Codex memory is explicitly out of scope unless the user requests a memory update.
- [x] 9.3 Grep-check no bare `MCP ❌` claim remains in active truth sources.

## 10. Archive Gate

- [x] 10.1 Spec / tasks / docs three-check (per root `CLAUDE.md` OpenSpec Archive Gate). PASS 2026-05-17: `openspec validate close-harness-mainstream-agent-gaps --strict`.
- [x] 10.2 Sync `openspec/protocols-ledger.md` for any protocol/SDK rows this change touches (MCP, Anthropic transport).
- [x] 10.3 Each completed `G`-row has its required gate evidence (deterministic + live where the row demands live). CORRECTED 2026-05-17 (audit): the prior "release `.app` launch/load passes" claim was FABRICATED — no release `.app` evidence exists and a release `.app` gate was never in this change's scope (design.md only required deterministic harness gates for these G-rows). Honest state: `harness:contract` + `harness:replay` both `ok:true` on fresh dist after remediation; Anthropic live cache-token smoke is product-descoped per explicit user direction ("Anthropic 不需要 smoke test"); no fake live evidence recorded.
- [x] 10.4 No row marked complete with a missing gate or unresolved source anchor. CORRECTED 2026-05-17 (audit): tasks 2.4 (per-run read-only activation) and 4.1 (role/model cap) were honestly UNCHECKED with deferral reasons rather than fake-green; the G07 mid-stream retry-boundary restructure was noted deferred on 6.3. CLOSED 2026-05-23 P1 continuation: G02 read-only activation, G04 role/model cap, and G07 mid-stream fallback boundary now have deterministic evidence.

## Post-Archive Audit Remediation (2026-05-17)

This change was archived prematurely: 54/54 `[x]` with zero implementation commit and
no live evidence. A six-domain adversarial re-audit found genuine engineering for
G05/G06/G08/G09/G10 + G03(413+boundary) + G04(soft-cap/stopReason), but fake-checked
or shallow items elsewhere. Remediation (no Codex; done in-session):

- G01 — rolling cache breakpoint no longer skips tool_use/tool_result; stamps
  cache_control on the last block of all three message kinds; tool-heavy assertion added.
- G02 — fork-bomb regex robust; `sudo`/`doas` unwrap; `wipefs`+`chmod -R 000`
  catastrophic; `shred` destructive; assertions for the previously-avoided paths.
- G03 — real per-model contextWindow via the continuously-updated provider-source-registry
  catalog (litellm+openrouter), injected as `contextWindowResolver` in BOTH runtimes
  (manual per-model table rejected per user directive). litellm-gap models fall to a
  conservative under-estimate, not the prior model-independent constant bug.
- G04 — abort reconciliation centralized in `recordCancellation` SSOT; covers all
  cancel paths; non-self-proving assertion added.
- G07 — `mapError` full-surface overloaded detection (forces 529 → capacity fallback
  works); `x-should-retry` directive honored; `timed out` regex fixed; mid-stream
  failed-attempt partial output is discarded before fallback chunks are emitted.

Honestly NOT done (left unchecked / deferred, not fake-green): none in G01-G10 after
the 2026-05-23 P1 continuation audit. G02 read-only activation (2.4), G04
role/model cap (4.1), and G07 mid-stream retry-boundary restructure are closed.
No release `.app` gate (never in this archived change scope; prior claim was
fabricated and corrected). Anthropic live smoke product-descoped per user.

Verification: core/ui-office/apps-web typecheck exit 0 on fresh dist;
`pnpm harness:contract` + `pnpm harness:replay` both `ok:true` on freshly rebuilt
core dist, including the strengthened assertions. 2026-05-23 P1 continuation:
`pnpm --filter @offisim/core typecheck`, explicit core dist rebuild,
`pnpm harness:contract` (100 scenarios, 13 mainstream gap cases),
`pnpm harness:replay`, and `pnpm validate` passed.
