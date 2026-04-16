## 1. Pre-change baseline 采样（必须先做，不能跳）

- [ ] 1.1 从当前 main（或 feature branch 起点）跑 `wc -l packages/ui-office/src/hooks/useSceneOrchestrator.ts` 记录行数（预期 1199）
- [ ] 1.2 `grep -n '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts > /tmp/orchestrator-exports-pre.txt`，保存文件作为"export 对比基线"
- [ ] 1.3 `grep -n "eventBus\\.on" packages/ui-office/src/hooks/useSceneOrchestrator.ts > /tmp/orchestrator-bus-pre.txt`，保存 12 处订阅基线
- [ ] 1.4 启 dev server + Playwright，发 live 任务 `"Write a one-sentence tagline for a coffee shop"`，用 `browser_evaluate` 采样 ceremony bubble text 序列（每 500ms 采一次持续 30s），保存到 `/tmp/ceremony-phase-sequence-pre.json`
- [ ] 1.5 `grep -rn "from '\\.\\./hooks/useSceneOrchestrator'\\|from '\\.\\./\\.\\./hooks/useSceneOrchestrator'" packages/ apps/ > /tmp/orchestrator-importers.txt` 记录所有 importer（用于 Task 3 验证）

## 2. 拆分执行（按职责 5 组，顺序敏感）

- [ ] 2.1 创建 `packages/ui-office/src/hooks/useCeremonyState.ts`：搬 `CeremonyPhase` / `WaitingRelationship` / `CeremonyState` 类型 + `createIdleCeremonyState` + `IDLE_CEREMONY` 常量。**不改内容**，只复制粘贴 + 补 import。
- [ ] 2.2 创建 `packages/ui-office/src/runtime/movement-handle-registry.ts`：搬 `companyHandles` Map + `getHandleMap` / `getMovementHandles` / `getMovementHandle` / `registerMovementHandle` / `unregisterMovementHandle` / `getMovementDebugInfo`。不导出 Map 本身，只导出操作函数。
- [ ] 2.3 创建 `packages/ui-office/src/runtime/zone-slot-counter.ts`：搬 `zoneSlotCounters` Map + `getNextSlot` / `resetSlotCounters` + `getRestSlotKey` / `getRestPos`（这两个辅助同住）
- [ ] 2.4 创建 `packages/ui-office/src/lib/ceremony-descriptions.ts`（或扩 `ceremony-visuals.ts`——Task 阶段选其一并记录）：搬 `describeWorkingToolActivity` / `describeInteractionSceneRequest` / `describeInteractionSceneResolution` / `describeEmployeeEscalation` 四个纯函数
- [ ] 2.5 创建 `packages/ui-office/src/hooks/useCeremonyEventBindings.ts`：搬 `useSceneOrchestrator` hook body 里 12 处 `eventBus.on` + 相关 setState 逻辑。接口：`(deps: { eventBus, ceremonyStateApi, companyId, agentsRef, zonesRef, prefabsRef }) => void`。**逐条 copy-paste**，不合并、不简化、不重新排序。
- [ ] 2.6 重写 `packages/ui-office/src/hooks/useSceneOrchestrator.ts` 为 barrel + 组装 hook：
  - 顶部：`export type { ... } from './useCeremonyState'` / `export { ... } from './useCeremonyState'` / `export { ... } from '../runtime/movement-handle-registry'` / `export { ... } from '../runtime/zone-slot-counter'`
  - `clearCompanyState(companyId)` 作为 barrel 函数同时调 movement-handle-registry + zone-slot-counter 的清理
  - `useSceneOrchestrator({ ... })` 只做：`useState(IDLE_CEREMONY)` → `useCeremonyEventBindings(...)` → return ceremony state
  - 目标 ≤ 150 non-blank / non-comment 行

## 3. 对齐验证（pre/post 比对）

- [ ] 3.1 `grep -n '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts > /tmp/orchestrator-exports-post.txt`；`diff /tmp/orchestrator-exports-pre.txt /tmp/orchestrator-exports-post.txt` 必须 **pre 的每行都在 post 中出现**（post 可以多，不能少）
- [ ] 3.2 `grep -rn "companyHandles\\|zoneSlotCounters" packages/ui-office/src/` → 每个标识符必须**只出现在对应新 module 内**（`movement-handle-registry.ts` / `zone-slot-counter.ts`）
- [ ] 3.3 `grep -rn "useCeremonyEventBindings" packages/ apps/` → 只应在 `useSceneOrchestrator.ts` 内部调用，不应有任何其他 importer
- [ ] 3.4 拆完后的 `useSceneOrchestrator.ts` 行数：`grep -cvE '^\\s*$|^\\s*//' packages/ui-office/src/hooks/useSceneOrchestrator.ts` ≤ 150

## 4. 构建 + typecheck

- [ ] 4.1 串行跑：`pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
- [ ] 4.2 `pnpm lint` 绿

## 5. Live 行为回归

- [ ] 5.1 kill dev server，清 vite 缓存，重启
- [ ] 5.2 用 Task 1.4 的同一任务 `"Write a one-sentence tagline for a coffee shop"` 重新跑，采样 ceremony bubble text 序列到 `/tmp/ceremony-phase-sequence-post.json`
- [ ] 5.3 `diff /tmp/ceremony-phase-sequence-pre.json /tmp/ceremony-phase-sequence-post.json` —— 允许时间戳差异，但 phase text 序列必须一致
- [ ] 5.4 Office 3D 视图里观察 employee 移动：派一个任务，员工从座位走到会议室再回来，移动仍工作（`registerMovementHandle` 生效）
- [ ] 5.5 公司切换测试：建第二个 company → 切换 → 原 company 的 ceremony state / movement handles 被 `clearCompanyState` 清理；切回原 company 不遗留

## 6. Commit + 收尾

- [ ] 6.1 `git status --short` — 改动集中在 `packages/ui-office/src/hooks/` + `packages/ui-office/src/runtime/` + 可能 `packages/ui-office/src/lib/`
- [ ] 6.2 `git diff --stat` — 确认 `useSceneOrchestrator.ts` 是大量 `-`，新文件 `+`；no 逻辑改动，只是搬家
- [ ] 6.3 清理 Playwright 截图（`rm -f verify-*.png`）
- [ ] 6.4 单一 commit：message 建议 `refactor(ui-office): split useSceneOrchestrator into single-responsibility modules`，body 列出拆分映射表（1199 行 → 6 文件）+ 公共 API re-export 策略 + live 回归结果
- [ ] 6.5 `/opsx:archive refactor-scene-orchestrator` 选 Sync now 落 `openspec/specs/scene-orchestrator-boundaries/spec.md`
