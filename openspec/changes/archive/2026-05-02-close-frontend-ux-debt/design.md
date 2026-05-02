## Context

Offisim 前端层有两类账长期未清：

1. **真实 UX 破口（contributor 头像 propagation 断裂）**：
   - `DeliverableCard.tsx:104` 注释明确承认 contributor 类型缺 `isExternal/brandKey` 字段，所有外包贡献者退化成 DiceBear。
   - 真实根因比表面更深：`StepTaskOutput`（`packages/core/src/graph/state.ts:71`）作为 employee → boss summary → deliverable emit 的中间数据结构，**从源头就没有这两个字段**；`boss-summary-node.ts:243` `emitDeliverable` 直接 `state.currentStepOutputs.map(...)` 拼 `contributingEmployees`，所以哪怕 emit 层补字段也无源可取。
   - `EmployeeAvatar` + `BrandAvatar2D` 早已存在并按 `brandKey` 走分支——破口出在 propagation 链 5 处都要补。
2. **OpenSpec 流程债**：8 个 `tasks.md` 全勾的前端类 change 长期挂在 `openspec/changes/`，导致 `MEMORY.md` 误称"全部 archived"，spec / tasks / 协议台账无人核验。本仓库的 OpenSpec Archive Gate (root `CLAUDE.md`) 是硬规则——绕过等于让漂移持续累积。

`.live-verify/fix-doubled-boss-bubble/` 7 张 `-pass.png` 截图无 .md 描述、无 bug 截图——本设计**不**触它，避免盲修。

> **Scope 修正记录**：原版 design 包含 chat 输入区文件附件能力（`chat-input-attachment` capability）。Codex 审计后确认 attachment 真实 scope 跨 5 层（前端三入口 + 客户端 vault/IDB 落盘 + thread 持久化契约 + AI read-by-ref tool 实现 + Tauri binary-safe IPC + vaultRef resolver），强行塞进本 change 必然降级成"能发能存能看，员工读不到"的半闭环。已拆分到独立 change `add-chat-attachment-end-to-end`，本 design 删去 D1/D2/D3/D4 attachment 相关决策。

## Goals / Non-Goals

**Goals:**

- DeliverableCard contributor 头像跨 surface 一致：内部员工 DiceBear、外包员工 BrandAvatar2D，路径**统一**走 `EmployeeAvatar`，不再有第二条 `<DicebearAvatar seed={emp.employeeName} />` 平行分支。
- contributor `isExternal` + `brandKey` 字段从 employee row 一路贯穿 `StepTaskOutput` → `boss-summary-node.emitDeliverable` → `DeliverableCreatedPayload` → `useDeliverables.Deliverable` → `DeliverableCard.ContributorStack`，无中断。
- 8 个前端类 change 全部走完 Archive Gate 三查并 `/opsx:archive`；遇到 spec/code 漂移当 change 修平。
- `MEMORY.md` 与 git 真相对齐；`openspec/protocols-ledger.md` 同步 8 个 change 涉及的协议行；删除 stale backlog 条目。
- 清理 `.live-verify/skill-install-outcome-chat`（对应 change 已 archive）。

**Non-Goals:**

- chat 输入区文件附件能力——属独立 change `add-chat-attachment-end-to-end`，本 change archive 后立刻 propose。
- doubled-boss-bubble bug 修复（无证据，等用户复现后单独 propose）。
- 后端 / runtime / sandbox / SDK lane 工具事件流可视化（属 Change B `close-runtime-binding-and-routing-debt`）。
- close-runtime-routing-and-workspace-debt 的 13.1–13.4 live verify（属 Change B）。
- 重新设计 contributor avatar 视觉语言；本 change 只修复"应有但缺失"的分支，不动既有视觉系统。

## Decisions

### D5. Deliverable contributor 类型升级（含 propagation 中间环 + 三条 emit 路径）

**Decision**: 七层同步增加 `isExternal: boolean` + `brandKey: string | null`：

