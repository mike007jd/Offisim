## 1. Discovery helper + brand inference（纯逻辑层，零 UI）

- [x] 1.1 新建 `packages/ui-office/src/lib/agent-card-discovery.ts`，导出 `discoverAgentCard(url, opts?: { token?, agentId?, signal? })`、`AgentCardDiscoveryError` 带 `class: 'network' | 'cors' | 'invalid-json' | 'schema' | 'incompatible-protocol'` 字段，和一个 20 KB body 上限 guard
- [x] 1.2 在同文件写 `inferBrandKey(card: A2AAgentCard): ExternalBrandVariant`：lowercase substring 按优先级 `hermes > openclaw > codex`，miss 返回 `'custom'`
- [x] 1.3 加一个 `defaultRoleForBrand(brand: ExternalBrandVariant): RoleSlug | null`：hermes/codex → `'developer'`，openclaw → `'researcher'`，custom → `null`
- [x] 1.4 在 `packages/ui-office/src/lib/__inline-fixtures__` 或就近位置写 3 个典型 agent card JSON fixture（hermes / openclaw / unknown）备 live verify 用；不引入 vitest / jest

## 2. Install dialog 组件（3 步流）

- [x] 2.1 新建 `packages/ui-office/src/components/employees/ExternalEmployeeInstallDialog.tsx`，props: `{ open, onClose, activeCompanyId, repos, eventBus, onInstalled?(row) }`
- [x] 2.2 Step 1：`url` / `token` / `agentId` 输入 + Discover 按钮。`url.trim()` 要过 `new URL()` 才 enable Discover
- [x] 2.3 Step 2：成功后渲染 agentCard 概览 + 推断 brand + 默认 role + 可编辑 display name；brand select 列出 `ExternalBrandVariant` 全选项；role select 用 `ROLE_OPTIONS`
- [x] 2.4 Step 3：`submit()` 调 `repos.employees.create({ company_id, name, role_slug, is_external: 1, a2a_url, a2a_token, a2a_agent_id, brand_key, agent_card_json: JSON.stringify(card), source_asset_id: null, source_package_id: null, persona_json: null, config_json: null })`，成功后 `eventBus.emit(employeeCreated(...))`、`onInstalled(row)`、`onClose()`
- [x] 2.5 Abort：dialog close 时 abort in-flight discovery，进度中按钮 disabled，`isSubmittingRef` 同步锁防并发 confirm
- [x] 2.6 错误文案映射：5 类 `AgentCardDiscoveryError.class` 各一条人读 banner；`cors` 明示"对方服务器需要 Access-Control-Allow-Origin"

## 3. Market workspace discovery entry

- [x] 3.1 新建 `packages/ui-office/src/components/marketplace/MarketExternalAgentCard.tsx`，独立卡组件，接 `onClick` prop
- [x] 3.2 修改 `MarketPage.tsx`：加本地 state 控制 install dialog 开关；Explore 网格上方 render `MarketExternalAgentCard`；Manage → Installed 顶部加对应 action
- [x] 3.3 在 `MarketPage` 里挂 `<ExternalEmployeeInstallDialog>`，用 `useRepos()` / `useEventBus()` 拿依赖（通过现有 runtime context hook）
- [x] 3.4 确认 `useMarketplace().results` 未被污染：discovery entry 不进 results、不算 `hasMore`、不算 `isLoading`

## 4. Settings workspace External Employees tab

