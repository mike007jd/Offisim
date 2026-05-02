## Why

仓库前端层有两类账没结清：(1) **用户能直接看到的 UX 破口**——deliverable 卡上外包员工渲染成 DiceBear 而非品牌头像，原因是 `Deliverable.contributingEmployees` 类型缺 `isExternal/brandKey`、emit 链路从 `StepTaskOutput` 起就没透传字段，`DeliverableCard` 也没复用 `EmployeeAvatar` SSOT；(2) **8 个已 done 但未走 OpenSpec Archive Gate 的前端类 change 长期挂在 `openspec/changes/`**，导致 spec / tasks / 协议台账漂移、`MEMORY.md` 误报"全部 archived"、live verify 残留目录污染仓库。两类合并收掉一次，避免反复"代码已落但流程没收"循环；同时拒绝最小化交付，每条 deliverable 必须打到完整的用户可见闭环。

> Chat 输入区文件附件能力（原 `chat-input-attachment` capability）经 Codex 审计后确认实际 scope 远大于本 change 看起来的样子（含 binary-safe Tauri IPC、AI read-by-ref tool 实现、vaultRef resolver、thread 持久化层契约），强行塞进本 change 会违反"禁止最小化交付"原则。已拆分到独立 change `add-chat-attachment-end-to-end` 端到端做完，**不在本 change scope 内**。

## What Changes

- **修复 Deliverable 外包贡献者头像**（端到端 propagation）：
  - 扩 `DeliverableCreatedPayload.contributingEmployees` + `Deliverable.contributingEmployees` 类型加 `isExternal: boolean` + `brandKey: string | null`
  - 扩 `StepTaskOutput`（`packages/core/src/graph/state.ts`）加同名字段——Codex 审计指出此层是 propagation 中间环，不补 emit 端拿不到字段
  - 所有写 `StepTaskOutput` 的位置（employee node / external-employee-dispatch / 等 emit 路径）从 employee row 的 `is_external` + `brand_key` 拿到字段填进
  - `boss-summary-node.ts` `emitDeliverable` 直接透传 `currentStepOutputs` 上的两个新字段到 `contributingEmployees`
  - `DeliverableCard.tsx` `ContributorStack` 删 `<DicebearAvatar seed={emp.employeeName}>`，改 `<EmployeeAvatar agent={...}>` row-shape；删 line 104 TODO；同步审视 deliverable detail / activity rail / contributor stack 历史展示等所有出现 contributor 头像的 surface
  - `deliverable-persistence-service.ts` `contributors_json` 反序列化加 schema-tolerant parse（历史数据 `isExternal: false / brandKey: null` 兜底）
- **8 个前端类已完工 change 走完 Archive Gate 三查并 archive**：`add-url-sync-and-deep-links` / `add-workspace-narrow-tier-and-states` / `expand-ui-core-foundation` / `fix-layout-shift-stability` / `rebuild-dialog-and-popover-system` / `unify-design-token-system` / `upgrade-3d-character-rendering-1.0` / `upgrade-3d-scene-lighting-and-materials`。三个 agent 标记需先核验 (`fix-layout-shift-stability` 的 font-display、`rebuild-dialog-and-popover-system` 的 SopAddStepPopover Radix 迁移、`unify-design-token-system` 的 11.x live verify) 必须真核完才能 archive。
- **修复 `MEMORY.md` 错叙述**：删除"UX/IA overhaul 8-phase 已完结全 archived"段，按 git 真相重写当前 backlog；删除已被本调查证伪的 stale backlog（outcome formatter "未分支" 条目 — 实际类型 6 variant 已全覆盖）。
- **清理 `.live-verify/skill-install-outcome-chat`** 残留目录（对应 change 已 archive）。`runtime-context-and-tool-routing` / `fix-doubled-boss-bubble` 留给 Change B（后端）处理。
- **同步 `openspec/protocols-ledger.md`**：8 个 archive 中涉及协议条目同步（Tauri / LangGraph fork / SKILL.md / Better Auth / A2A 视实际改动而定），不漏行。
- **doubled-boss-bubble 不在本 scope**：`.live-verify/fix-doubled-boss-bubble/` 全是 `-pass.png`，无 bug 截图也无 .md 描述，无法在不复现的前提下确定根因。本 change 显式标记此项为"等用户提供症状描述后单独 propose"，避免盲修违反"禁止最小化交付"原则。
- **chat 附件能力不在本 scope**：原 `chat-input-attachment` + `office-chat-default-presentation` capability 移交到独立 change `add-chat-attachment-end-to-end`。该 change 必须端到端覆盖前端三入口 + 客户端 vault/IDB 落盘 + thread 持久化层契约 + AI read-by-ref tool 实现 + Tauri binary-safe IPC + vaultRef resolver。本 change archive 后立刻 propose。

## Capabilities

### Modified Capabilities
- `deliverable-card-presentation`: contributor 渲染必须感知 `isExternal` + `brandKey`，外包贡献者走品牌头像而非 DiceBear；要求该规则在所有 contributor 展示 surface 一致（card / detail / rail / 历史）；要求 `StepTaskOutput` 层贯穿字段（Codex 审计补强项）。

## Impact

- **代码**:
  - `packages/shared-types/src/events/deliverable.ts` — `DeliverableCreatedPayload.contributingEmployees` 元素 shape 扩两字段
  - `packages/core/src/graph/state.ts` — `StepTaskOutput` 接口扩两字段
  - `packages/core/src/agents/` 下所有写 `StepTaskOutput` 的位置（employee-node / external-employee-dispatch 等）补字段
  - `packages/core/src/agents/boss-summary-node.ts` `emitDeliverable` map 透传
  - `packages/core/src/services/deliverable-persistence-service.ts` schema-tolerant parse
  - `packages/ui-office/src/hooks/useDeliverables.ts` `Deliverable.contributingEmployees` shape 同步
  - `packages/ui-office/src/components/deliverable/DeliverableCard.tsx` `ContributorStack` 切 `EmployeeAvatar`
  - `packages/db-local` / `packages/db-platform` 涉及 deliverable contributor 序列化的 mapper / repo 走查
- **流程文档**:
  - 8 个 change 各自的 `tasks.md` / `specs/*` 三查结果记录
  - `openspec/protocols-ledger.md` 同步
  - `MEMORY.md` 重写
- **依赖**: 无新外部依赖。
- **风险**: contributor 字段贯穿 5 层（type + StepTaskOutput + emit + persist + render），改一处忘一处会导致部分 deliverable 头像漂移；3 个标记"需先核"的 archive 若发现 spec 与代码漂移，必须在本 change 内修平再 archive，不许把漂移甩给下一个 change。
