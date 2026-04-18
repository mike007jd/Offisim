## Context

Phase 2b 前两条（`rewire-a2a-as-external-employee`, `add-external-employee-brand-avatars`）已经把外包员工的**底盘**铺完：DB schema 有 6 列 external 字段（migration 024），`employee-node` 按 `is_external === 1` 分派到 `runEmployeeA2A`，`BrandRegistry` 是 brand 的 SSOT，2D canvas / 3D scene / EmployeeInspector / TeamHealthCard 都按 `is_external + brand_key` 分支渲染。

**缺的是入口**：目前 `EmployeeCreatorOverlay` 只收 `{name, role, seed}`，`useInterviewWizard.submit()` 调 `repos.employees.create` 时从不填 external 字段，所以数据库里永远不会出现一条 `is_external === 1` 的行 —— 两条 landed change 在 runtime 上是死代码。这条 change 补上从 "A2A URL" 到 "employees 行" 的完整 install 链路。

**约束 / 现有契约**：

- `NewEmployee` 类型（`@offisim/install-core`）已经支持 6 个 external 字段，三个 backend（drizzle / memory / tauri）的 `employees.create` 都 honor 这些字段。无 schema 工作。
- `A2AClient.getAgentCard()` 已实现 v1.0 agent card fetch + cache。我们希望安装时**不**污染常驻 client 缓存（每次 install 是新 URL），所以需要一个 one-shot `discoverAgentCard()` helper。
- `BrandRegistry.lookupExternalBrand(brandKey)` 在 `brandKey` 未命中 canonical 时返回 `CUSTOM_BRAND`。install 流程只需要保证写进 DB 的 `brand_key` 是 `hermes | openclaw | codex | custom` 中的一个。
- Web 端 fetch `/.well-known/agent-card.json` 依赖对方服务器 CORS header（浏览器原生约束）。我们不做代理。
- Marketplace `INSTALLABLE_KINDS = ['employee']`，但**外包 A2A 不走 registry**（registry 里是 listing 驱动的内部员工 / skill 包）。两条路必须明确区分，不能让外部 A2A 混进 `useMarketplace().results`。

## Goals / Non-Goals

**Goals:**

- 用户在 Market 或 Settings 能以 3 步完成"从 URL 到活员工"的安装，整个过程可见可干预（输入 → preview → confirm）
- Agent card discovery 错误分类清晰（network / cors / invalid-json / schema / incompatible-protocol），每类都有人读文案
- brand 推断默认做对 Hermes / OpenClaw / Codex，其余走 `custom`，用户永远可以覆盖
- 和 #1、#2 落地的 dispatch / render 契约对齐：install 产物直接喂进 `employee-node` + `resolveBrand()` 不需要任何 shim
- Settings tab 提供管理面（refresh card / edit token / disconnect），不重造编辑 UX

**Non-Goals:**

- 不做 registry 化的外部 agent 目录（未来 registry 可以推"推荐 A2A 端点"，但这条 change 不铺路）
- 不做 Tauri 侧 CORS 绕过（fetch 走 Tauri HTTP plugin）—— 未来 desktop 独立点
- 不改 `EmployeeCreatorOverlay` 的内部员工流程，两条路完全平行
- 不做 streaming / extended agent card（`extendedAgentCard: true`）的二次 pull —— v1 只吃 base card
- 不做签名校验（`agentCard.signatures` JWS）—— v1 trust URL input

## Decisions

### D1: Market 入口用 pinned entry card，不扩 AssetKind

**Choice**: 在 `MarketPage` 的 Explore 网格**外层**（不是 `MarketCardGrid` 内部）渲染一张 pinned "Connect external A2A agent" 卡，Manage → Installed 顶部同样加一个 action。`INSTALLABLE_KINDS / listing schema / useMarketplace` 全部不动。

**Alternatives considered**:

- 扩 `AssetKind` 加 `'external-agent'` —— 和 registry 语义冲突（registry 是预先 curated 的 catalog，A2A 是 BYO URL），pollute 整个 asset 管道
- 只放 Settings 入口 —— Market 是用户心智里"找新员工"的地方，不放入口用户找不到
- 独立顶级 workspace —— 违反 Workspace IA 五个 peer 的边界，过重

