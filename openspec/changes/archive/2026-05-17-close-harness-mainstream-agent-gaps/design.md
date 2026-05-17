## Context

The `complete-claude-parity-full-agent-harness` change established a parity *ledger and gate* program. Its `default-agent-harness` "parity floor" requirement enumerates capabilities as a pre-release checklist, and its `F`-rows anchor reference behavior — but a checklist bullet such as "context budget, compaction, prompt-too-long recovery" can be marked satisfied by a deterministic scenario while the shipped code still uses a blind char-estimate trigger. The 2026-05-17 six-domain audit confirmed exactly that pattern across four critical and several high-severity dimensions.

This change is the behavioral-implementation counterpart. It does not re-litigate parity scope; it converts the audit's concrete `file:line` findings into testable obligations, each mapped through `reference-feature-map.md` `G`-rows to the reference business logic so implementation can borrow the *logic* (not the code).

ClaudeSource is the stronger reference for loop/streaming/compaction/caching orchestration; ClaudeRust is the stronger reference for command-validation discipline and typed cache-token accounting. Offisim combines both and records deliberate divergence (notably G09).

## Goals / Non-Goals

**Goals**

- Eliminate the four production-biting gaps (prompt caching, shell validation, context-window budgeting, loop cap/stop-reason) with source-mapped, testable requirements.
- Make cache tokens, retry classification, tool-input validation, and tool-result size first-class instead of structurally unrepresentable.
- Add the missing core local-productivity builtins (Edit/Glob/Grep/WebFetch) on the existing hardened sandbox.
- Add an extensible, veto-capable tool-lifecycle hook and argument-aware permission matching.
- Scope (not necessarily ship in one apply) a genuine isolated sub-run primitive while keeping the org metaphor.
- Correct one stale truth-source claim that misdirects future agents.

**Non-Goals**

- No copy of reference source, prompts, or UI.
- No removal of the org-graph product metaphor; G09 adds a primitive under it.
- No weakening of the Rust sandbox; G02 is an additive front gate.
- No claim that a green harness scenario closes a row whose gate still requires live evidence; the Anthropic cache-token live smoke was product-descoped on 2026-05-17 and must be recorded as "not run", not replaced with fake live evidence.
- No new provider product lane; transport changes stay inside `harness-model-transport-boundary`.

## Decisions

### D0. Source-backed `G`-rows are scope authority

Every task, scenario, and PR maps to a `G`-row. Unmapped work is out of scope unless a row is added. `G`-rows cite the related `F`-row so the parity ledger and this change stay coherent rather than competing.

### D1. Prompt caching — G01 (CRITICAL, highest ROI)

**Borrowed logic.** ClaudeSource places a small, bounded set of ephemeral `cache_control` breakpoints: one on the system-prompt prefix (`claude.ts:3283` `buildSystemPromptBlocks`), one on the tool block, and a single *rolling* breakpoint on the last stable conversation message (`claude.ts:3131` `addCacheBreakpoints`), with TTL gating (`getCacheControl` `:361`). ClaudeRust treats cache effectiveness as ledgered state: `Usage` carries `cache_creation_input_tokens`/`cache_read_input_tokens` (`types.rs:187-189`) and `prompt_cache.rs` fingerprints the request and tracks a minimum-drop heuristic.

**Offisim target.** On the Anthropic route only, `anthropic-adapter.ts` attaches `{type:'ephemeral'}` to (a) the last system block, (b) the last tool definition, (c) a rolling breakpoint on the last stable conversation message (never on a volatile suffix). `LlmUsage` gains `cacheReadInputTokens`/`cacheCreationInputTokens`, parsed from `message_start`/`message_delta`, persisted in `llm_calls`, and priced (cache-read ≈ 0.1×, cache-write ≈ 1.25× input) in the cost service.

**Decision / trade-off.** Breakpoint placement must respect the system-prompt assembly order; the prompt-assembly stable/volatile split (see D3) is a prerequisite for a high cache-hit rate. MiniMax/OpenAI-compat routes (the live default) gate behind a per-provider `supportsPromptCaching` capability flag and no-op when false — never error, never send Anthropic-only fields to a compat endpoint. This is the single highest-ROI item and is sequenced first.

### D2. Shell command classification — G02 (CRITICAL, highest risk)

**Borrowed logic.** ClaudeRust `bash_validation.rs:103-274` parses and classifies: `validate_read_only` blocks writes/redirections in read-only mode; `check_destructive` flags `rm -rf /|~|*`, fork bombs (`:(){`), `dd if=`, `chmod -R 777`, `mkfs`, `> /dev/sd*`. ClaudeSource `bashSecurity.ts` adds shell-grammar awareness — substitution/backtick/heredoc/IFS injection (`:1-70`) and Zsh-expansion bypass patterns (`:851-860`).