- [x] 4.1 扩 `SettingsTab` union（`SettingsWorkspaceSurface.tsx`）加 `'external'`
- [x] 4.2 修改 `SettingsTabNav.tsx`：多一项 "External Employees"（tab 顺序放到 MCP 之后）
- [x] 4.3 修改 `SettingsContentArea.tsx`：`activeTab === 'external'` 渲染 `SettingsExternalTab`
- [x] 4.4 新建 `packages/ui-office/src/components/settings/SettingsExternalTab.tsx`：用 `useRepos()` + 订阅 `employee.` 事件 invalidate 列表；读 `repos.employees.findByCompany(activeCompanyId).filter(e => e.is_external === 1)`；每行展示 brand / url / card.name；按钮 Refresh card / Edit token / Disconnect
- [x] 4.5 Refresh card：重调 `discoverAgentCard(row.a2a_url, { token: row.a2a_token })`，成功后 `repos.employees.update(row.employee_id, { agent_card_json: JSON.stringify(newCard), updated_at: now })`；失败走错误文案不改行
- [x] 4.6 Edit token：小型内联 form，改 `a2a_token` 持久化
- [x] 4.7 Disconnect：确认 prompt 后 `repos.employees.delete(row.employee_id)`，emit `employee.deleted` 事件
- [x] 4.8 `apps/web/src/components/workspaces/types.ts` 的 `SettingsSessionState.activeTab` union 加 `'external'`；`DEFAULT_SETTINGS_STATE` 保持 `'provider'` 默认

## 5. 契约与下游对齐验证（静态）

- [x] 5.1 grep 检查：新建的外部员工经 `resolveBrand()` 返回 `{kind:'external', entry:{brandKey}}`；canvas / 3D scene 分支命中（静态代码 trace，不跑）
- [x] 5.2 grep 检查：`employee-node.ts` `if (employee.is_external === 1)` 分支能吃到新 row；确认字段名和 `NewEmployee` / `EmployeeRow` 对齐
- [x] 5.3 类型串联：`pnpm --filter @offisim/ui-office typecheck && pnpm --filter @offisim/web typecheck`

## 6. Live verify（repo 纪律：无自动测试，chrome-devtools-mcp）

- [x] 6.1 准备 live 端点：本地起一个 mock A2A 服务（或用已有 SDK demo），至少暴露 hermes / 无名两种 agent card；记 URL
- [x] 6.2 跑 `apps/web` dev server（port 5176）
- [x] 6.3 Market → Explore：看到 pinned 卡；点开 dialog
- [x] 6.4 Step 1：输入 mock URL + Discover；看 step 2 agent card 正确；brand 推断是 `hermes` / `custom`
- [x] 6.5 Step 2：换 role / 改 name / 覆盖 brand（custom → hermes）；Confirm
- [x] 6.6 Office scene：新员工出现，avatar 用 brand SVG（2D）/ brand body（3D）；派工触发 A2A 真实请求（看 console / network tab）
- [x] 6.7 Settings → External Employees：列表有新员工；Refresh card 成功更新 `agent_card_json.version`（对端改版后可见）；Edit token 持久化；Disconnect 员工从 scene / list 消失
- [x] 6.8 错误 path：输入不可达 URL（network）/ 故意返回 v0.3 schema（incompatible-protocol or schema）/ 同 origin CORS block → 每类 banner 对应文案

### 6.x Live Verify Record

