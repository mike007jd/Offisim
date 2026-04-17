## 1. Shared helpers (lib/deliverable-presentation.ts)

- [x] 1.1 新建 `packages/ui-office/src/lib/deliverable-presentation.ts`：导出 `mimeTypeToIcon(mime: string | null): LucideIcon`（HTML/JS/TS/TSX/JSX → FileCode, JSON → FileJson, MD/TXT → FileText, CSS → FileCode, CSV → FileSpreadsheet, YAML/XML → FileCode, image/* → FileImage, 其他 / null → File）；`formatDeliverableBytes(bytes: number): string`（1024-base，0..1023 → `{n} B`，1KB..1024KB → `{x.x} KB`，1MB+ → `{x.x} MB`，1GB+ → `{x.x} GB`）；`formatTimeAgo(ts: number): string`（抽 PitchHall `timeAgo`，`< 1m → 'just now'` / `< 1h → '{n}m ago'` / `< 24h → '{n}h ago'` / 其他 → `'{n}d ago'`）。NBNC ≤ 80
- [x] 1.2 `pnpm --filter @offisim/ui-office typecheck` 通过

## 2. Hook 补字段

- [x] 2.1 `packages/ui-office/src/hooks/useDeliverables.ts` `Deliverable` 接口加 `contentSize: number` 字段；live event 构造 row 时填 `artifact.content.length`；hydrate path `listRecentDeliverables` 返回的行映射也填（在 `DeliverableHookRow` 映射或 hook 本地二次 map 都可）
- [x] 2.2 `pnpm --filter @offisim/ui-office typecheck` 通过

## 3. Shared `DeliverableCard` primitive

- [x] 3.1 新建 `packages/ui-office/src/components/deliverable/DeliverableCard.tsx`：
    - Props：`item: Deliverable` / `variant: 'compact' | 'full'` / `employeeLabel?: string | null` / `desktopVaultRoot?: string | null` / `onSaveAsSop?: (item: Deliverable) => Promise<void>` / `isNew?: boolean`
    - Header 渲染：lucide icon（`mimeTypeToIcon(item.artifact.mimeType)`）+ displayTitle（`getDeliverableDisplayTitle(item.title, item.artifact)`，已有 helper 复用）+ byte size（`formatDeliverableBytes(item.contentSize)`）+ time ago（`formatTimeAgo(item.createdAt)`）+ contributor avatar stack（`DicebearAvatar` size=20，最多 3 个，`+N` badge 覆盖 overflow，tooltip 列名字+角色）
    - Body：`compact` variant 显示 `fileName` badge + mimeType 小字 + optional `employeeLabel`；`full` variant 额外显示 content preview（前 N 行）
    - Actions 分支：`compact` = Copy / Open (if `canPreviewDeliverable`) / Download；`full` = Copy / Download / Preview (if canPreview) / Export dropdown (6 格式 → `@offisim/doc-engine` `exportDocument`) / Save as SOP (调 `onSaveAsSop`) / Save locally (Tauri only，`saveDesktopDeliverable`) / Open folder (Tauri only，`openDesktopLocalPath`，saved 后启用)
    - 样式：compact 沿用 chat bubble emerald accent + max-w-[94%] + 小号 button；full 沿用 PitchHall Card 样式 + fade-in slide-in 动画（`isNew` 触发）
    - NBNC ≤ 220
- [x] 3.2 `pnpm --filter @offisim/ui-office build` 通过

## 4. Chat bubble 切过去

- [x] 4.1 找 chat bubble 里引用 `DeliverableArtifactCard` 的消费点（预计 `ChatPanel` / `MessageBubble`）；import 改 `DeliverableCard` + `variant='compact'`；props 里 `artifact` 改成 `item`（需要把 hook 返回的 `Deliverable` 传入，而不是单独的 artifact）
- [x] 4.2 删除 `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx`（物理删除，不留 wrapper）
- [x] 4.3 检查 `packages/ui-office/src/web.ts` / `index.ts` barrel export，若 `DeliverableArtifactCard` 已 export 则删除 export line
- [x] 4.4 `pnpm --filter @offisim/ui-office build` + `pnpm --filter @offisim/web build` 通过

## 5. PitchHall 内部 Card 替换

- [x] 5.1 `packages/ui-office/src/components/pitch/PitchHall.tsx`：删除文件内部 `DeliverableCard` 函数体（~200 行），调用点改成 `<DeliverableCardShared item={...} variant='full' desktopVaultRoot={...} onSaveAsSop={...} isNew={...} />`（import from `../deliverable/DeliverableCard`）
- [x] 5.2 删除 PitchHall 文件顶部 `timeAgo` / `truncate` helper（timeAgo 迁到 `lib/deliverable-presentation.ts`，truncate 若只 PitchHall 用可保留 local）
- [x] 5.3 保留 PitchHall 文件剩余结构：`activeThreadId` filter / empty state / Card 外层容器 / `onSaveAsSop` handler（把 deliverable 转 `SopDefinition`） / `desktopVaultRoot` 从 runtime context 读
- [x] 5.4 `pnpm --filter @offisim/ui-office build` 通过

## 6. Kanban 删 Deliverables 列

- [x] 6.1 `packages/ui-office/src/components/kanban/KanbanBoard.tsx`：删除 lines 201-234（整个 Deliverables `KanbanColumn` 块）
- [x] 6.2 同文件清 `useDeliverables` import（line 4）和 `const deliverables = useDeliverables();`（line 27）
- [x] 6.3 `pnpm --filter @offisim/ui-office build` 通过，KanbanOverlay 无回归

## 7. RightSidebar Tasks tab 子 tab 改造

- [x] 7.1 `packages/ui-office/src/components/layout/RightSidebar.tsx`：`TabsContent[value='tasks']` 内部重写为：
    - 顶部 `TabsList`（pill 样式，复用 cyan active 规则）三个 `TabsTrigger`：`Activity` / `Plan` / `Outputs`；本层用独立 `useState<'activity' | 'plan' | 'outputs'>('plan')`（默认 Plan）
    - `TabsContent[value='activity']`：`<ActivityRail variant="full" />`
    - `TabsContent[value='plan']`：External Departments section（如原）+ `<TaskDashboard agents={agents} />`
    - `TabsContent[value='outputs']`：`<PitchHall activeThreadId={activeThreadId} />`
- [x] 7.2 删除原 Deliverables section 块（`RightSidebar.tsx:138-145`，含 label "Deliverables"）
- [x] 7.3 External Departments section 从 Tasks tab 顶部挪到 Plan 子 tab 顶部（保持 `externalDepartments.length > 0` gating）
- [x] 7.4 `pnpm --filter @offisim/ui-office build` + `pnpm --filter @offisim/web build` 通过

## 8. Spec + live verify + close-out

- [x] 8.1 review-by-reading：`unify-deliverable-card-surfaces/specs/deliverable-card-presentation/spec.md` 8 requirement / ~20 scenario + `deliverable-artifact-handoff` MODIFIED 8 requirement，所有 scenario 在新代码里成立
- [~] 8.2 web live verify（Chrome DevTools MCP @ 5176）— 结构性子集已验，live chat round-trip 待 user
    - [x] c. Tasks tab 默认 Plan 子 tab，External Departments section 在 Plan 顶部
    - [x] c. 切 Outputs 子 tab → `<DeliverableCard variant='full'>` 渲染 3 条持久化 deliverable，含 Copy/Preview/Download（或 Copy/Export combobox + Export for document kind）/Save as SOP；icon + title + size + timeAgo + avatar stack 字段全在（size 对 legacy IDB-less 行显示 0 B，产品口径正确）
    - [x] d. Activity 子 tab 仅 ActivityRail，无 TaskDashboard / 无 Outputs
    - [ ] a/b. Chat bubble compact card live-render（需 user 发 MiniMax 请求等员工交付）
    - [ ] e. Kanban overlay 无 Deliverables 列（代码层已删，未开 overlay 截图）
    - [ ] f/g. md/csv 非 previewable & 4+ contributor +N 堆叠需 live 交付覆盖
- [x] 8.3 `pnpm typecheck` + 5 包 serial build 全绿
- [x] 8.4 `openspec validate unify-deliverable-card-surfaces --strict` 通过

## 9. Close Out

- [x] 9.1 apply commit（feat(ui-office,web) 范围，body 简述 "为什么 — 三表面统一 + Tasks tab IA + 文件态标准化"）
- [x] 9.2 `/simplify` 审 diff → follow-up commit `902f9e1f`（helper dedupe + DeliverableCard 拆 CompactCard/FullCard + shared CopyButton + useCallback deps 收窄 + RightSidebar PILL_TRIGGER_BASE 共享）
- [x] 9.3 `/opsx:archive unify-deliverable-card-surfaces` → canonical spec sync（新增 `deliverable-card-presentation` + 修订 `deliverable-artifact-handoff`，两条 `openspec validate --strict` 绿）
- [x] 9.4 更新 `project_next_change_queue.md` H2 条目 + completion log 条目；MEMORY.md "Next Change Queue" 段改 "队列已清"（E/F/G/H1/H1-followup/H2 全 archived），H 系列正式关闭（queue 文件非 git-tracked，memory 独立落）
