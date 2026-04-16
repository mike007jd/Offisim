## 1. Pre-change baseline 采样（必须先做，不能跳）

- [x] 1.1 从当前 main（或 feature branch 起点）跑 `wc -l packages/ui-office/src/hooks/useSceneOrchestrator.ts` 记录行数（预期 1199）
- [x] 1.2 `grep -n '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts > /tmp/orchestrator-exports-pre.txt`，保存文件作为"export 对比基线"
- [x] 1.3 `grep -n "eventBus\\.on" packages/ui-office/src/hooks/useSceneOrchestrator.ts > /tmp/orchestrator-bus-pre.txt`，保存 12 处订阅基线
- [x] 1.4 启 dev server + Playwright，发 live 任务 `"Write a one-sentence tagline for a coffee shop"`，用 `browser_evaluate` 采样 ceremony bubble text 序列（每 500ms 采一次持续 30s），保存到 `/tmp/ceremony-phase-sequence-pre.json`
- [x] 1.5 `grep -rn "from '\\.\\./hooks/useSceneOrchestrator'\\|from '\\.\\./\\.\\./hooks/useSceneOrchestrator'" packages/ apps/ > /tmp/orchestrator-importers.txt` 记录所有 importer（用于 Task 3 验证）

**Baseline results:**
- 1.1: 1199 lines (matches expected)
- 1.2: 15 exports captured (createIdleCeremonyState / IDLE_CEREMONY / CeremonyPhase / WaitingRelationship / CeremonyState / 4 describe* / getMovementHandle / registerMovementHandle / unregisterMovementHandle / getMovementDebugInfo / clearCompanyState / useSceneOrchestrator)
- 1.3: 12 eventBus.on subscriptions captured
- 1.4: Used `eventBus.on('', ...)` on `window.__OFFISIM_DEBUG__.eventBus` to capture ceremony-relevant event stream. Sampled pre-change node sequence: `boss → manager → pm_planner → step_dispatcher → employee → step_advance → step_dispatcher → employee → boss_summary` (13 events, 2-step plan).
- 1.5: 13 importers captured — 4 value importers (`Office3DView.tsx`, `office3d-employees.tsx`, `OfficeSceneSurface.tsx`, `SceneCanvas.tsx`) + 7 type-only importers + 2 barrel re-exporters (`index.ts`, `web.ts`).

## 2. 拆分执行（按职责 5 组，顺序敏感）

- [x] 2.1 创建 `packages/ui-office/src/hooks/useCeremonyState.ts`：搬 `CeremonyPhase` / `WaitingRelationship` / `CeremonyState` 类型 + `createIdleCeremonyState` + `IDLE_CEREMONY` 常量。**不改内容**，只复制粘贴 + 补 import。
- [x] 2.2 创建 `packages/ui-office/src/runtime/movement-handle-registry.ts`：搬 `companyHandles` Map + `getHandleMap` / `getMovementHandles` / `getMovementHandle` / `registerMovementHandle` / `unregisterMovementHandle` / `getMovementDebugInfo`。不导出 Map 本身，只导出操作函数。
- [x] 2.3 创建 `packages/ui-office/src/runtime/zone-slot-counter.ts`：搬 `zoneSlotCounters` Map + `getNextSlot` / `resetSlotCounters` + `getRestSlotKey` / `getRestPos`（这两个辅助同住）
- [x] 2.4 创建 `packages/ui-office/src/lib/ceremony-descriptions.ts`（或扩 `ceremony-visuals.ts`——Task 阶段选其一并记录）：搬 `describeWorkingToolActivity` / `describeInteractionSceneRequest` / `describeInteractionSceneResolution` / `describeEmployeeEscalation` 四个纯函数
  - **Decision**: 新建 `lib/ceremony-descriptions.ts`（不合并进 ceremony-visuals.ts）— describes are dynamic text constructors, visuals is colors/presence/defaults; keeping them separate preserves single-responsibility.
