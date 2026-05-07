# Hard Live Provider Workflow Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current provider success into a release-grade workflow test: Offisim must use real providers and real desktop/project tools to select a project, analyze it, generate PPT/PDF/HTML deliverables, copy the project into a Desktop test folder, and organize the output folder without touching unrelated Desktop files.

**Architecture:** Keep normal users on simple model choices and inherited global defaults, while moving provider refresh and long live validation into explicit advanced/release surfaces. The hard live test is a real desktop workflow, not a mocked unit test: deterministic harness covers routing/contract invariants, and release `.app` verification proves the end-to-end experience.

**Tech Stack:** Offisim desktop release app, gateway-lane local tools, provider profiles for MiniMax/Z.AI/OpenRouter, deterministic harness scenarios, Computer Use release verification, project-local docs under `Docs/04_runtime_experience`.

---

## Product Decisions Locked By This Plan

- Provider refresh is an advanced "model catalog update" action, not a primary user workflow.
- Employee model setting defaults to "follow unified setting"; overrides are explicit.
- Boss final output is a deliverable report, not a raw chat summary.
- The hard live test must use a timestamped Desktop test folder only, for example `/Users/haoshengli/Desktop/OffisimLongTest-20260507-HHMM`.
- The hard live test must not organize the user's whole Desktop. It may only organize files inside the test folder it created.
- The project copy should be a useful source copy, excluding generated dependency/cache folders by default: `.git`, `node_modules`, `.next`, `dist`, `build`, `.turbo`, `target`, `DerivedData`, `.venv`, and large binary caches. If a future release needs a byte-for-byte full copy, that should be a separate destructive/large-copy test mode.

## Acceptance Criteria

- Settings shows "follow unified setting" as the default for every employee model selection.
- A user can still override an employee to MiniMax, GLM/Z.AI, or OpenRouter for the live test.
- Provider refresh shows source, last success time, provider count, model count, and failure reason if refresh fails.
- The hard live test creates these deliverables in the Desktop test folder:
  - `01_source_copy/<selected-project-name>/`
  - `02_analysis/codebase-analysis-report.pdf`
  - `03_presentation/project-overview.pptx`
  - `04_infographic/project-infographic.html`
  - `05_evidence/run-evidence.md`
  - `05_evidence/file-manifest.json`
  - `README.md`
- The selected project must come from `/Users/haoshengli/Seafile/WebWorkSpace`.
- The selected project must be named in the final report, with reason for selection.
- The PDF must contain project purpose, architecture map, key modules, runtime/build flow, risks, and hygiene recommendations.
- The PPT must be a real presentation, not a renamed text file; target 8-12 slides.
- The HTML infographic must be self-contained, responsive, and readable without external network dependencies.
- The final folder must be organized into the expected numbered directories.
- The release app UI must show the run completing, not hanging, not duplicating employees, and not leaving misleading active-progress indicators after completion.
- Runtime evidence must show real provider calls across MiniMax, GLM/Z.AI, and OpenRouter when those employees are explicitly overridden.

## Scope Map

### Product UX

- Provider catalog refresh surface.
- Employee model inheritance and override UX.
- Boss final deliverable formatting.

### Runtime Behavior

- Global model profile is the default source of truth.
- Employee override only applies when the employee explicitly opts out of inheritance.
- Gateway lane must own local file/project/Desktop operations.
- SDK lanes remain text/reasoning only.

### Test Coverage

- Deterministic harness for routing, inheritance, duplicate prevention, and final-output contract.
- Release `.app` live run for real project/file/document workflow.
- Evidence document that records selected project, generated files, provider calls, and UI completion.

---

## Task 1: Provider Refresh Becomes Advanced Catalog Update

**Files:**
- Modify: `packages/ui-office/src/components/settings/SettingsProviderTab.tsx`
- Modify: `packages/ui-office/src/lib/provider-list-refresh.ts`
- Modify: `Docs/04_runtime_experience/MULTI_AGENT_PROVIDER_STRESS_2026-05-06.md`

- [x] **Step 1: Rename the product concept in UI copy**

Change the user-facing label from a generic provider list pull to "更新模型目录" or "拉取模型目录".

