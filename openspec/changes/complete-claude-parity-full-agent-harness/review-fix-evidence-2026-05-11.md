# Full-Agent Review Fix Evidence - 2026-05-11

Change: `complete-claude-parity-full-agent-harness`

## Outcome

The review findings are real and fixed in code, but the production gate does not support keeping `codex-engine:sdk-native-full-power` promoted under the current Offisim release configuration.

Final product status:

- `codex-engine:sdk-native-full-power`: `blocked`
- `claude-engine:sdk-native-full-power`: `blocked`
- `openai-engine:sdk-native-full-power`: `blocked`
- `claude-engine:gateway-bridged-tools`: `blocked`

Reason: the release app selected model is `MiniMax-M2.7`. After the model-pass-through fix, Codex local auth rejects that model with a 400 unsupported-model error. Per the release rule, this must fail closed and the profile must not remain promoted.

## Code Fixes

- `apps/web/src/lib/tauri-engine-adapters.ts`
  - `serializeRequest()` always passes `model: envelope.model`.
  - Full-agent requests now use `approvalPolicy: "on-request"` while the profile is blocked; approval bypass is not allowed without a separately verified policy.
- `scripts/tauri-codex-agent-host.mjs`
  - Missing `model` now returns `invalid-request`.
  - `gateway-bridged-tools` is rejected by the Codex native host.
  - `enableNativeRuntimeEvents` is accepted only for `sdk-native-full-agent`.
  - `sdk-native-full-agent` with `approvalPolicy: "never"` now returns `invalid-request`.
  - Lifecycle checkpoint/rollback evidence is scoped to an ephemeral fork thread and only runs when an explicit lifecycle verification probe is requested; normal full-agent turns do not get synthetic checkpoint/rollback events.
  - MCP host states map into product states as `ready -> connected`, `starting -> degraded`, `error -> failed`, `shutdown -> shutdown`, and unknown states -> `degraded`.
  - Native shell events preserve the real tool name and add `evidenceToolName: "bash"` only for shell/command execution.
- `packages/core/src/agents/employee-engine-executor.ts`
  - SDK-native tools no longer all count as `bash`.
  - Native tools without an explicit evidence alias become `sdk-native:<toolName>`.
  - Gateway-bridged runtime tools become `gateway-bridged:<toolName>`.
- `packages/core/src/agents/employee-completion.ts`
  - Completion verification is scoped to the current `taskRunId`.
- `packages/core/src/agents/employee-tool-round.ts`
  - Default Offisim tool results now carry `taskRunId` into completion evidence.
- `packages/core/src/engine/capability-profiles.ts`
  - Codex SDK-native full-power is back to `blocked` with the selected-model release blocker.
- `packages/core/src/testing/engine-profile-runner.ts`
  - The deterministic profile gate now expects Codex full-power to be blocked.
- Runtime binding presentation
  - The Codex full-agent card no longer says "promoted" when the profile is blocked.

## Release App Evidence

Final rebuilt app:

- Path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Executable: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop`
- SHA256: `bf10cbcb54a79f94cb5ed312fe2f5793179b0e35e480d9d458134991a0254525`
- Timestamp: `2026-05-11 01:43:21 +1200`
- Computer Use attachment: `com.offisim.desktop`, pid `77420`
- Window URL: `tauri://localhost/settings/runtime`

Computer Use observed in the final release app:

- Active provider footer: `MiniMax-M2.7`
- `Codex full-agent` card shows `blocked`.
- Card description: `Blocked until selected-model release evidence passes.`
- Blocker text includes: `selected model MiniMax-M2.7; Codex local-auth returned 400 model unsupported for ChatGPT account`.
- `Codex text engine`, `Claude text engine`, and `OpenAI text engine` still show full-agent targets unavailable.
- Main harness remains `Default owner Offisim core`; replacement remains unavailable until release evidence.

## Failed Release Smoke Evidence

Release app task without project context:

