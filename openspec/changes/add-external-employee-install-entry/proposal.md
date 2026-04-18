## Why

Phase 2b #1 (A2A dispatch rewire, commit `1d1889c4`) 和 #2 (brand avatar 渲染分支, commit `738354f9`) 已经把外包员工的底盘铺完 —— DB schema `is_external / a2a_url / a2a_token / a2a_agent_id / brand_key / agent_card_json` 6 列、`employee-node` 按 `is_external === 1` 分派到 `runEmployeeA2A`、`BrandRegistry` SSOT + 2D/3D render branching 都就位了。**缺的是入口**：用户目前没有任何 UI 能把一个真实的 A2A 端点（Hermes / OpenClaw / Codex / 未知品牌）变成公司里的外包员工。`EmployeeCreatorOverlay` 只收 `name / role / seed`，所有 external 字段全留 null / 0，DB 里永远没有 external 员工，`employee-node` 的 A2A 分支永远不会触发 —— 相当于 #1 + #2 在产品层处于空转状态。

这条 change 补上 **"连接外部 A2A 代理"** 的完整 install 入口：Market workspace 加 discovery card + install dialog（主入口，用户发现+安装），Settings workspace 加 "External Employees" 管理 tab（次入口，列表 + 编辑 + 重拉 agent card + 解除连接）。Install 流程核心是 **agent card discovery**：用户填 URL + 可选 token → 前端 `fetch('/.well-known/agent-card.json')` → 校验 v1.0 schema（`supportedInterfaces[].protocolBinding === 'JSONRPC'` 必须存在）→ 按 `name / provider.organization` 启发式匹配 `BrandRegistry` 填 `brand_key`（未命中落 `custom`，用户可覆盖）→ 持久化到 `employees` 表。

## What Changes

- **Market workspace — discovery entry**：Explore 模式网格顶部 pin 一张 "Connect your own A2A agent" 卡片（或 Manage 模式 `installed` tab 上方），点击开 install dialog。不污染 registry `INSTALLABLE_KINDS`，不塞进 listing schema（外部 A2A 不走 registry）。
- **Install dialog（3 步）**：
  1. 输入 `url` + 可选 `token` + 可选 `agentId` → "Discover" 按钮触发 agent card fetch
  2. Preview 面板：展示 `agentCard.name / description / provider / capabilities / skills[]`；自动推导 `brand_key`（匹配 `BrandRegistry` 或 `custom`）；用户可在下拉覆盖；capability 警告（比如不支持 `streaming` 但 employee 会被派工的 warning banner）
  3. Confirm → `repos.employees.create({is_external:1, a2a_url, a2a_token, a2a_agent_id, brand_key, agent_card_json, role_slug, name, …})`，emit `employee.created` 事件，toast 成功 + 跳回 office
- **Settings workspace — new "External Employees" tab**：列表展示已安装的 external employee（`brand_key / url / agent_card.name / last_discovered_at`）；每行提供：Refresh card（重拉 `/.well-known/agent-card.json` 并 diff）/ Edit token / Disconnect（删员工）。不重新发明编辑 UX，和 dispatch / render 保持同一条 SSOT。
- **Agent card discovery 层**：在 `packages/core/src/a2a` 或 ui-office 侧新增 `discoverAgentCard(url, token)` helper，复用 `A2AClient` 但用"一次性 discover without caching"模式；校验结果包括 protocol version、supportedInterfaces[0] binding、required fields；CORS / network failure 分类错误返回给 UI 层做人读文案。
- **Brand inference**：`inferBrandKey(agentCard)` 纯函数，按 `name.toLowerCase()` 或 `provider.organization` 匹配 `hermes / openclaw / codex`，fallback `custom`。单纯前端 heuristic，无网络调用。
- **Role slug 默认值**：external employee 建出来也需要 `role_slug`（DB NOT NULL）。Dialog 让用户从现有 `ROLE_OPTIONS` 选一个（按品牌给个默认值：hermes/codex → `developer`，openclaw → `researcher`，custom → 用户必选）。
- **Live verify gate**：验证纪律按 repo 规则走 —— 用 `chrome-devtools-mcp` 在 web SPA 跑真流程（localhost mock A2A server 或本地 SDK 起的一个 agent），install 后办公室出现品牌员工 avatar，派工走 A2A 真实返回。

**BREAKING**: 无。已安装的内部员工不受影响；`EmployeeCreatorOverlay` 内部流程不变（只给内部员工）。

## Capabilities

### New Capabilities

- `external-employee-install`: Market/Settings 入口 + install dialog + agent card discovery + brand inference + 持久化契约 + 错误分类（CORS / network / schema invalid / brand fallback）。覆盖"从 URL 到 employees 行"整条链路，**不**覆盖已经 landed 的 dispatch / render（那在 `external-employee-a2a-dispatch` 和 `external-employee-brand-avatars`）。

### Modified Capabilities

- 无。此 change 只加新表面，不改 dispatch 语义也不改 render 分支契约。如果后续发现现有两条 spec 需要引用 install 入口，单独追加 delta，不在本 change 合并。

## Impact

**New code**:
- `packages/ui-office/src/components/employees/ExternalEmployeeInstallDialog.tsx` (install 3-step dialog)
- `packages/ui-office/src/lib/agent-card-discovery.ts` (discoverAgentCard helper + inferBrandKey + schema 校验)
- `packages/ui-office/src/components/settings/SettingsExternalTab.tsx` (+ 挂到 `SettingsWorkspaceSurface.tsx` Tabs)
- `packages/ui-office/src/components/marketplace/MarketExternalAgentCard.tsx`（discovery entry card pinned in MarketPage）

**Modified**:
- `packages/ui-office/src/components/marketplace/MarketPage.tsx`：在 Explore 网格上方嵌 external agent card，在 Manage/installed 顶部加对应入口
- `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx`：`SettingsTab` union 加 `'external'`，TabsList 加一项，TabsContent 挂 `SettingsExternalTab`
- `packages/ui-office/src/components/settings/SettingsTabNav.tsx`：导航多一项
- `apps/web/src/App.tsx` / `AppOverlayHost.tsx`：dialog 由 MarketPage 本地托管（不新增 OverlayKey），只需透传 `onExternalEmployeeCreated` 回调给 toast / refresh
- `apps/web/src/components/workspaces/types.ts`：`SettingsSessionState.activeTab` union 加 `'external'`，`DEFAULT_SETTINGS_STATE` 不变（默认仍 provider）

**Dependencies / systems**:
- 复用 `@offisim/core/a2a` 的 `A2AClient.getAgentCard()` 或新 helper；不动协议层。
- 复用现有 `repos.employees.create()` 接口（`NewEmployee` 已含 6 个 external 字段）。
- 无 DB migration（schema 已在 024 就位）。
- 无自动化测试（repo 规则）；live verify 清单写入 tasks.md。

**Known tradeoffs**:
- 浏览器直接 `fetch(/.well-known/agent-card.json)` 取决于目标 A2A server 有没有开 CORS。没开就 fetch fail；错误 banner 里给用户明确提示"对方服务器需要 `Access-Control-Allow-Origin`"，不假装支持代理（桌面端未来可以走 Tauri `fetch` 绕过，但不在本 change）。
- Brand 推断是 heuristic，可能误判 —— 所以用户可在 dialog 覆盖，且 Settings 可编辑。
- Dialog 里的 role_slug 是产品取舍：外包员工在 Offisim 场景里依然要进 zone / 走 ceremony，所以必须绑 role；未来如果有"无 role external agent" 概念再扩 schema。