```
1. packages/shared-types/src/events/deliverable.ts → DeliverableCreatedPayload.contributingEmployees 元素 shape
2. packages/core/src/graph/state.ts → StepTaskOutput interface 扩两字段（Codex 审计补强项 1）
3. packages/core/src/agents/* → 所有写 StepTaskOutput 的位置（employee-node / external-employee-dispatch / sop-runner 等）从 employee row 的 is_external + brand_key 取
4a. packages/core/src/agents/boss-summary-node.ts:243 → emitDeliverable map 透传 currentStepOutputs 字段
4b. packages/core/src/agents/employee-completion.ts:331 → 直接 emit deliverable.created 路径（materialized artifact）从 employee row 取字段（Codex 审计补强项 2）
4c. packages/core/src/agents/employee-a2a-executor.ts:269 → 直接 emit deliverable.created 路径（external A2A artifact）从 employee row 取字段（Codex 审计补强项 2）
5. packages/ui-office/src/hooks/useDeliverables.ts → Deliverable.contributingEmployees 元素 shape 同步
6. packages/core/src/services/deliverable-persistence-service.ts → contributors_json 反序列化兜底
7. apps/web/src/lib/tauri-checkpoint.ts → LangGraph checkpoint loadLatest 路径补字段兜底（Codex 审计补强项 3：StepTaskOutput 进 channel_values 持久化）
```

emit 端若不补 StepTaskOutput 层就只能从 currentStepOutputs 拿到 employeeId/employeeName/sourceKind/roleSlug 四字段，**永远拿不到** isExternal/brandKey。直接 emit 路径（4b/4c）绕过 boss-summary 链，必须独立从 employee row 取字段。

存量数据如果只有 `employeeId` + `employeeName` + `roleSlug`：
- `contributors_json` (DB row) 反序列化按 `isExternal: false / brandKey: null` 兜底
- LangGraph checkpoint `currentStepOutputs[]` (channel_values) 恢复时同款兜底
- harness scenario fixtures (`packages/core/harness/scenarios/*.json`) 必须 in-place 加字段，否则 strict scenario 校验会失败

`DeliverableCard.tsx` `ContributorStack` 删掉 `DicebearAvatar` 直接调用，改用 `EmployeeAvatar` 传 row-shape：`agent={{ is_external: emp.isExternal ? 1 : 0, brand_key: emp.brandKey, name: emp.employeeName, persona_json: null }}`。

`EmployeeAvatar` 现有 dispatch 是 `isExternal === true → BrandAvatar2D`（不论 brandKey），`isExternal === false → DicebearAvatar`。`BrandAvatar2D` 收到 `brandKey: null` 走 `lookupExternalBrand(null)` 的 custom-external-brand fallback。**外部贡献者永远不渲染 DiceBear**，即使 brandKey 未知。

**Rationale**: `EmployeeAvatar` 已是 SSOT，不复用就是又造一条平行分支。propagation 链补全后，所有现存 emit 路径自动获得 brand-aware 渲染。三条 emit 路径独立补字段，避免「只补 boss-summary 链，员工直接产 artifact 时头像漂移」漏判。

### D6. Archive Gate 执行顺序

按"风险递增"排序。前 5 个先走（agent 标记 ✅ 可直接 archive）：

1. `add-url-sync-and-deep-links` — 实现 5 文件齐全
2. `add-workspace-narrow-tier-and-states` — skeleton + ErrorState 已落地
3. `expand-ui-core-foundation` — 6 原语已补
4. `upgrade-3d-character-rendering-1.0` — schema 渲染链路已通
5. `upgrade-3d-scene-lighting-and-materials` — 光照/材质 SSOT 已落

后 3 个**先核再 archive**（agent 标记 ⚠️）：

6. `fix-layout-shift-stability` — 必须核 `apps/web/index.html` 含 `@font-face` + `font-display: swap`，且自托管 Inter / JetBrains Mono variable woff2；缺则补再 archive。
7. `rebuild-dialog-and-popover-system` — 必须 grep 确认 `SopAddStepPopover` 已用 Radix `@radix-ui/react-popover`，全库无残留 hand-rolled popover；漂移则修平再 archive。
8. `unify-design-token-system` — 必须 release `.app` 跑过主题切换 + token 来源单一性，跑完写 verify 记录到 change 目录再 archive。

**Rationale**: 先做安全的 5 个建立惯性，再啃 3 个有漂移可能的；任何一个发现真坑就停住修，不许把"漂移留给下一个 change"。

### D7. MEMORY.md 修复 scope

删 stale 段：

- "UX/IA overhaul 8-phase 已完结：A1-A4 / C0-C2 / D1-D3 / E1-E2 / F0-F1 / G1 / H1 全 archived" — git 反证
- backlog 条目 "Skill install outcome formatter 没分支 staging-expired/skill-install-error" — `install.ts:81` switch 6 variant 全覆盖反证
- backlog 条目 "T2.4 self-authoring skills" — archive 已落 `installSkill` source='self-authored' + `create_skill_from_scratch` 工具 + `SkillInstallConfirmBubble` create 分支，task 6.9/6.11 live verify 待跑（条目应改为"剩 live verify 未跑"而非"未做"）。

