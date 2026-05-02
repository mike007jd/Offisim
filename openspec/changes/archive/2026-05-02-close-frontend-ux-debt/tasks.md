# Tasks — close-frontend-ux-debt

> 节奏：所有 archive 类操作放在最后；先做代码改动并 live verify 通过，再走 8 个 archive。中间每完成一类提交一次，避免大爆炸合并。
> 完成定义见每个 group 末尾的 ✅ Done 行；ProductClosure Bar (root `CLAUDE.md`) 强制 live runtime 闭环 + UX 优雅 + 多表面一致 + 不靠 fallback 假装完成。
> Chat 输入区文件附件能力已拆出本 change，归独立 change `add-chat-attachment-end-to-end` 端到端做完。本 change 只做 deliverable contributor 头像 propagation + 8 archive + MEMORY 修复。

## 1. Type 扩展：Deliverable contributor

- [x] 1.1 在 `packages/shared-types/src/events/deliverable.ts` 的 `DeliverableCreatedPayload.contributingEmployees` 元素 shape 上新增 `isExternal: boolean` + `brandKey: string | null`，旧字段保留
- [x] 1.2 在 `packages/core/src/graph/state.ts` 的 `StepTaskOutput` interface 上新增 `isExternal: boolean` + `brandKey: string | null`（Codex 审计补强项 1——此层是 propagation 中间环，不补则下游永远拿不到字段）
- [x] 1.3 在 `packages/ui-office/src/hooks/useDeliverables.ts` 的 `Deliverable.contributingEmployees` 元素 shape 上同步新增同名字段
- [x] 1.4 在 `@offisim/shared-types` barrel re-export 同步；运行 `pnpm --filter @offisim/shared-types build`
- [x] 1.5 串行 build 下游依赖：`pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`，确保 typecheck 全绿（不允许 `any` 占位；TypeScript strict 会强制所有 `StepTaskOutput` 构造点补字段——编译错就是 propagation 漏点）
- [x] 1.6 更新 harness scenario fixtures：grep `packages/core/harness/scenarios/*.json` 含 `currentStepOutputs` 的 fixture（至少 `dag-output-attribution.json` / handoff-相关），in-place 加 `isExternal: false` + `brandKey: null`（除 external A2A 场景 fixture 应填 `true` + 真实 brand_key）；运行 `pnpm harness:contract` 全绿（Codex 审计补强项 3）

✅ Done = 三个新字段全链路 typecheck 通过；旧字段无破坏；下游 build 全绿；所有 `StepTaskOutput` 构造点编译时被强制补字段；harness fixtures 已同步

## 2. Deliverable contributor propagation 端到端补字段（三条 emit 路径）

- [x] 2.1 grep 仓库内所有 `StepTaskOutput` 构造点（employee-node / external-employee-dispatch / sop-runner / 等任何 `: StepTaskOutput =` / `as StepTaskOutput` / 直接 push 到 `currentStepOutputs` 的位置）；逐一列出文件:行号
- [x] 2.2 每个 StepTaskOutput 构造点必须从 employee row 的 `is_external` + `brand_key` 拿到字段填进，禁止 fallback 占位（除明确历史 rehydrate 路径外）；外部 A2A 员工 dispatch 路径走 `brand_key` 来自 brand metadata
- [x] 2.3 grep 仓库内所有 `eventBus.emit(deliverable.created` / `deliverableCreated(` / 直接构造 `DeliverableCreatedPayload` 的位置；至少应找到三条（`boss-summary-node.ts:243` + `employee-completion.ts:331` + `employee-a2a-executor.ts:269`）；逐一列出文件:行号
- [x] 2.4a `packages/core/src/agents/boss-summary-node.ts` 的 `emitDeliverable` map 内补两字段透传：`{ employeeId, employeeName, sourceKind, roleSlug, isExternal: o.isExternal, brandKey: o.brandKey }`
- [x] 2.4b `packages/core/src/agents/employee-completion.ts` 直接 emit 路径（materialized artifact）内 `contributingEmployees` 单元素从 employee row 取 `isExternal: employee.is_external === 1, brandKey: employee.brand_key ?? null`（Codex 审计补强项 2）
- [x] 2.4c `packages/core/src/agents/employee-a2a-executor.ts` 直接 emit 路径（external A2A artifact）内 `contributingEmployees` 单元素填 `isExternal: true, brandKey: employee.brand_key ?? null`（Codex 审计补强项 2）
- [x] 2.5 在 `packages/core/src/services/deliverable-persistence-service.ts` 的 `contributors_json` 反序列化路径加 schema-tolerant parse：当历史 JSON 缺 `isExternal`/`brandKey` 时回填 `isExternal: false, brandKey: null`，不抛错
- [x] 2.6 在 `apps/web/src/lib/tauri-checkpoint.ts` 的 `TauriCheckpointSaver.loadLatest` 反序列化路径加 `currentStepOutputs[]` hydrate 兜底：缺字段填 `isExternal: false / brandKey: null`，不抛错（Codex 审计补强项 3——StepTaskOutput 进 channel_values 持久化）
- [x] 2.7 在 `packages/db-local` / `packages/db-platform` 涉及 deliverable contributor 序列化的 mapper / repo 走查一遍，确保字段透传
- [x] 2.8 加 unit-style assertion（不依赖 vitest，可走 deterministic harness scenario 或 ts-node script）：emit a deliverable.created with mixed internal/external contributors → repo round-trip → contributors_json 反序列化结果含两个新字段；同时校验 `StepTaskOutput → boss-summary → DeliverableCreatedPayload` 链路 + 两条 direct emit 路径分别 mixed contributors 不丢字段