- Task id: `tr-yolo-2274aac6-002d-454c-aed0-2c049af036fa`
- Status: `failed`
- Error: `No workspace_root is bound for the trusted Codex project.`
- Provider/model recorded: `anthropic` / `MiniMax-M2.7`
- Meaning: the native host fails closed when `All` has no bound project workspace.

Release app task with `Release Verify Clean 20260510` project selected:

- Task id: `tr-yolo-a6838d85-2026-44db-9a59-148f3b8888e5`
- Status: `failed`
- Error: `Codex app-server reported an error.`
- Provider/model recorded: `anthropic` / `MiniMax-M2.7`
- Meaning: after project binding succeeds, the selected-model mismatch is the remaining release blocker.

Direct Codex CLI confirmation:

- Command shape: `codex exec --model MiniMax-M2.7 ...`
- Result: OpenAI/Codex returned status 400 with message that `MiniMax-M2.7` is not supported when using Codex with a ChatGPT account.

Control probe with a Codex-supported model:

- Host script: `scripts/tauri-codex-agent-host.mjs`
- Model: `gpt-5.4`
- Result: `GPTMODEL_OK /Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Runtime evidence included `tool_started` and `tool_completed` for real tool `pwd` with `evidenceClass: "sdk-native"` and `evidenceToolName: "bash"`.
- Meaning: the sidecar/event bridge can work with a Codex-supported model; the release profile is still blocked because current product selection passes `MiniMax-M2.7`.

## Gates

Passed after the review fix:

- `git diff --check`
- `pnpm --filter @offisim/core typecheck`
- `pnpm --filter @offisim/desktop-renderer typecheck`
- `pnpm harness:contract -- --force-build`
- `pnpm harness:engine-profiles -- --force-build`
- `pnpm harness:model-bench -- --force-build --report-file openspec/changes/complete-claude-parity-full-agent-harness/model-bench-report-2026-05-11.json`
- `pnpm --filter @offisim/desktop-renderer build`
- `pnpm --filter @offisim/desktop build`

`model-bench-report-2026-05-11.json` records:

- deterministic cases: `52`
- SDK-native route status: `blocked`
- SDK-native gateSatisfied: `true`
- SDK-native evidenceQuality: `blocked-missing-release-evidence`
- gateway-bridged route status: `blocked`

## Product Decision

Do not promote `codex-engine:sdk-native-full-power` again until one of these is true and proven in the release app:

- the active Offisim selected model for Codex full-agent is Codex-supported, or
- the product exposes a dedicated Codex model selector separate from the global MiniMax provider model, and that exact selection is passed through the release app smoke.

Until then, the correct production behavior is unavailable/blocked, not silent fallback to a Codex default model.

## Runtime Evidence Guard Fix - 2026-05-11

Additional audit findings fixed after the first review-fix evidence:

- Full-agent lifecycle probe no longer rolls back the main session thread. It resumes the main thread only for identity evidence, forks an ephemeral thread, records checkpoint/rollback ids against that fork, and skips rollback when fork creation fails.
- Full-agent requests no longer default to `approvalPolicy: "never"`. The renderer adapter sends `on-request`, and the Codex host rejects `sdk-native-full-agent + never` as an invalid request until a future verified approval-bypass policy exists.
- MCP transient/error states no longer leak as illegal product statuses. `starting` degrades, `error` fails, and unknown host states degrade.
- `scripts/harness-contract.mjs` now asserts these boundaries against both the source host and bundled release resource so future evidence work cannot regress into main-thread rollback, approval bypass, dirty MCP states, or source/resource drift.

Additional simplify pass fixes:

- Legacy `task_runs` constraint rebuild now runs foreign-key pragma changes, table rebuild, rollback, and restore on one acquired SQLite connection instead of relying on pool connection reuse.
- Codex native tool call tracking now releases completed `function_call` entries and keeps only a bounded duplicate-suppression set.
- Codex SDK-native full-power profile now appends selected-model blockers to the generic full-agent missing gates instead of replacing the generic blockers.