- 2026-04-19 本机 live verify 完成；当次浏览器交互记录已在本地验证后清理，归档只保留观察结论。Playwright artifact 时间戳当时为 UTC；当前会话日期是 2026-04-19 Pacific/Auckland。
- 6.1 端点：复用已有 `http://127.0.0.1:18800/.well-known/agent-card.json` Hermes peer stub，并额外起本地 mock `http://127.0.0.1:18801` 覆盖 `/hermes`、`/custom`、`/badjson`、`/schema`、`/incompatible`、`/cors`；另起最小 Market stub `http://localhost:4100/v1/market/search` 让 Explore 进入正常渲染态。
- 6.3 通过：Market → Explore 渲染 pinned `Connect external A2A agent` 卡，且 registry result 仍只有 stub listing `Live Verify Designer`。
- 6.4 通过：`http://127.0.0.1:18801/hermes` 预览页显示 `Hermes Live Verify / Hermes Labs / version 1.0.0`，brand 预选 `Hermes`，role 默认 `Developer`；`http://127.0.0.1:18801/custom` 预览页显示 `Nebula Analyst / Nebula Cooperative / version 1.0.0`，brand 预选 `Custom`，role 为空。
- 6.5 通过：custom card 上把 display name 改成 `Nebula Hermes Contractor`，brand 从 `Custom` 改为 `Hermes`，role 选 `Developer`，Confirm 后出现 `Connected Nebula Hermes Contractor` toast；localStorage snapshot 记录 `is_external:1`、`brand_key:'hermes'`、`a2a_url:'http://127.0.0.1:18801/custom'`。
- 6.6 初跑失败：Office roster / scene 出现新员工，direct chat 向该员工发送 `Live verify ping from Offisim` 后，mock log 记录 `SendMessage` 命中 `http://127.0.0.1:18801/custom/rpc`，task_run / deliverable / agent_event 都写入本地 snapshot，说明 dispatch 走了 A2A 真请求。Quick Inspect 头像是 Hermes 资产（alt `Hermes`，data URI 对应 brand SVG），但刚安装后返回 Office 的 roster card 头像仍是 DiceBear avataaars。
- 6.7 通过：Settings → External Employees 列出新员工；`Refresh` 前先把 mock `/custom` version bump 到 `1.0.1`，点击后 UI 文案更新为 `agent card: Nebula Analyst · v1.0.1`；`Edit token` 保存 `tok_live_verify_123` 后 localStorage snapshot 的 `a2a_token` 已更新；`Disconnect` 后 Settings 变回 `No external employees yet`，再回 Office 确认 roster 无 `Nebula Hermes Contractor`，成员数回到 8。
- 6.8 部分通过：`/badjson` → `The remote server returned something that is not valid JSON.`；`/schema` → `The returned agent card is missing required fields...`；`/incompatible` → `This agent does not offer a JSON-RPC binding...`；`/cors` → `The remote server blocked the browser... Access-Control-Allow-Origin ...`。但不可达 URL `http://127.0.0.1:19999/network` 也被归类成同一条 CORS banner，而不是 spec 期望的 network banner，故本项保持未勾选。
- 2026-04-19 针对 `e929d7aa` 复跑：6.6 现已通过。按 `custom -> hermes` override 安装 `Nebula Hermes Contractor` 后立刻切回 Office，roster card 直接显示 `img.alt = 'Hermes'`，`img.src` 为 Hermes brand SVG 的 data URI，不再经过 DiceBear；随后 direct chat 发送 `Live verify ping after e929d7aa`，mock `http://127.0.0.1:18801/__admin/logs` 记录 `SendMessage` 命中 `/custom/rpc`。
- 2026-04-19 针对 `e929d7aa` 复跑：6.8 仍部分通过。不可达 URL `http://127.0.0.1:19999/network` 现显示 network banner：`We could not reach the agent card URL. Network error: Failed to fetch ...`，浏览器 console 同步报 `net::ERR_CONNECTION_REFUSED`；但真 CORS 路径 `http://127.0.0.1:18801/cors` 仍落到同一条 network banner。页内 `fetch()` 捕获到的异常仍是 `TypeError: Failed to fetch`，只有 console 暴露 `blocked by CORS policy`，因此当前实现无法在 JS 层稳定把该路径归到 cors banner，本项继续保持未勾选。
- 2026-04-19 针对 `beba390e` 复跑：6.8 现已通过。`http://127.0.0.1:19999/network` 显示 network banner：`We could not reach the agent card URL. Network error: Failed to fetch`，console 同步报两次 `net::ERR_CONNECTION_REFUSED`；`http://127.0.0.1:18801/cors` 显示 cors banner：`The remote server blocked the browser from reading the agent card... Access-Control-Allow-Origin ...`，console 同步报 `blocked by CORS policy`。其余分类保持正确：`/badjson` → `The remote server returned something that is not valid JSON.`；`/schema` → `The returned agent card is missing required fields. Agent card is missing required \`supportedInterfaces[]\`.`；`/incompatible` → `This agent does not offer a JSON-RPC binding — Offisim cannot dispatch tasks to it.`

## 7. 仓库卫生

- [x] 7.1 不新建自动测试 / smoke 文件；live verify 脚步写进 `openspec/changes/add-external-employee-install-entry/tasks.md`（本文件）
- [x] 7.2 Biome format + lint:fix
- [x] 7.3 Typecheck 全绿（shared-types → ui-core → core → ui-office → web 顺序）
- [x] 7.4 Commit style 跟随 repo：`feat(ui-office): external-employee install entry + agent-card discovery`（apply `2f5d012b`）