**Offisim target.** A classification gate runs in front of `shellExec` (TS side, before the Tauri boundary): split the command on `;`, `&&`, `||`, pipe segments; classify the first token of each segment. Catastrophic patterns → fail closed (`Block`). Destructive-but-legitimate patterns (`rm -rf <path>`, `git push`, `git reset --hard`, `chmod -R`) → route through the existing `interactionService` ask-flow so non-interactive runs fail closed. A per-run read-only mode blocks write commands and `>`/`>>`/`sed -i`/mutating `git` subcommands.

**Decision / trade-off.** The Rust path-containment layer in `builtin_tools.rs` stays unchanged and is defense-in-depth; this gate is *command-intent* classification it cannot do. We accept that a perfect shell parser is out of scope — a denylist of catastrophic patterns plus first-token-per-segment classification matches the ClaudeRust posture and closes the highest-stakes hole; full tree-sitter parsing (ClaudeSource depth) is a documented follow-up, not a blocker.

### D3. Real context-window budgeting + reactive recovery + pair-safe boundary — G03 (CRITICAL)

**Borrowed logic.** ClaudeSource derives the trigger from the *real* model window: `getEffectiveContextWindowSize` = `getContextWindowForModel(model)` minus reserved output (`MAX_OUTPUT_TOKENS_FOR_SUMMARY ≈ 20000`), and `getAutoCompactThreshold` applies a ratio (`autoCompact.ts:33-90`); a reactive `reactiveCompact` fallback fires on a provider context-overflow error (`:189-223`). ClaudeRust `compact.rs:121-158` documents and implements walking the compaction boundary back so a `tool_use` is never separated from its `tool_result` (otherwise OpenAI-compat returns 400), and emits a synthetic continuation system message (`:71-92,175`).

**Offisim target.** Add per-model `contextWindow` to the model registry. The conversation-budget trigger becomes `contextWindow * ratio` with reserved output headroom, replacing the hardcoded `90_000` and the `len/4` estimate (which also under-counts CJK 3–4× — use a byte-based or CJK-aware estimate). `recorded-call.ts` catches provider context-overflow / 413 / `prompt_too_long`, forces a full compact, and retries once. The compaction slice in `full-compact-orchestrator.ts` walks back so it never orphans a `tool` message.

**Decision / trade-off.** The compaction *machinery* (durable baseline, versioning, circuit-breaker, events) is already strong — keep it; only the *trigger input* and *boundary safety* change. The `conversation-budget-service-boundaries` spec currently asserts "observable budget behavior unchanged after refactor"; that invariant is intentionally and explicitly narrowed (see spec delta) so this deliberate evolution is not self-blocked. Without a real tokenizer we accept estimate error, but anchoring to the real window plus a 413 safety net bounds the failure mode.

### D4. Soft loop cap + `stop_reason` + abort reconciliation — G04 (HIGH)

**Borrowed logic.** ClaudeSource treats the turn cap as a *soft* terminal: `{reason:'max_turns'}` is a normal return, not an error (`query.ts:1759-1766`), with explicit `max_output_tokens` (`:1191-1259`) and prompt-too-long (`:1088-1186`) recovery; on abort it synthesizes tool-results for in-flight tools and `yieldMissingToolResultBlocks` so history is never left with an unmatched `tool_use` (`:1018-1055`, `:126-152`). ClaudeRust defaults `max_iterations: usize::MAX` and breaks cleanly on empty tool blocks (`conversation.rs:185,400-402`).

**Offisim target.** Raise the default cap substantially and make it role/model-configurable; on exhaustion synthesize a typed partial completion ("stopped after N rounds — partial result"), not `finalizeEmployeeFailure`/blocked. Thread a `stopReason` through `LlmResponse`/`TeeResult`; detect output truncation (output tokens hitting `maxTokens`). On mid-round abort, append synthetic error tool-results for every dispatched-but-unfinished call before finalizing.

**Decision / trade-off.** A 5-round ceiling structurally truncates any non-trivial task (read→analyze→write→verify already burns 4). The richer engine-lane loop exists but is not the default; converging both is out of scope here — this change fixes the *default provider lane* and documents the divergence for a later convergence change.

### D5. Tool input validation + result size cap — G05 (HIGH)

**Borrowed logic.** ClaudeSource validates input against a zod schema and rejects with `{result:false,message,errorCode}` *before* side effects (`Tool.ts:489-493`); each tool declares `maxResultSizeChars` and spills oversized output to disk with a preview. ClaudeRust validates the command (`bash_validation.rs:594`) and persists oversized output (`bash.rs:63-66`).

**Offisim target.** Carry a per-tool validator (zod over the existing JSON schema) invoked in `CompositeToolExecutor.execute` before dispatch; reject malformed input structurally instead of `as string` casting it into the sandbox. Add `maxResultSizeChars` to `ToolDef` and spill-with-preview in the result-formatting block (MCP/`read_attachment` results currently flow back unbounded; only history *length* is trimmed, never *size*).

### D6. Core Edit/Glob/Grep/WebFetch builtins — G06 (HIGH)