Expected product behavior:
- Normal users understand this as refreshing model options.
- Advanced users can still inspect source details.

- [x] **Step 2: Show catalog freshness**

Add visible fields near the refresh action:
- Last successful refresh time.
- Source names: Hermes Agent, OpenClaw, LiteLLM metadata, OpenRouter.
- Provider count and model count.
- Last error, if the latest refresh failed.

Expected product behavior:
- If refresh fails, saved credentials and existing model choices remain usable.
- User sees "上次成功" rather than assuming the provider system is broken.

- [x] **Step 3: Keep refresh out of the default path**

Place the action in an advanced/details area inside provider settings.

Expected product behavior:
- First-time provider setup does not start with external catalog maintenance.
- The normal path remains selecting product/model/credential.

- [ ] **Step 4: Verify**

Run:
- `pnpm --filter @offisim/ui-office typecheck`
- `pnpm --filter @offisim/ui-office build`

Release verification:
- Open release `.app`.
- Settings > Provider.
- Confirm the default provider picker is still curated.
- Click catalog refresh.
- Confirm success/failure state is understandable and does not erase saved credentials.

---

## Task 2: Employee Models Default To Unified Setting

**Files:**
- Modify: employee/personnel settings surface that currently controls employee model preference.
- Modify: runtime model-resolution code that maps employee preference to provider/model.
- Modify: deterministic harness scenarios for employee model routing.
- Modify: `Docs/04_runtime_experience/MULTI_AGENT_PROVIDER_STRESS_2026-05-06.md`

- [x] **Step 1: Define the two model modes**

Expose exactly two employee-level modes:
- `跟随统一设置`
- `自定义模型`

Expected product behavior:
- New and existing employees default to `跟随统一设置`.
- The employee card/settings show inherited model name when following global setting.
- The override model selector is hidden or disabled until `自定义模型` is selected.

- [x] **Step 2: Preserve power-user override**

When `自定义模型` is enabled, allow explicit model selection:
- MiniMax-M2.7
- GLM-5.1
- openai/gpt-oss-120b:free
- Other configured products in the curated picker

Expected product behavior:
- User can build a mixed-provider team for validation.
- Normal employees do not accidentally drift away from the company-wide model.

- [x] **Step 3: Runtime resolution rule**

Model resolution order:
- If employee is `跟随统一设置`, use unified provider/model.
- If employee is `自定义模型`, use employee override.
- If override is invalid or missing, fail clearly before starting that employee's task.

Expected product behavior:
- No silent fallback to a different provider.
- No hidden provider mismatch between UI and actual employee execution.

- [x] **Step 4: Deterministic coverage**

Add/extend harness scenarios:
- Employee inherits unified provider when no override is set.
- Employee override uses the selected provider.
- Invalid override fails before work begins and surfaces a readable error.

Run:
- `pnpm harness:contract`
- `pnpm harness:replay`

---

## Task 3: Boss Final Output Becomes A Management Deliverable

**Files:**
- Modify: boss summary/final-output prompt and formatting path.
- Modify: deterministic harness scenario for final report shape.
- Modify: `Docs/04_runtime_experience/MULTI_AGENT_PROVIDER_STRESS_2026-05-06.md`

- [x] **Step 1: Define final deliverable formats**

Support at least these final report intents:
- `短报告`
- `项目分析`
- `审计报告`
- `执行计划`
- `文件整理结果`

Default for the hard live test: `项目交付包总结`.

- [x] **Step 2: Use a fixed report structure**

Final boss output for the hard live test must include:
- Selected project.
- Why this project was selected.
- Deliverables created.
- Key findings.
- Risks or missing information.
- File/folder organization result.
- Provider/team execution note.

Expected product behavior:
- The user receives a usable management summary, not a loose concatenation of employee replies.

- [x] **Step 3: Avoid false completion**

If any required deliverable is missing, boss output must say the run is incomplete and list the missing item.

Expected product behavior:
- Offisim does not claim success when the folder lacks the PDF, PPT, HTML, project copy, or evidence file.

- [x] **Step 4: Deterministic coverage**

Add harness assertions:
- Final output contains all required sections.
- Missing artifact creates incomplete status.
- Duplicate employee work is not counted as complete team coverage.

