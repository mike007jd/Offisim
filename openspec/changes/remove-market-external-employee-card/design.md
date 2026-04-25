## Context

UX overhaul Phase F. F0 已经把 6 类 Offisim 自家 seed 资源播进 Market（archive 2026-04-25 commit `0960407e`）。当前 `MarketPage` 仍把外部 A2A agent 的 install 入口 pinned 在 Explore grid 顶部和 Manage → Installed 顶部 —— 这是 Phase 2b #3 `add-external-employee-install-entry`（archive 2026-04-19）落下的，那时 Q1 决策还没拍。Q1 决策（2026-04-24）后这个表面属于业务越界：Market = 自家生态商店，外部员工 = Settings 接入系统，必须拆。

外部员工接入的另一个入口 `SettingsExternalTab`（同 archive 2026-04-19 落地）已存在并完整工作（list / refresh-card / edit-token / disconnect），它本身已经持有自己的 `ExternalEmployeeInstallDialog`，所以删 Market 入口对功能完整性零影响。

## Goals / Non-Goals

**Goals:**
- Market Explore + Manage 表面零外部员工痕迹（card / dialog mount / 文案 / import 全删）。
- `MarketExternalAgentCard.tsx` 文件级删除（不留死代码）。
- canonical `external-employee-install` spec 同步去掉 Market 入口的 Requirement + 3 个 scenario，保持 spec 与代码 1:1。
- 现有外部员工的 dispatch（A2A）+ 渲染（brand avatar）+ Settings 管理 100% 不退化。

**Non-Goals:**
- 不动 `agent-card-discovery.ts`、`ExternalEmployeeInstallDialog.tsx`、`SettingsExternalTab.tsx`、`SettingsTab` union、`brand-registry`、`employee-node` A2A dispatch。
- 不改 employees schema / repos / events。
- 不动 `INSTALLABLE_KINDS`（已经是 `['employee', 'skill']`，与外部 agent 卡无关）。
- 不重写 Settings tab UI（H1 `compact-settings-center` 才管 Settings 紧凑化）。
- 不引入 deprecation 期 / feature flag —— 外部员工入口不是数据迁移，是入口收口。

## Decisions

### Decision 1: 整段删除 Market 入口而非 hidden flag

不走"用 flag 隐藏 + 保留 fallback"路线：
- 用户 CLAUDE.md 明确 "deprecated 代码不是常驻资产"，"不要无限保留 Pending removal 路径"。
- Q1 决策是产品边界澄清（Market = 自家生态），不存在"也许还要切回去"的中间态。
- 保留 dead code 会让下一个开发者怀疑是不是还有隐藏入口要修复。

→ MarketPage 直接删 import + JSX + dialog state；`MarketExternalAgentCard.tsx` 直接 `git rm`。

**Alternatives considered:** (a) 加 `if (false)` gate — 拒绝，留死代码；(b) 改成 Settings 跳转链接 — 拒绝，给 Market 拖业务尾巴。

### Decision 2: 删 dialog 实例而非把它移给 Settings

`MarketPage` 当前自己 mount 了一份 `<ExternalEmployeeInstallDialog>`，`SettingsExternalTab` 也自己 mount 了一份。删 Market 实例后，Settings 实例仍独立工作（它本来就独立）—— 两份 mount 各自管自己的 open state，没有共享 store。

→ 直接删 Market 实例 + 它的 `useState` open flag，不做任何"迁移"。

### Decision 3: spec delta 用 REMOVED Requirements，不用 MODIFIED

Requirement #1 整段删除（含 3 个 scenario），不是改措辞。按 OpenSpec 工作流，REMOVED + Reason + Migration 是正确语义。Migration 指向 Settings → External Employees tab 作为唯一入口（即 Requirement #5，未变）。

### Decision 4: spec 其余 Requirement 全部不动

Requirement #2-#6（Dialog 3-step / discovery / brand inference / Settings tab / persistence contract）描述的能力都还成立，措辞中没有"Market 入口"的隐式假设（已逐句核对 spec.md：#2 描述的是"Dialog"，没绑定调用源；#3-#4 是 helper 契约；#5 描述 Settings tab；#6 是 row contract）。所以 delta 文件**只有 REMOVED 段**。

## Risks / Trade-offs

- **[Risk] Settings tab 在没有 external employee 的公司可能被忽略 → Mitigation**：本 change 不动 Settings tab 触达逻辑；空态文案 + tab 入口可见性是 H1 `compact-settings-center` 的事。这里只确保删 Market 入口不会让用户 0 入口可见。Settings tab 在 nav 里始终可见（已验过 spec.md Requirement #5 scenario 1：tab 始终渲染，前提是公司有 ≥1 外部员工 —— 这里有个 spec 字面隐含的"≥1 外部员工才显示"措辞，但 F1 不修这个，留给 H1 一并整改）。
- **[Risk] 删除文件后 Vite dev cache 可能短时不一致 → Mitigation**：CLAUDE.md 已记录 workspace dep pre-bundle stale 的修复手段（`optimizeDeps.force = command === 'serve'` 已落），重启 dev server 即生效。Live verify 在 release `.app` 里做兜底。
- **[Risk] 第三方插件 / fork 可能直接 import `MarketExternalAgentCard`**：Offisim 是单 monorepo，无外部 consumer。grep 已确认 `apps/web` + `packages/*` 内零外部引用。

## Migration Plan

无运行时 migration（不动数据）。改动是纯 UI surface 删除。

部署顺序：
1. 同 PR 内删 `MarketPage` 的引用 + 删 `MarketExternalAgentCard.tsx` 文件 + 修订 spec delta。
2. 跑 `pnpm typecheck`（按 serial 顺序）确认无 dangling import / type 错误。
3. Live verify（web + desktop release）：Market Explore / Manage 无外部入口；Settings → External Employees install / refresh / disconnect 全跑。
4. archive 时同步 canonical `external-employee-install` spec —— 严格按 archive gate 三查（spec / tasks / 文档 一致），并校协议台账 A2A 行（本 change 不改协议，仅改入口位置，台账行无需更新）。