✅ Done = StepTaskOutput → 三条 emit 路径 → persist → checkpoint → render 全链 100% 覆盖；反序列化 + checkpoint hydrate 对历史数据兼容；harness/script 验证字段全链路

## 3. DeliverableCard 头像分支统一走 EmployeeAvatar

- [x] 3.1 在 `packages/ui-office/src/components/deliverable/DeliverableCard.tsx` 的 `ContributorStack` 把 `<DicebearAvatar seed={emp.employeeName} size={size} />` 替换为 `<EmployeeAvatar agent={{ is_external: emp.isExternal ? 1 : 0, brand_key: emp.brandKey, name: emp.employeeName, persona_json: null }} size={size} />`
- [x] 3.2 删除 line 104 的 TODO 注释
- [x] 3.3 grep 全库其他出现 contributor 头像的 surface（deliverable detail / activity rail contributor 列 / 历史展示 / Outputs 子 tab），逐处确认走 `EmployeeAvatar`，不留 `<DicebearAvatar seed={contributor.employeeName}` 平行分支
- [x] 3.4 移除残留 `import { DicebearAvatar }` 如该文件不再直接消费

✅ Done = 全库 contributor 头像 SSOT = `EmployeeAvatar`；外部贡献者 brandKey=null 走 BrandAvatar2D custom fallback 不走 DiceBear

## 4. Live verify — Deliverable contributor

