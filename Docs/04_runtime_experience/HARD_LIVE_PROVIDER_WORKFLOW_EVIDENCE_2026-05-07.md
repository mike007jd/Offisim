# Hard Live Provider Workflow Evidence - 2026-05-07

## Status

**Incomplete.** The product/runtime fixes and deterministic gates pass, and the release `.app` is attachable through Computer Use, but the hard live workflow still did not produce the required PDF, PPT, HTML infographic, or evidence files.

This is not counted as a live pass.

## Release Build

- Release app path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Latest release app timestamp: `2026-05-07 11:54:24 NZST`
- Exact release process verified:
  - PID `86102`
  - Command: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop`
- Computer Use attach result:
  - App: `com.offisim.desktop`
  - Window: `Offisim`
  - URL: `tauri://localhost`
  - UI state: `READY`
  - Unified model footer: `MiniMax-M2.7`

## Deterministic Gates

- `pnpm --filter @offisim/core typecheck`: passed
- `pnpm --filter @offisim/core exec tsc --project tsconfig.json`: passed
- `pnpm harness:contract`: passed, `scenarioCount: 69`
- `pnpm --filter @offisim/desktop build`: passed

Previously passed during this implementation:

- `node scripts/harness-replay.mjs`
- `pnpm --filter @offisim/web typecheck`
- `pnpm --filter @offisim/ui-office build`

New deterministic coverage added:

- `orchestration-project-thread-scopes-runtime-context`
  - Verifies orchestration uses the active project conversation thread.
- `pm.artifact_fallback_is_phased`
  - Verifies the fallback PM plan creates phased artifact work instead of broadcasting the whole prompt to every employee.
- `completion.bash_evidence_satisfies_file_intent`
  - Allows real shell-backed workspace work to count as file evidence.
- `completion.artifact_tasks_require_write_audit`
  - Blocks artifact tasks when the employee only listed/read files and did not write/copy/create anything.

## Live Run Timeline

### Attempt 1: Existing Company Thread

- Result: invalid evidence.
- Problem: old global/company thread context polluted the hard live request.
- Status: not counted.

### Attempt 2: Clean Project Thread

- Project: `Hard Live Provider Workflow 20260507`
- Intended folder: `/Users/haoshengli/Desktop/OffisimLongTest-20260507-0215`
- Result: invalid success.
- Evidence:
  - `project-infographic.html` was only `143` bytes.
  - No Desktop test folder was created.
  - Required PDF/PPT/source-copy artifacts were missing.

### Attempt 3: Post Artifact-Intent Fix

- Project: `Hard Live Provider Workflow Fix 20260507`
- Intended folder: `/Users/haoshengli/Desktop/OffisimLongTest-20260507-0220`
- Result: blocked instead of falsely completed.
- Evidence:
  - First employee blocked with `No verification evidence tool ran before completion.`
  - No tool calls were recorded.
  - No Desktop test folder was created.
- Root cause found:
  - Task runs persisted to the company default thread instead of the active project conversation thread.

### Final4: Release App Live Workflow

- Project: `Hard Live Provider Workflow Final4 20260507`
- Thread: `thread-05369d79-2fbf-49e3-9166-21ae12d46c4a`
- Output folder: `/Users/haoshengli/Desktop/OffisimLongTest-20260507-1132`
- Selected project: `/Users/haoshengli/Seafile/WebWorkSpace/jktech`
- PM plan evidence:
  - Manager whole-team fast path created `12` assignments.
  - PM fallback created `5` phases:
    - `project_selection`
    - `analysis`
    - `source_copy`
    - `artifacts`
    - `verification_summary`
  - First dispatched step had `1` assignment, not a duplicated full-team broadcast.

Artifacts present:

- `01_source_copy/jktech/` exists and contains source/config files.
- Numbered folders exist:
  - `01_source_copy`
  - `02_analysis`
  - `03_presentation`
  - `04_infographic`
  - `05_evidence`

Artifacts missing:

- `02_analysis/codebase-analysis-report.pdf`
- `03_presentation/project-overview.pptx`
- `04_infographic/project-infographic.html`
- `05_evidence/run-evidence.md`
- `05_evidence/file-manifest.json`
- root `README.md`

Provider evidence:

- MiniMax: `anthropic | MiniMax-M2.7`
  - Boss, PM planner, boss summary, and employee calls recorded.
  - Employee calls: `57` successful, `2` connection errors.
- Z.AI: `openai-compat | GLM-5.1`
  - Employee calls: `7` successful.
- OpenRouter: `openai-compat | openai/gpt-oss-120b:free`
  - Employee calls: `2` successful.

Tool audit evidence:

- Alex Chen: `31` calls, `bash,read_file`
- Kai Nakamura: `9` calls, `bash,read_file`
- Maya Lin: `12` calls, `bash,write_file`
- Ryan Torres: `13` calls, `bash,read_file`
- Sophie Park: `23` calls, `bash,read_file`
- ZAI Planning Engineer: `12` calls, `bash,read_file`
- Zara Okafor: `13` calls, `bash,read_file`

Final4 product defect:

- Several employees reached `completed` despite only listing/reading files.
- A malformed `write_file` call failed for Maya, but the task still completed.
- Ryan explicitly observed the empty artifact folders, then still completed without writing the evidence manifest.

Fix added after Final4:

- Artifact/file tasks now require a successful write/copy/create audit row before completion.
- Read/list-only tool evidence no longer satisfies artifact completion.

## Release Decision

Do not mark this plan complete yet.

The runtime now blocks the false-positive completion pattern found by Final4, but the hard live workflow still needs another release `.app` run that produces all required files. The next run should be considered the release gate for this scenario.

## GitNexus Risk Investigation

Result 2026-05-07:

- `npx gitnexus status` initially reported stale index:
  - Indexed commit: `5bfee0c`
  - Current commit: `9790f62`
- `npx gitnexus analyze` was run from the repo root.
- New index:
  - `29,119` nodes
  - `42,509` edges
  - `300` flows
- `npx gitnexus status` after analyze:
  - Indexed commit: `9790f62`
  - Current commit: `9790f62`
  - Status: up-to-date

Re-run `gitnexus.detect_changes` still reports overall `high`:

- `changed_count`: `141`
- `affected_count`: `12`
- `changed_files`: `26`
- `risk_level`: `high`

Interpretation:

- The original high result was not just stale-index noise.
- `analyze` only changed the GitNexus symbol/relationship counts in `AGENTS.md` and `CLAUDE.md`; that is expected index metadata churn.
- Most inspected changed symbols have LOW upstream blast radius:
  - `SettingsProviderTab`: LOW, no upstream callers.
  - `ProfileTab`: LOW, no upstream callers.
  - `resolveEmployeeModel`: LOW, direct caller `runPreflight`, affected process `employeeNode`.
  - `verifyTaskCompletion`: LOW, direct caller `finalizeEmployeeSuccess`, affected processes `employeeNode` and `runEmployeeEngine`.
  - `buildArtifactWorkflowFallback`: LOW, direct caller `buildLlmPlanFallback`.
  - `runtimeContextForThread`: LOW, direct caller `_executeStateInner`.
  - `AuditingToolExecutor.writeAudit`: LOW, direct caller `recordAndEmit`.
- The real high-risk center is `detectTaskToolIntent`:
  - GitNexus impact: CRITICAL.
  - Direct consumers include boss, manager, PM preflight, employee preflight, direct setup, yolo master, and employee completion.
  - Affected runtime paths include browser/tauri runtime initialization and employee execution.

Risk disposition:

- Overall `high` is expected for this branch because the work intentionally touches routing intent, employee model resolution, provider settings, PM fallback planning, completion verification, and execution thread scoping.
- The stale-index issue is resolved.
- The remaining high signal should be treated as a real release-gate warning, not a GitNexus false positive.
- Required mitigation remains deterministic gates plus another release `.app` hard live run. Current deterministic gates pass, but live workflow is still incomplete because Final4 did not produce all artifacts.
