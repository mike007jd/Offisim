# Multi-Agent Provider Stress Record - 2026-05-06

## Goal

Use the newly configured real providers to create a company, add custom employees, distribute employees across providers as evenly as possible, run a multi-agent collaboration task, and record blockers, product bugs, and UX issues before attempting fixes.

## Provider Scope

The run used the provider set requested from Hermes Agent / OpenClaw-style usage rather than the full 148-provider catalog.

Default UI provider scope after review: Codex, OpenAI API, Claude, Anthropic API, OpenRouter, Kimi, Qwen / Model Studio, MiniMax, GLM / Z.AI, Gemini, DeepSeek, LM Studio, and Custom Compatible. This keeps the normal picker to 13 product entries while covering the provider families both Hermes Agent and OpenClaw prominently document.

Provider refresh behavior after follow-up: the "拉取 provider list" action now fetches the current Hermes Agent provider docs and OpenClaw model provider docs first, then filters LiteLLM/OpenRouter model metadata to that agent-scoped provider set. A release-app pull on 2026-05-07 returned Hermes Agent 34 providers, OpenClaw 40 providers, 11 matching LiteLLM metadata providers, and 370 OpenRouter live models.

- MiniMax: `MiniMax-M2.7`
- Z.AI: `GLM-5.1`
- OpenRouter: `openai/gpt-oss-120b:free`

Config gap: only three provider/model groups are configured locally. The user mentioned four, but no fourth working credential/model group was provided in `.env.local`, so a true four-way even split could not be executed without inventing a provider.

External references checked:

- Hermes Agent provider docs: https://hermes-agent.nousresearch.com/docs/integrations/providers
- OpenClaw model provider docs: https://github.com/openclaw/openclaw/blob/main/docs/concepts/model-providers.md
- Microsoft AutoGen documents multi-agent orchestration patterns and benchmarking as separate concerns: https://github.com/microsoft/autogen
- LangGraph documents supervisor-style multi-agent routing where the supervisor coordinates specialist agents: https://langchain-ai.lang.chat/langgraph/agents/multi-agent/
- OpenRouter provides a live models endpoint for current model metadata: https://openrouter.ai/api/v1/models
- LiteLLM publishes a shared provider/model metadata catalog: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json

## Harness Results

Deterministic harnesses passed:

- `pnpm harness:contract`: 63 scenarios, all invariants passed.
- `pnpm harness:replay`: all listed replay scenarios passed.
- `pnpm harness:provider-adapter`: OpenAI and Anthropic partial tool/function argument adapter cases passed; OpenAI and Anthropic chat timeout cases passed.

Live provider smoke, non-streaming:

- MiniMax: success, returned `MINIMAX_OK`, latency about 9.9s.
- Z.AI: success, returned `ZAI_OK`, latency about 6.4s.
- OpenRouter: success, returned `OPENROUTER_OK`, latency about 2.6s.

Live provider load, 8 iterations, concurrency 4, no streaming, low token budget:

- MiniMax: 8/8 API success, but some empty content and format drift.
- Z.AI: 8/8 API success, but all samples returned empty content at the low token budget.
- OpenRouter: 8/8 API success, generally usable output, but some Markdown wrapping and provider-name drift.

High token retest, 4 iterations, concurrency 2:

- Z.AI: output became non-empty, but format/provider labels still drifted.
- MiniMax: output improved, but sometimes leaked long reasoning instead of strict JSON.

## Release App Live Run

Release app used:

`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

Company created:

`Multi Model Harness Stress Co`

Employees present:

- 9 seeded template employees
- `MiniMax Stress Engineer`
- `ZAI Planning Engineer`
- `OpenRouter QA Analyst`

Total: 12 employees.

Custom employee provider UI check:

- Personnel > Profile > Config only exposed `Default` and `Custom`.
- `OpenRouter QA Analyst` accepted model preference `openai/gpt-oss-120b:free`.
- The subsequent team run still showed `MiniMax-M2.7` at runtime, so this saved profile setting does not appear to route that employee through OpenRouter in live team execution.

Team task submitted:

`压测任务：请把这 12 个员工分成四组合作，分别负责需求拆解、技术方案、风险审计、最终总结。请明确每组负责人和交付物，最后输出一个短报告。`

Observed release app state:

- Scene showed 12 participants and manager present.
- Status showed `PLANNING`.
- Runtime status showed `PM is calling MiniMax-M2.7`.
- Progress stayed at `0/12P`.
- Latency exceeded 216s.
- Chat input stayed disabled with `Task in progress - waiting for current round to finish`.
- The Stop button and Escape key did not end the run.
- The app had to be closed to prevent continued token usage.

## Recorded Issues

## Post-Fix Verification

Build and harness gates after fixes:

- `pnpm --filter @offisim/core typecheck`: passed.
- `pnpm --filter @offisim/web typecheck`: passed.
- `pnpm --filter @offisim/ui-office typecheck`: passed.
- `pnpm --filter @offisim/ui-office build`: passed.
- `pnpm harness:contract`: passed, 63 contract scenarios.
- `pnpm harness:replay`: passed, including `boss-summary-single-empty-output-completes`.
- `pnpm --filter @offisim/desktop build`: passed and produced the release app at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.

Release app live verification after rebuilding:

- Exact release app path launched; process changed from the old app process to the rebuilt release app process.
- Retest prompt: `全员复测2：请让所有 12 个员工共同合作，分成四组分别负责需求拆解、技术方案、风险审计、最终总结。每个员工都要参与，最后输出短报告。`
- The run moved from Boss to PM to `EXECUTING`; it did not remain stuck at `PLANNING 0/12P`.
- SQLite release data showed 12 task runs created for the current team thread, one per enabled employee in `Multi Model Harness Stress Co`.
- Stop interrupted the live run and converted remaining queued/running work to cancelled/failed states instead of continuing token usage.

Additional release app provider-split verification:

- Employee configs were set to a 4/4/4 split: `MiniMax-M2.7`, `GLM-5.1`, and `openai/gpt-oss-120b:free`.
- The release app originally kept `GLM-5.1` and OpenRouter calls under provider `anthropic`. Root cause: the desktop command that exposes non-secret provider profiles was registered in Rust but not included in the Tauri command allowlist, so the webview silently received an empty runtime model registry.
- After adding `runtime_provider_profiles` to the desktop permission allowlist and rebuilding the release app, `llm_calls` showed employee calls with:
  - `employee / anthropic / MiniMax-M2.7`
  - `employee / openai-compat / GLM-5.1`
  - `employee / openai-compat / openai/gpt-oss-120b:free`
- The deterministic scenario `employee-profile-model-preference-used` also passed and asserts that an employee model preference resolves to `openai-compat / employee-special-model`.
- The deterministic scenario `boss-summary-single-empty-output-completes` passed and asserts a single employee with empty text/no artifact completes with a clear fallback summary instead of throwing `Expected a single employee result for boss summary fast path`.
- Release Settings > Provider live verification confirmed the rebuilt `.app` exposes "拉取 provider list", pulls from Hermes Agent/OpenClaw docs, and updates the catalog summary without changing saved credentials.
- A final short release run completed and confirmed real MiniMax, GLM/Z.AI, and OpenRouter employee calls in the rebuilt app. That run also exposed a duplicate task assignment for `YOLO Master`; the planner sanitizer now de-duplicates same-step employee assignments, and `manager-whole-team-dispatches-all-employees` now asserts `taskRunsExactlyEmployees` so this regression is covered deterministically.

Remaining live UX debt:

- A stopped run can briefly remain visually in `DELIVERING` while the final reporting state catches up.
- One interrupted employee response said "11 employees" even though the task-run table had all 12 employees represented. The dispatch layer is fixed, but interrupted generated prose can still be inconsistent.
- Boss/manager can still over-select or under-select employees for tightly constrained prompts; provider split is now honored once an employee task is actually dispatched.
- Status after fix: the release footer no longer shows `0/12P` while idle/ready after a completed report; employee active/total progress remains visible only while execution is running.

### P0 - Multi-provider employee split is not currently executable

The app can create many employees, but one company/team run still uses a single active runtime provider. The UI can save an employee model preference, but live execution remained on `MiniMax-M2.7`. This blocks the intended "four groups, average provider allocation,共同合作干活" stress test from being a real provider distribution test.

Expected product behavior: each employee or group needs an explicit runtime lane/provider binding that the execution engine actually honors.

Status after fix: fixed for gateway-lane employee execution. The release app now loads non-secret provider profiles from `.env.local`, keeps secret bytes in Rust, and routes matching employee `modelPreference` values through the per-model gateway. Live `llm_calls` confirmed MiniMax, Z.AI, and OpenRouter employee calls under their expected provider transports.

### P0 - Release app multi-agent run stalls before employee dispatch

The live run reached 12 participants, but no employee became active and progress stayed `0/12P` for more than 216 seconds. The manager/PM call did not hand off to employee work in the release app.

Expected product behavior: after manager planning, the app should dispatch to assigned employees or fail with a visible recoverable error.

Status after fix: fixed for the reproduced all-team release path. The rebuilt release app entered `EXECUTING` and created 12 task runs for the 12 enabled employees.

### P0 - Stop control does not stop the stuck run

Clicking Stop and pressing Escape did not cancel the run. This is a user-facing control failure during the exact scenario where cancellation is most needed.

Expected product behavior: Stop must cancel the active execution, unlock chat input, and mark the run as stopped.

Status after fix: functionally fixed for the reproduced release path. Stop now interrupts execution and prevents continued token usage. The remaining issue is a visual/state-label cleanup around interrupted reporting.

### P1 - Employee profile provider/model config is misleading

The Profile tab lets a user set `Custom` model text, but there is no clear provider picker, base URL/key binding, or confirmation that the value affects runtime. Live evidence suggests it does not affect team execution.

Expected product behavior: either wire this setting to execution or remove/label it as metadata only.

Status after fix: execution is wired for known `.env.local` provider profiles. The remaining product gap is UX clarity: users still need a visible provider/model binding surface instead of typing opaque model ids.

### P1 - Provider load harness overcounts success

The load harness counted API-level success even when content was empty or format-invalid. For provider readiness, empty content and invalid structured output should be first-class failures.

Expected product behavior: provider harness should validate content shape, non-empty output, and strict JSON where the scenario requests JSON.

Status after fix: fixed for the local provider load harness. Empty content and invalid JSON are now semantic failures.

### P1 - Coding/thinking models need larger token and format guardrails

MiniMax and Z.AI both showed worse behavior with low completion budgets. Raising token budget produced content, but also reasoning leakage and format drift.

Expected product behavior: these providers need model-specific max-token defaults, reasoning handling, and strict output repair/validation before use in multi-agent workflows.

### P2 - Provider list should stay curated for this product surface

The 148-provider list is too large for normal user selection. For this release, use a curated set aligned to Hermes Agent / OpenClaw-style providers, and keep the full upstream catalog behind a refresh/debug path.

Expected product behavior: default UI shows a small curated provider set; a "pull provider list" action refreshes metadata from upstream sources for advanced/admin use.

Status after fix: fixed for the Settings provider surface. The default product picker remains curated, and the refresh path now uses Hermes Agent/OpenClaw provider docs as the provider scope instead of exposing a raw 148-provider catalog.

### P2 - Company and employee setup UX is slow for stress testing

Creating a 12-person stress company required manual creation and post-create profile edits. Role/provider distribution is not a bulk operation.

Expected product behavior: provide a bulk employee import or "create stress team" setup path for QA/admin use.

### P2 - Add Employee defaults are too narrow

Custom employees default into a generic role flow. For a collaboration stress test, assigning role, group, and provider should happen during creation, not after creation.

Expected product behavior: add role, group, and runtime binding in the creation modal.

### P2 - Secret-safe CLI usage needs guardrails

Passing API keys as CLI arguments risks shell/tool output exposure. Use environment variables only and redact command echoes in scripts/docs.

Expected product behavior: all provider smoke/load commands should read keys from env and never echo secrets.

## Product Conclusion

The original run exposed real product blockers: employee-level provider binding was not honored, the release app could stall before employee dispatch, and Stop did not reliably recover the run. After the fixes, gateway-lane employee execution honors MiniMax/Z.AI/OpenRouter profile routing, all-team dispatch creates per-employee task runs, Stop interrupts execution, and the provider refresh surface stays scoped to Hermes Agent/OpenClaw instead of raw upstream provider sprawl.