**Borrowed logic.** ClaudeSource's catalog has match-based `FileEdit` with a uniqueness check (`FileEditTool.ts:138,316-352`), `Glob`, `Grep`, `WebFetch`, and `FileRead` offset/limit + `cat -n` line numbers (`FileReadTool.ts:227-244`). ClaudeRust `file_ops.rs:129-476` implements glob/grep/edit on its sandbox.

**Offisim target.** Add `edit_file` (old/new-string + uniqueness), `glob`, `grep`, `web_fetch` backed by the existing Rust sandbox; add `offset`/`limit` + 1-based line numbers to `read_file`; add a read-before-write guard to `write_file`. This removes the anti-pattern where every edit/search is funneled through `bash` — the exact failure mode the dedicated tools exist to prevent.

### D7. Retry classification + idle watchdog + model fallback — G07 (HIGH)

**Borrowed logic.** ClaudeSource `withRetry.ts:696-755` retries connection errors and honors `x-should-retry`; `:519-548` honors `Retry-After` (overriding computed backoff); `:719-724` detects the mid-stream `"type":"overloaded_error"` body the SDK drops; `claude.ts:2600-2624` downgrades model after consecutive 529s. ClaudeRust classifies `is_connect/is_timeout/is_request` (`error.rs:131`) with jittered backoff (`anthropic.rs:569-585`).

**Offisim target.** Classify SDK `APIConnectionError`/timeout as recoverable (status is `undefined` today → never retried); thread `Retry-After` into `computeDelay`; detect overloaded body in stream-path `mapError`; add a stream inactivity watchdog (reset on each event, abort after 30–60 s of silence); expose a deterministic registry fallback model and downgrade after N consecutive capacity errors instead of returning `null`.

### D8. Extensible veto hook + argument-aware permission — G08 (HIGH)

**Borrowed logic.** ClaudeRust consumes a `PermissionOverride::{Allow,Deny,Ask}` from hook context *inside* `authorize_with_context(tool, input, …)` before execution (`permissions.rs:164-280`, `hooks.rs:19-240`); decisions match against tool *input*, not just name. ClaudeSource `useCanUseTool.tsx:64-170` routes allow/deny/ask with input-aware matching (`permissions.ts:122-260`).

**Offisim target.** Add a `tool.before`/`tool.after` hook event carrying an `allow()/block(reason)/updateInput()` payload, consumed synchronously in `AuditingToolExecutor.execute` before `this.inner.execute(call)` (the interception point already exists). Feed tool arguments into `ToolPermissionRequest` so rules match command/path content. Remove the spoofable name-regex MCP auto-allow (`tool-permission-engine.ts:96`); default unknown MCP tools to `ask`, trusting read-only only from server-declared annotations.

### D9. Isolated-context sub-run primitive — G09 (HIGH, deliberate divergence)

**Borrowed logic.** ClaudeSource `AgentTool` spawns a subagent with its *own* context messages and a per-spawn `allowedTools` scope (`runAgent.ts:300,465-476`), with fork/resume (`forkSubagent.ts`, `resumeAgent.ts`) and user-defined agent dirs. ClaudeRust isolates via session identity + worker boot (`session.rs:263-283`, `worker_boot.rs:28-87`).

**Offisim target.** Keep the boss/manager/employee org metaphor (product UX), but introduce an isolated sub-run: a dispatched task gets a fresh message list, a scoped tool subset, and returns a typed summary handoff — reusing the existing `a2a/fork-sub-context.ts` seam as the entry point instead of re-entering the employee node against shared `OffisimGraphState`.

**Decision / trade-off.** This is the one row where Offisim deliberately diverges from the mainstream pattern at the product layer; the divergence is recorded as a non-copy decision. The architectural risk (prompt bloat, cross-task context leakage, no blast-radius containment) is real, so the primitive is in scope, but full convergence of the org-graph onto isolated sub-runs is staged — this change requires the primitive and its isolation gate, not a wholesale graph rewrite.

### D10. Truth-source correction — G10 (MED, blocking truth fix)

**Decision.** The audit found the MCP client is materially implemented (stdio Rust bridge + SSE official SDK + tool bridging + audit + permission gate) while `openspec/protocols-ledger.md` and the repo-local memory index still had stale MCP truth. Before rewriting any ledger line, the implementer spot-checks the code (per verification discipline — do not propagate a subagent claim into a durable doc unverified), then corrects the ledger/repo memory index to `client ✓; resources/prompts surfacing + Streamable HTTP + OAuth pending`. This is a blocking truth-source task because stale entries actively misdirect future change decisions. System-level Codex memory is outside this OpenSpec change unless the user explicitly requests a memory update.

## Sequencing

ROI × risk order, each independently apply-able: **G01 → G02 → G03 → G04 → G05/G06 → G07 → G08 → G09 → G10**. G10 may land alongside any phase. G01 depends on the prompt-assembly stable/volatile split (D1↔D3 share the assembly-ordering concern). G03's pair-safe boundary should land before or with G04's abort reconciliation since both touch message-history well-formedness.