新增条目：

- 8 个 archive 完成记录（指向 git SHA）
- doubled-boss-bubble 等用户复现条目
- chat attachment 端到端 change `add-chat-attachment-end-to-end` 待 propose

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| Contributor 字段贯穿 5 层，改一处忘一处 → 部分 deliverable 头像内/外混淆 | tasks.md 明列 5 层每层验收点；live verify 必须构造 mixed internal/external 的 deliverable 看头像分支；harness/script 走 round-trip 校验 |
| `EmployeeAvatar` row-shape 在 deliverable contributor 的 `roleSlug` / `employeeName` 与 EmployeeRow 字段名差异 → 渲染漂移 | 不传 EmployeeRow 整体；只传 `EmployeeAvatar` 真正消费的最小字段 (`is_external` / `brand_key` / `name` / `persona_json: null`)。差异由 D5 描述的"row-shape adapter inline"承接 |
| 8 个 archive 走太快漏掉真坑 | D6 严格分两批；后 3 个 ⚠️ 必须先核验明确 PASS 才 archive，发现漂移当本 change 修 |
| 历史 deliverable 没 isExternal/brandKey 字段 → rehydrate 报 undefined | D5 明确兜底 `is_external: false, brand_key: null`；DB 列 `contributors_json` 存 JSON 字符串，反序列化处加 schema-tolerant parse |
| `MEMORY.md` 改完 git 又往前走 → 再次 stale | tasks.md 末尾要求 archive 8 个 + 修 MEMORY 是同一原子提交；不允许 archive 完不更 memory |
| StepTaskOutput 补字段会牵动 employee-node / external-employee-dispatch 多处写入 → 漏写处该字段 undefined | grep 全库所有 `StepTaskOutput` 构造点；TypeScript strict 模式强制 required 字段会编译失败兜底 |
| StepTaskOutput 进 LangGraph checkpoint `channel_values` 持久化 → 旧 checkpoint 恢复后 currentStepOutputs[] 缺字段，strict 类型检查崩 | `TauriCheckpointSaver.loadLatest` 反序列化路径加 hydrate 兜底（缺字段填 `isExternal: false / brandKey: null`）；harness scenario fixtures in-place 加字段 |
| 三条 deliverable emit 路径（boss-summary / employee-completion / employee-a2a-executor）独立，只补一条会留漂移 | tasks.md 显式列出三条路径独立验收点；harness scenario 覆盖 boss-summary 链；direct-emit 路径走 ts-node script round-trip 校验 |

## Migration Plan

仓库无 prod 部署、无 DB migration 链（pre-launch 单基线），不需要 rollout。但发布前 hygiene：

1. contributor JSON shape 升级对历史 deliverable backwards-compatible（D5 `contributors_json` 兜底）。
2. `StepTaskOutput` 字段升级**会进 LangGraph checkpoint 的 `channel_values` 持久化**（`TauriCheckpointSaver` 反序列化出来就是 `OffisimGraphState`，含 `currentStepOutputs[]`）；旧 checkpoint 恢复需要 `loadLatest` 路径 hydrate 兜底，缺字段填 `isExternal: false / brandKey: null`。
3. harness scenario fixtures（`packages/core/harness/scenarios/*.json`，至少 `dag-output-attribution.json` / handoff-相关 / 任何含 `currentStepOutputs` 的）in-place 加新字段，避免 strict scenario 校验失败。
4. archive 之前 commit "前端 UX 破口修复" 部分；archive 同一批 commit；MEMORY.md 修复同 commit。
5. 失败回滚：archive 是 `openspec` 文件移动，git revert 即可；contributor 字段代码改动 git revert 即可（checkpoint hydrate 兜底是 additive 修改，回滚不破坏旧 checkpoint）。

## Open Questions

- **Q1**：8 个 archive 完成后，要不要立刻给 Codex 那条 Change B propose？还是等 attachment 单独 change `add-chat-attachment-end-to-end` 也 archive 完再 propose？
  **倾向**：本 change archive 后立刻 propose `add-chat-attachment-end-to-end`（attachment 是用户可见 UX，优先级高于后端 routing 整理）。Change B `close-runtime-binding-and-routing-debt` 在 attachment 之后再 propose。**需用户拍板**。