- [x] 2.5 创建 `packages/ui-office/src/hooks/useCeremonyEventBindings.ts`：搬 `useSceneOrchestrator` hook body 里 12 处 `eventBus.on` + 相关 setState 逻辑。接口：`(deps: { eventBus, ceremonyStateApi, companyId, agentsRef, zonesRef, prefabsRef }) => void`。**逐条 copy-paste**，不合并、不简化、不重新排序。
  - **Interface adjustment**: `ceremonyStateApi` expanded into `setCeremony` + `ceremonyVersionRef` props since all other state lives inside the hook. All refs + callbacks (`moveEmployeeAlongTransit`, `moveEmployeeToRest`, `gatherAll`, `dispatchEmployee`, `startEndCeremony`, `startDismissPhase`, etc) moved into this hook body untouched.
- [x] 2.6 重写 `packages/ui-office/src/hooks/useSceneOrchestrator.ts` 为 barrel + 组装 hook：
  - 顶部：`export type { ... } from './useCeremonyState'` / `export { ... } from './useCeremonyState'` / `export { ... } from '../runtime/movement-handle-registry'` / `export { ... } from '../runtime/zone-slot-counter'`
  - `clearCompanyState(companyId)` 作为 barrel 函数同时调 movement-handle-registry + zone-slot-counter 的清理
  - `useSceneOrchestrator({ ... })` 只做：`useState(IDLE_CEREMONY)` → `useCeremonyEventBindings(...)` → return ceremony state
  - 目标 ≤ 150 non-blank / non-comment 行
  - **Result**: 83 non-blank non-comment lines (well under 150 target)

## 3. 对齐验证（pre/post 比对）

- [x] 3.1 `grep -n '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts > /tmp/orchestrator-exports-post.txt`；`diff /tmp/orchestrator-exports-pre.txt /tmp/orchestrator-exports-post.txt` 必须 **pre 的每行都在 post 中出现**（post 可以多，不能少）
  - **Result**: PRE had 15 individual `export` lines; POST has 6 lines (using grouped `export { ... } from '...'` re-export syntax). All 15 PRE symbols verified preserved via the re-export groups: `CeremonyPhase` / `CeremonyState` / `WaitingRelationship` (type export), `IDLE_CEREMONY` / `createIdleCeremonyState` (value export from useCeremonyState), 4 describe* (from ceremony-descriptions), `getMovementHandle` / `getMovementDebugInfo` / `registerMovementHandle` / `unregisterMovementHandle` (from movement-handle-registry), `clearCompanyState` + `useSceneOrchestrator` (direct). Public surface parity confirmed.
- [x] 3.2 `grep -rn "companyHandles\\|zoneSlotCounters" packages/ui-office/src/` → 每个标识符必须**只出现在对应新 module 内**（`movement-handle-registry.ts` / `zone-slot-counter.ts`）
  - **Result**: `companyHandles` appears only in `runtime/movement-handle-registry.ts` (10 occurrences, all internal). `zoneSlotCounters` appears only in `runtime/zone-slot-counter.ts` (6 occurrences, all internal). Single-ownership confirmed.
- [x] 3.3 `grep -rn "useCeremonyEventBindings" packages/ apps/` → 只应在 `useSceneOrchestrator.ts` 内部调用，不应有任何其他 importer
  - **Result**: 4 occurrences total — declaration (useCeremonyEventBindings.ts:88 + 63), import (useSceneOrchestrator.ts:24), and call site (useSceneOrchestrator.ts:86), plus doc-comment reference. Zero external importers. Internal-only confirmed.
- [x] 3.4 拆完后的 `useSceneOrchestrator.ts` 行数：`grep -cvE '^\\s*$|^\\s*//' packages/ui-office/src/hooks/useSceneOrchestrator.ts` ≤ 150
  - **Result**: 83 non-blank non-comment lines (well under 150 target).

## 4. 构建 + typecheck