**Why this wins**: 入口就在用户会去的地方，但语义和 registry 正交。零 asset-pipeline 影响。

### D2: Dialog 而不是 overlay / 新 OverlayKey

**Choice**: `ExternalEmployeeInstallDialog` 是 MarketPage 本地托管的 modal dialog（Radix Dialog 或 equivalent），state 在 MarketPage 或更上层 hook 里；**不**新增 `OverlayKey`。

**Alternatives considered**:

- 新加 `OverlayKey: 'external-employee-install'` —— overkill，OverlayKey 是跨 workspace 的持续态，install 只是 transient 交互
- 单独 workspace —— 同上

**Why this wins**: 和 `PublishDialog` / 现有 install confirm dialog 的做法对齐；不污染全局状态机。

### D3: Settings 加独立 tab `external`，不合并到 provider/runtime

**Choice**: `SettingsTab` union 加 `'external'`，`SettingsTabNav` + `SettingsWorkspaceSurface` 各补一处。列表直接读 `repos.employees.findByCompany(activeCompanyId).filter(e => e.is_external === 1)`。

**Alternatives considered**:

- 塞进 Runtime tab —— runtime 是 policy / model 配置，语义和"管理外部员工"不一样
- 不做 Settings 管理面，只给 Market delete —— 用户想改 token / 重拉 card 时没地方去，Market 只有 "installed" 只读列表（而且 installed 是 marketplace packages 不是 external）

**Why this wins**: Settings 语义上就是"管理已配置的东西"，外部员工是配置的一种；和 Provider / MCP 并列天然。

### D4: `discoverAgentCard()` 是新 helper 而非复用 `A2AClient`

**Choice**: 在 `packages/ui-office/src/lib/agent-card-discovery.ts` 写一个独立 `discoverAgentCard(url, token?, signal?)`，负责 fetch + schema 校验 + 错误分类。**不**复用 `A2AClient.getAgentCard()`，因为：
1. `A2AClient` 带持久 cache（`cachedCard / cachedEndpoint`），install 场景每次是新 URL，cache 会干扰
2. `A2AClient` 的错误是 `Error(message)`，没有 class/type 让 UI 区分
3. install 只需要 card，不需要 RPC 能力

Discovery helper 只依赖 `A2AAgentCard` 类型（从 `@offisim/core` 导出），逻辑上属于 ui-office 层（和 UI 文案共生）。

**Alternatives considered**:

- 扩 `A2AClient` 加 `DiscoveryResult` 错误分类 + `skipCache` 选项 —— 把 UI 层的错误分类语义塞进 core，污染 core；另外 core 依赖图里 ui-office 是下游，把 UI 语义上浮不符
- 放到 `packages/core/src/a2a/agent-card-discovery.ts` —— 同上，UI 侧的错误分类文案如果要本地化将来还得绕回 ui-office

**Why this wins**: UI 文案 / 错误分类 / 一次性语义天然是 UI 层关注点；core 的 `A2AClient` 职责保持纯净。

### D5: Brand inference 是纯前端 heuristic，不拉远程 registry

**Choice**: `inferBrandKey(card)` 用 lowercase substring 匹配 `name / provider.organization` 到 `hermes | openclaw | codex`，miss 落 `custom`。**不**查任何远程服务。

**Alternatives considered**:

- agent card 里带 `brandKey` 扩展字段 —— 不是 A2A v1.0 标准，加 extension 得协调对端
- 从 `provider.url` 解析 domain —— fragile，品牌域名不稳定
- 用户 100% 手选，不推断 —— 友好度低，3 个已知品牌天天见

**Why this wins**: 零外部依赖，零失败模式（推错了还有用户覆盖）；"已知品牌推对 + 未知走 custom" 是 `BrandRegistry` 本来的语义。

### D6: role_slug 必填，dialog 从 `ROLE_OPTIONS` 选，给 brand-defaulted 建议

**Choice**: dialog 的 step 2 必选 `role_slug`，按 brand 给默认：`hermes/codex → developer`，`openclaw → researcher`，`custom → 空（强制选）`。选项直接用 `ROLE_OPTIONS`。

