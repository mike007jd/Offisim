## Why

Q1 决策（2026-04-24）：Market 永远只展示 Offisim 自家生态。当前 Market Explore + Manage 顶部 pinned 的 "Connect external A2A agent" card 把外部员工接入塞进了产品商店表面，业务边界混了。F0 已经把官方 seed 资源播进 Market，需要把外部员工入口从 Market 全量撤掉，统一收到 Settings → External Employees tab（已存在并工作）。

## What Changes

- 删除 `MarketPage` Explore grid 顶部的 pinned `MarketExternalAgentCard`（line 223 grid 入口）。
- 删除 `MarketPage` Manage → Installed 顶部的 row variant `MarketExternalAgentCard`（line 244）。
- 删除 `MarketPage` 自持的 `ExternalEmployeeInstallDialog` 实例及其 open state（line 262 + 相关 `useState`）。
- 删除 `MarketExternalAgentCard.tsx` 文件本身（不再有任何 consumer）。
- **保留** `ExternalEmployeeInstallDialog.tsx`（Settings tab 唯一 consumer）。
- **保留** `agent-card-discovery.ts`（Dialog + Settings refresh-card 都依赖）。
- **保留** `SettingsExternalTab` 作唯一入口（行为不变）。
- **BREAKING（spec-level）**：canonical `external-employee-install` Requirement #1（Market workspace exposes discovery entry…）整段删除，连同 3 个 scenario（Explore pinned card / Manage installed entry / No registry listing pollution）。其余 5 个 Requirement（Dialog 3-step / discovery / brand inference / Settings tab / persistence contract）保留不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `external-employee-install`: 删除 "Market workspace exposes discovery entry for external A2A agents" 整个 Requirement 与其 3 个 scenarios。其余 5 个 Requirement 不动。Settings tab 升格为唯一入口（Requirement #5 措辞不需改，本来就独立成立）。

## Impact

- **代码**：
  - `packages/ui-office/src/components/marketplace/MarketPage.tsx` — 删 import / pinned card 渲染 / dialog state + JSX。
  - `packages/ui-office/src/components/marketplace/MarketExternalAgentCard.tsx` — 整文件删除。
  - `apps/platform/src/startup.ts` — release desktop live verify 需要允许 `tauri://localhost` 访问本地 platform dev API，否则 Market 在 release `.app` 内会被 CORS 拦成 `Load failed`。
  - 无其他 consumer 受影响（grep 已验证）。
- **类型 / API**：无 schema / repo / event / props 契约变更。
- **构建顺序**：纯 ui-office 改动，链 `shared-types → ui-core → core → ui-office → web` 仍按既有 serial。
- **i18n / 文案**：删除 Market pinned card 的"Connect external A2A agent"等 copy 字符串。
- **canonical spec**：`openspec/specs/external-employee-install/spec.md` archive 时 sync（删 Requirement #1 + 3 scenarios，编号下移）。
- **Live verify 表面**：Web + Desktop release 都需要确认 Market Explore / Manage 无外部 agent 入口；Settings → External Employees 入口照常工作；现有外部员工的 dispatch / 渲染不退化。