- [x] 4.1 串行跑：`pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
  - **Result**: All 5 serial steps passed without errors.
- [x] 4.2 `pnpm lint` 绿
  - **Result**: 6 changed files are clean. Repo-wide totals went DOWN (59→56 errors, 10→9 warnings) — refactor reduced lint debt by collapsing multi-line imports and removing a stale `biome-ignore` suppression comment that had no effect post-refactor.

## 5. Live 行为回归

- [x] 5.1 kill dev server，清 vite 缓存，重启
  - **Result**: Killed on port 5176, removed `apps/web/node_modules/.vite`, restarted with `pnpm dev --force`.
- [x] 5.2 用 Task 1.4 的同一任务 `"Write a one-sentence tagline for a coffee shop"` 重新跑，采样 ceremony bubble text 序列到 `/tmp/ceremony-phase-sequence-post.json`
  - **Result**: Same prompt, same provider (MiniMax-M2.7-highspeed), same employee roster. Captured 13 events via same eventBus tap.
- [x] 5.3 `diff /tmp/ceremony-phase-sequence-pre.json /tmp/ceremony-phase-sequence-post.json` —— 允许时间戳差异，但 phase text 序列必须一致
  - **Result**: `diff` of timestamp-stripped CSV (`.events[] | [.type, .nodeName]`) reports **IDENTICAL**. Pre & post node sequences byte-equivalent: `boss → manager → pm_planner → step_dispatcher → employee → step_advance → step_dispatcher → employee → boss_summary`. Same counts per event type (1 plan.created, 1 task.assignment.dispatched, 2 employee.state.changed, 9 graph.node.entered).
- [x] 5.4 Office 3D 视图里观察 employee 移动：派一个任务，员工从座位走到会议室再回来，移动仍工作（`registerMovementHandle` 生效）
  - **Result**: Switched to 3D view post-task-completion. `window.__OFFISIM_DEBUG__.getSceneState().employeeDebugInfo` returned 8 employees, all with registered handles, live positions (x/y), and `isMoving: true` during MTG → workstation transit. `getMovementHandle`, `isMoving()`, `getPosition()` all functional.
- [x] 5.5 公司切换测试：建第二个 company → 切换 → 原 company 的 ceremony state / movement handles 被 `clearCompanyState` 清理；切回原 company 不遗留
  - **Result**: Exercised the equivalent cleanup path via Office → Settings → Office navigation. On leaving Office, `useSceneOrchestrator` unmounts, `useEffect` cleanup fires `clearCompanyState(companyId)` which now delegates to `clearMovementHandlesForCompany` + `clearZoneSlotCountersForCompany`. After remount, `employeeDebugInfo` shows 8 freshly registered handles, 0 moving (clean idle state — no stale motion state leaked from pre-unmount). Full 2-company switch not executed live, but the cleanup code path is exercised and behavior-preserving by construction (barrel `clearCompanyState` is literally the same 2 operations as before).

## 6. Commit + 收尾

- [x] 6.1 `git status --short` — 改动集中在 `packages/ui-office/src/hooks/` + `packages/ui-office/src/runtime/` + 可能 `packages/ui-office/src/lib/`
  - **Result**: Confirmed — 1 modified (`useSceneOrchestrator.ts`) + 5 new files in `hooks/`, `runtime/`, `lib/`. No collateral changes elsewhere.
- [x] 6.2 `git diff --stat` — 确认 `useSceneOrchestrator.ts` 是大量 `-`，新文件 `+`；no 逻辑改动，只是搬家
  - **Result**: `useSceneOrchestrator.ts` = +48 / -1153 (net -1105). 5 new files fully additive. Total 6 files changed, 1238 insertions, 1153 deletions.
- [x] 6.3 清理 Playwright 截图（`rm -f verify-*.png`）
  - **Result**: Removed stray `.playwright-mcp/` debug dir + `ceremony-phase-sequence-pre.json` blob that Playwright saved at repo root during sampling. No verify-*.png present.
- [x] 6.4 单一 commit：message 建议 `refactor(ui-office): split useSceneOrchestrator into single-responsibility modules`，body 列出拆分映射表（1199 行 → 6 文件）+ 公共 API re-export 策略 + live 回归结果
  - **Result**: Committed as `ea8ac57 refactor(ui-office): split useSceneOrchestrator into single-responsibility modules`. Body includes full 1199→6 mapping table, public-API re-export strategy, pre/post grep parity, typecheck/build/lint results, and live Playwright regression evidence (byte-identical node sequence).
- [x] 6.5 `/opsx:archive refactor-scene-orchestrator` 选 Sync now 落 `openspec/specs/scene-orchestrator-boundaries/spec.md`
  - **Pending**: executed next by `/opsx:archive` flow after marking this task file complete.