- [x] 4.1 浏览器 SPA Deliverable card live verify：构造 mixed internal/external 贡献者的 deliverable（用真实 A2A 外包员工触发或在 dev panel mock 数据），打开 Outputs 子 tab，确认 contributor 头像内部走 DiceBear、外包走 brand SVG；hover tooltip 名称正确
- [x] 4.2 Tauri release `.app` 同款 mixed contributor live verify（必须先跑 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build` 确保 release `.app` 含新 UI dist——root CLAUDE.md `Product Closure Bar` 强约束）；确认 brand SVG 落 vault 路径正确、A2A 真实员工产出 deliverable 头像不漂移
- [x] 4.3 历史 deliverable rehydrate：用本 change 之前持久化的 thread 启动，确认 `isExternal` 缺失字段时 contributor 头像照样显示（兜底为内部 DiceBear），无 runtime 报错
- [x] 4.4 旧 LangGraph checkpoint 恢复 verify：用本 change 之前的 checkpoint snapshot 启动桌面 release `.app`，确认 `currentStepOutputs[]` 缺字段被 hydrate 兜底，graph 继续执行无 strict 错误（用户体感 = 旧会话能正常恢复，员工头像在 deliverable 区显示）
- [x] 4.5 把每条 verify 结果（步骤 + 截图 + 观察）写入 `.live-verify/close-frontend-ux-debt/`，包含至少 4 张截图（浏览器 mixed contributor、Tauri release `.app` mixed contributor、历史 deliverable 兜底、旧 checkpoint 恢复）；不写 `_pass.png` 后缀文件，文件名直接描述场景

✅ Done = `.live-verify/close-frontend-ux-debt/` 目录有齐全证据；浏览器 + Tauri release 都过；任何一项失败必须修而不是降级

## 5. Archive Gate 第一批：5 个直接 archive 候选

> 每个 change 的执行步骤：`a` `git log` 核对 SHA → `b` 抽 spec 引用文件路径 vs 代码 → `c` 抽 tasks `[x]` 真实性 → `d` 检查 `protocols-ledger.md` 行 → `e` `/opsx:archive` → `f` commit。中间任何一步失败：暂停，记录在本任务下方 `若中断` 子任务，修平再继续。

- [x] 5.1 `add-url-sync-and-deep-links` 走 a→f；台账涉及 Tauri SPA fallback 行同步
- [x] 5.2 `add-workspace-narrow-tier-and-states` 走 a→f；台账无影响
- [x] 5.3 `expand-ui-core-foundation` 走 a→f；台账无影响
- [x] 5.4 `upgrade-3d-character-rendering-1.0` 走 a→f；台账无影响
- [x] 5.5 `upgrade-3d-scene-lighting-and-materials` 走 a→f；台账无影响

✅ Done = 5 个 change 全部移到 `openspec/changes/archive/`；`openspec status` 不再列；commit 干净

## 6. Archive Gate 第二批：3 个 ⚠️ 需先核

- [x] 6.1 `fix-layout-shift-stability` —— 先核 `apps/web/index.html` 是否真有 `@font-face` + `font-display: swap`、Inter / JetBrains Mono variable woff2 是否自托管（不要外链 Google Fonts）；缺则在本 change 内补再 archive
- [x] 6.2 `rebuild-dialog-and-popover-system` —— 先 grep 确认 `SopAddStepPopover.tsx` 引用了 Radix `@radix-ui/react-popover`，且全库没有 hand-rolled popover 残留；漂移则在本 change 内补再 archive
- [x] 6.3 `unify-design-token-system` —— 在 Tauri release `.app` 跑过主题切换（dark/light）+ token 来源单一性（grep 确认 design tokens 只来自 SSOT 一处导出），把 verify 步骤+截图写到 `openspec/changes/unify-design-token-system/.live-verify/`，再 archive
- [x] 6.4 三者都 `/opsx:archive` 完成；台账涉及行（Tauri / Better Auth / 其他若有）同步

✅ Done = 3 个 change 全部移走；任何先核发现的漂移已修平；台账同步

## 7. MEMORY.md 修复 + 协议台账 + 残留清理

- [x] 7.1 `MEMORY.md` 删 stale 段："UX/IA overhaul 8-phase 已完结全 archived"；按 git 真相重写
- [x] 7.2 `MEMORY.md` 删 stale backlog："Skill install outcome formatter 没分支 staging-expired/skill-install-error"；删 `T2.4 self-authoring skills` 旧描述并改写为"剩 task 6.9/6.11 live verify 未跑"
- [x] 7.3 `MEMORY.md` 新增条目记录本 change 完成（指向 git SHA + 8 archive 完成）+ 标记 `add-chat-attachment-end-to-end` 待 propose
- [x] 7.4 `MEMORY.md` Active Backlog 增补 "doubled-boss-bubble 等用户复现描述后单独 propose"
- [x] 7.5 `openspec/protocols-ledger.md` 同步 8 个 archive 涉及的协议行（Tauri SPA fallback、若涉 SKILL.md / Better Auth 等条目）
- [x] 7.6 删除 `.live-verify/skill-install-outcome-chat/`（对应 change 已 archive，残留可清）
- [x] 7.7 `.live-verify/runtime-context-and-tool-routing/` 与 `.live-verify/fix-doubled-boss-bubble/` **不删**（前者归 Change B、后者待用户复现），但在 `MEMORY.md` 提一笔"等 Change B / 用户复现"

✅ Done = MEMORY.md 与 git 真相对齐；台账无漂移；残留有归属

## 8. 收口 + 自审

- [x] 8.1 跑全量 typecheck + lint：`pnpm typecheck && pnpm lint`，零警告
- [x] 8.2 跑 deterministic harness contract：`pnpm harness:contract`，全绿（含 task 1.6 更新过的 fixtures）
- [x] 8.3 桌面 release artifact 串行 build：`pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`，确保 release `.app` 含新 UI dist
- [x] 8.4 git diff 自审：无 `console.log` 残留 / 无未使用 import / 无 `TODO(date)` 新增 / 无 `any` 占位
- [x] 8.5 自审 ProductClosure Bar：(1) 真能用？— 4.1-4.4 通过；(2) 多表面一致？— 头像 SSOT 收齐 + 三条 emit 路径全通 + checkpoint hydrate 兜底；(3) UX 优雅？— 头像无营销文案、不漏外包 brand、null brandKey 走 custom fallback 不退化 DiceBear；(4) 不靠 fallback？— 兜底仅限历史数据 + 旧 checkpoint，不是新功能 escape hatch
- [x] 8.6 commit 顺序检查：type 扩展 + harness fixtures → StepTaskOutput propagation + checkpoint hydrate → 三条 emit 路径透传 → DeliverableCard 切 EmployeeAvatar → live verify 证据（含 release `.app`） → 8 个 archive 第一批 → 3 个 archive 第二批 → MEMORY/台账/残留 → 自审收口
- [x] 8.7 准备 `/opsx:archive close-frontend-ux-debt`：先跑 OpenSpec Archive Gate 三查（spec 一致 / tasks 一致 / 协议台账同步），全过再 archive

✅ Done = `/opsx:archive close-frontend-ux-debt` 成功；`openspec status` 不再列本 change；MEMORY 与 git 同步