**Alternatives considered**:

- 省略 role，给一个特殊 "external" role —— DB schema `role_slug NOT NULL`，且整个 zone 路由 / ceremony 都 keyed on `role_slug`。引入"无 role"会级联改动过多
- 按 agent card `skills[].tags` 自动推断 role —— skills 分类和 Offisim role 不是 1:1，推断不稳

**Why this wins**: 外包员工在 Offisim 场景里仍要进 zone / 走 ceremony，role 是场景必需；用户改 role 容易（employee inspector 已有 UI）。

### D7: 错误分类靠 fetch 异常而非协议层级

**Choice**: `discoverAgentCard` 只 classify 到 5 类（`network | cors | invalid-json | schema | incompatible-protocol`），不再细分 4xx / 5xx。实现上：
- `fetch` 成功但 `!res.ok` → `network`（带 status 附带信息）
- `fetch` throws TypeError 且 `message` 包含 `CORS` 或 `Failed to fetch` → `cors`
- `res.json()` throws → `invalid-json`
- 缺 `name / supportedInterfaces` → `schema`
- `supportedInterfaces` 全非 JSONRPC → `incompatible-protocol`

**Alternatives considered**:

- 更细的 HTTP status 分支 —— 用户只关心"能不能连"，细分没额外决策价值
- 把 incompatible-protocol 合并进 schema —— 含义差别大（前者"你的 agent 协议我们暂不支持"，后者"card 本身就不对"），合并会让修复指引模糊

**Why this wins**: 每类 class 对应一条 actionable 用户文案，不 over-engineer。

## Risks / Trade-offs

- **CORS 限制**（Web）→ 对端服务器必须返回 `Access-Color-Allow-Origin` 允许 Offisim origin；我们不做代理。Mitigation：错误文案精准指出是对端配置问题，不误导用户以为 URL 错了。Desktop 未来可以用 Tauri `http` plugin 绕过，写进 future work，不在本 change。
- **Brand 误判**（比如 agent card `name` 恰好含 "codex" 但其实不是 Codex brand）→ 用户可覆盖 + Settings 可改；brand_key 错了最多 avatar 错，不影响 dispatch
- **Agent card 过大 / 恶意 payload**（`agent_card_json` 被存 DB）→ 设 20 KB 上限，超过拒绝。Mitigation 在 discovery helper 里做大小校验
- **并发 install**（用户快速点两下 Confirm）→ dialog 按钮加 `isSubmitting` guard + ref 同步锁（和 `useInterviewWizard.submit` 相同模式）
- **role_slug 误选** → 员工进错 zone，需要用户进 inspector 改；可接受（和内部员工的手改流程一致）
- **Refresh card 覆盖 agent_card_json 时更新了 capabilities 但 brand_key 不变** → 有意，brand_key 是用户决策不是 card 决策；如果新 card 的 name 变了 brand 推断结果，用户自己在 Settings 覆盖
- **Disconnect 不级联清理 tasks / handoffs** → 和内部 delete 一样，历史事件保留，未来任务不会再派给该员工；保持一致

## Migration Plan

无 DB migration（schema 已就位 024）。功能上没有旧 data 迁移：旧部署里没有任何 `is_external === 1` 行（Phase 2b #1 之后才新加列，之前只有 internal）。
- 不需要 feature flag：新表面和旧表面正交。
- 回滚策略：`git revert` 新加文件 + 两处 tab / MarketPage 的 import，不动 DB。

## Open Questions

- Desktop 侧是否在本 change 里顺手用 `@tauri-apps/plugin-http` 绕开 CORS？**倾向于不做**：保持 web/desktop 首个版本一致；desktop 加 plugin fetch 是单独一条 change，便于 live verify 时隔离问题。
- 是否要把"推荐的 A2A 端点"做成一个可扩展静态 catalog（json 文件）pinned 在 dialog step 1？**倾向于不做**：v1 先让用户贴 URL；如果后续发现用户找不到端点可以加 "Recommended agents" 一列静态链接（零动态）。