Run:
- `pnpm harness:contract`
- `pnpm harness:replay`

---

## Task 4: Hard Live Test Scenario

**Files:**
- Create: `Docs/04_runtime_experience/HARD_LIVE_PROVIDER_WORKFLOW_EVIDENCE_2026-05-07.md`
- Create or update: release live verification checklist/runbook for this scenario.
- Modify: deterministic harness manifest only for non-live invariants.

- [x] **Step 1: Prepare the release app**

Build and launch the current release app, not the dev webview.

Evidence 2026-05-07: release build succeeded and Computer Use attached to the exact release `.app` at `tauri://localhost`. Latest bundle timestamp: `2026-05-07 11:54:24 NZST`.

Run:
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/desktop build`

Launch exact app path:
- `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

Expected:
- Computer Use attaches to the release `.app`.
- App URL is `tauri://localhost`.

- [x] **Step 2: Prepare model team**

Use unified setting as default.

Then override exactly three employees for provider coverage:
- Employee A: MiniMax-M2.7
- Employee B: GLM-5.1
- Employee C: openai/gpt-oss-120b:free

Expected:
- Most employees remain `跟随统一设置`.
- The three validation employees show explicit override state.
- Final4 evidence includes MiniMax, GLM/Z.AI, and OpenRouter employee calls.

- [x] **Step 3: Use this hard task prompt**

Use this exact user-facing prompt, with only the timestamp folder name updated:

```text
请作为一个完整办公室团队完成一次真实项目交付测试。

从 /Users/haoshengli/Seafile/WebWorkSpace 中任选一个项目，但不要选择 Offisim 当前项目本身。选择前先快速判断项目大小和内容，避免选择 node_modules、缓存、构建产物特别重的目录。

请完成以下交付：
1. 选择一个项目，并说明为什么选它。
2. 分析该项目的代码库，输出 codebase 分析报告 PDF，内容包括项目定位、主要模块、业务流程、运行方式、风险点、hygiene 建议。
3. 输出一个项目介绍 PPT，目标 8-12 页，适合给产品/负责人快速看懂。
4. 将该项目复制到 /Users/haoshengli/Desktop/OffisimLongTest-20260507-HHMM/01_source_copy 下。复制时保留源码和关键配置，但排除 .git、node_modules、dist、build、.turbo、target、DerivedData、.venv 等生成/缓存目录。
5. 写一个自包含 HTML infographic，介绍这个项目的业务、架构、模块、数据流和风险，保存为 /Users/haoshengli/Desktop/OffisimLongTest-20260507-HHMM/04_infographic/project-infographic.html。
6. 整理 /Users/haoshengli/Desktop/OffisimLongTest-20260507-HHMM 这个测试目录内的文件，形成 01_source_copy、02_analysis、03_presentation、04_infographic、05_evidence 结构。不要整理或移动 Desktop 上其他任何文件。
7. 最后给我一份交付总结，明确列出生成文件路径、选择的项目、每个员工负责内容、遇到的问题和是否完整完成。
```

Expected:
- The task is hard enough to require project browsing, file operations, document creation, visual HTML creation, and final organization.
- The task has clear safety boundaries.

- [x] **Step 4: Observe live behavior**

During the run, record:
- Whether planning assigns multiple employees.
- Whether employees start and complete without duplicate assignment.
- Whether the UI can be stopped safely if needed.
- Whether final progress returns to ready/completed state.
- Whether final answer names real generated files.

Expected:
- No stuck spinner.
- No duplicate same-employee assignment.
- No final success claim before required files exist.

Final4 note 2026-05-07: PM planning and provider routing worked, but completion still falsely marked artifact tasks done after read/list evidence. A runtime guard was added after this run so artifact tasks now require successful write/copy/create audit evidence.

- [ ] **Step 5: Verify generated files**

Check the Desktop test folder:
- `01_source_copy/<project>/` exists and contains source files.
- `02_analysis/codebase-analysis-report.pdf` exists and is not empty.
- `03_presentation/project-overview.pptx` exists and is not empty.
- `04_infographic/project-infographic.html` exists and opens locally.
- `05_evidence/file-manifest.json` exists and lists generated outputs.
- `README.md` explains the folder.

Expected:
- Each output is an actual artifact, not a placeholder.
- HTML can be opened without network.
- PDF/PPT are readable by the local OS preview apps.

Failure note 2026-05-07 Final4: `01_source_copy/jktech/` and the numbered folder structure existed, but PDF, PPT, HTML infographic, evidence manifest, file manifest, and root README were missing. This remains unchecked until a rerun produces the artifacts.

- [x] **Step 6: Verify provider calls**

Confirm runtime evidence includes calls from:
- MiniMax-M2.7
- GLM-5.1
- openai/gpt-oss-120b:free

Expected:
- At least one employee call per configured provider.
- No provider silently falls back to a different saved model.
- Final4 evidence recorded MiniMax, GLM/Z.AI, and OpenRouter calls.

- [x] **Step 7: Record evidence**

Write evidence to:
- `Docs/04_runtime_experience/HARD_LIVE_PROVIDER_WORKFLOW_EVIDENCE_2026-05-07.md`

Evidence must include:
- Release app build timestamp.
- Desktop test folder path.
- Selected project path.
- Generated artifact paths.
- Provider call summary.
- UI completion result.
- Any failure/retry.
- Whether the run is complete or incomplete.

---

## Task 5: Release Gate

**Files:**
- Modify: release checklist / runtime evidence docs.
- Do not add runtime/product behavior tests under `packages/core/src/**/*.test.mjs`.

- [x] **Step 1: Run deterministic gates**

Run:
- `pnpm --filter @offisim/core typecheck`
- `pnpm --filter @offisim/ui-office typecheck`
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/web typecheck`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm harness:contract`
- `pnpm harness:replay`

Expected:
- All deterministic gates pass.

- [ ] **Step 2: Run release desktop gate**

Run:
- `pnpm --filter @offisim/desktop build`

Then launch exact release `.app` and complete the hard live scenario through Computer Use.

Blocked note 2026-05-07: `pnpm --filter @offisim/desktop build` passed and Computer Use attached to the release `.app`, but the hard live scenario is still incomplete because Final4 did not produce the required PDF/PPT/HTML/evidence artifacts. The false-positive completion path has been fixed and must be rerun.

Expected:
- Release app, not dev webview, is the final verification surface.

- [x] **Step 3: Failure policy**

If the run fails:
- Retry only the failed step if the app state is recoverable.
- If the same failure happens twice, stop and record it as incomplete.
- Do not change the success criteria to fit the partial output.
- Do not mark the release gate complete until the missing artifact or runtime issue is fixed.

- [ ] **Step 4: Completion policy**

Only mark complete when:
- Product UX changes are implemented.
- Deterministic gates pass.
- Release `.app` hard live test completes.
- Evidence doc names all generated files.
- The Desktop test folder contains all expected artifacts.

---

## Recommended Execution Order

1. Implement employee `跟随统一设置` default first, because it affects daily model behavior.
2. Improve provider catalog refresh second, because it is lower-risk and mostly settings UX.
3. Improve boss final report structure third, because it controls perceived quality.
4. Add deterministic test coverage for the above.
5. Run the hard live provider workflow as the release proof.

## Product Risk Notes

- This hard live test will be slower and more expensive than the previous short provider smoke. That is acceptable because it is a release gate, not a daily quick check.
- The copy step must exclude generated dependency/cache folders by default. Otherwise the test becomes a disk/IO stress test instead of an office-workflow test.
- The folder-organizing instruction must stay scoped to the newly created test folder. Any interpretation that touches the whole Desktop is a product safety bug.
- If document generation cannot produce real PDF/PPT files yet, the correct result is "incomplete", not a fake `.pdf` or `.pptx` wrapper around text.

## Self-Review

- Requirement 1, provider refresh: covered by Task 1.
- Requirement 2, default follows unified setting: covered by Task 2.
- Requirement 3, better final report: covered by Task 3.
- Requirement 4, hard real-world provider test: covered by Task 4 and Task 5.
- Safety boundary for Desktop organization: explicitly covered in Product Decisions and Task 4 prompt.
- No placeholders remain; every required artifact has a path and acceptance check.
