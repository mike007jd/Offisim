## Context

Offisim 当前的 provider model 把太多层次塞进了同一组字段：

- 用户想选的产品入口：`Codex`、`OpenAI API`、`Claude`、`Anthropic API`、`Kimi`、`Qwen / Model Studio`
- 认证方式：本机订阅登录、API key、OAuth、trusted-host local auth
- 协议 / transport：OpenAI native、Anthropic native、OpenAI-compatible、Anthropic-compatible
- execution lane：`gateway` / `claude-agent-sdk` / `openai-agents-sdk`

这导致 preset 名称越来越偏工程内部口径，例如 `openai-compat`、`anthropic-compatible`、`surface=coding-plan`。随着 agent SDK lane、trusted host、local auth、Hermes credential pool 这些路径一起出现，原有 schema 已经不适合作为用户入口。

## Goals / Non-Goals

**Goals:**

- 让 Settings 中的 provider 选择改成 product-centric，而不是 protocol-centric
- 明确拆分“产品名”“auth/access mode”“transport profile”“execution lane”
- 为 `Codex` / `Claude` 这类 subscription/local-auth 产品建立正式位置，而不是塞进 API-key provider 模型
- 提供从旧 provider/preset schema 到新 product schema 的安全迁移
- 保持 Offisim 顶层 orchestration 不变，transport/lane 仍是叶子层

**Non-Goals:**

- 不在本 change 里承诺所有产品都立刻可用
- 不把所有高级配置完全隐藏；高级用户仍可查看 endpoint / lane / advanced routing
- 不让 vendor SDK 接管 Offisim runtime
- 不默认依赖未验证的私有 auth 路径

## Decisions

### D1. 引入 product catalog 作为用户入口 SSOT

新增一层 `ProviderProductCatalog`。每个 product 条目至少声明：

- `productId`
- `displayName`
- `family`
- `accessModes`
- `defaultTransportProfile`
- `supportedExecutionLanes`
- `hostAvailability`
- `advancedOptionsPolicy`

首批产品目录以用户可理解的品牌/入口命名，而不是协议命名，例如：

- `codex`
- `openai-api`
- `claude`
- `anthropic-api`
- `openrouter`
- `kimi`
- `qwen-model-studio`
- `minimax`
- `zai-glm`
- `custom-compatible`

**Why**

用户理解的是“我在用哪个产品、哪种账号”，不是“我现在走的是哪个 compat endpoint”。

**Alternatives considered**

- 保留旧 preset 体系，只改显示文案：不够，因为持久化和 runtime 仍然混杂
- 只暴露 vendor，不暴露 access mode：无法区分 `Codex` 和 `OpenAI API`

### D2. 持久化 product config，而不是直接持久化 raw provider config

新的持久化主结构以 product 为中心，例如：

- `productId`
- `accessMode`
- `model`
- `executionLane`
- `endpointOverride?`
- `defaultHeaders?`
- `runtimePolicy?`
- `migrationSource?`

runtime init 再把它解析成内部 `ResolvedTransportProfile`，供 gateway / trusted host / execution adapter 使用。

**Why**

产品配置是用户 stable intent；transport profile 是实现细节。把实现细节直接存进去，会让每次底层接入调整都变成用户可见 schema 漂移。

### D3. runtime 统一先解析 product，再绑定 transport/lane

runtime init SHALL 先做：

`SavedProductConfig -> ResolvedProductConfig -> ResolvedTransportProfile -> ActiveExecutionBinding`

execution adapter 层不直接理解 `codex`、`claude`、`qwen-model-studio` 这些产品名，只理解最终解析后的 provider protocol、auth strategy、base URL、lane。

**Why**

保持 runtime 的单一执行绑定模型不变，同时让 UI 和 runtime 各自看见适合自己的抽象层。

### D4. subscription/local-auth 产品显式建模，并做 host gating

`codex`、`claude` 这类产品不是 API-key provider 的别名。它们是独立 product，带有独立的 `accessMode = local-auth | subscription` 语义。

它们的可用性由 host 决定：

- `browser-limited`: 默认不可用
- `desktop-trusted`: 只有 trusted host resolver 存在且验证通过时可用
- `backend-harness`: 可单独验证，但仍不得把原始 token 暴露到 JS

**Why**

如果继续把这类产品伪装成 `openai` / `anthropic` API key provider，产品语义和安全语义都会继续打架。

**Alternatives considered**

- 完全不建模 subscription 产品：用户入口仍不清楚，且会继续出现“Codex 到底算 OpenAI 还是不是”的问题
- 在 JS 层读取本机 auth：违反现有 trusted-host threat model

### D5. 高级配置降级为 secondary surface

Settings provider tab 的主流程变成：

1. 选 product
2. 选 access mode / account mode
3. 选 model
4. 必要时再展开 advanced routing（endpoint override / headers / lane）

`compatibility`、`vendor`、`surface` 不再作为主筛选维度暴露给用户。

**Why**

这些字段对研发有意义，对用户基本没有解释力。

### D6. 旧配置迁移采用“映射优先，失败则保守降级”

迁移规则：

- 能明确映射的旧 preset / provider 记录，直接转成新 product config
- 不能明确映射但仍能保底执行的，转到 `custom-compatible`
- 已退役路径（例如 ACP/旧 subscription record）转成目标产品占位，并打 `requiresReconfigure`
- 无法安全解释的 half-record 继续返回 `null`

**Why**

要保证旧用户不会 silent fallback 到错误 provider，但也不能因为 schema 漂移直接把用户配置全抹掉。

## Risks / Trade-offs

- [Taxonomy grows too wide] 产品目录可能持续膨胀
  → Mitigation: 控制首批 curated products，其余统一落 `custom-compatible`

- [Local auth drift] `Codex` / `Claude` 的本机 auth 机制可能变化
  → Mitigation: local-auth product 必须 host-gated，resolver 必须可替换，且不可作为 web 默认路径

- [Migration ambiguity] 旧配置不一定都能一一映射
  → Mitigation: ambiguous case 明确标记 `requiresReconfigure`，不 silent guess

- [UI complexity] 虽然对用户更友好，但内部实现层反而更多
  → Mitigation: 抽象层级固定为 product -> transport profile -> execution lane，禁止继续混层

## Migration Plan

1. 先新增 product catalog、product config 类型、legacy migration resolver
2. 在 runtime 中引入 `ResolvedTransportProfile` 解析层
3. 重做 Settings provider state / save path / dirty tracking
4. 给 desktop trusted host 增加 product access-mode resolver contract
5. 更新 provider matrix / protocol ledger / canonical specs / settings 文案
6. 对旧配置执行一次迁移并记录需要用户重配的情况

## Open Questions

- `codex` 是否最终只代表“本机 Codex/ChatGPT subscription auth”，还是允许未来再挂 API-key 模式？
- `claude` 的产品命名是否需要直接显示为 `Claude Subscription` 以减少和 `Anthropic API` 的混淆？
- `Kimi` / `Qwen / Model Studio` / `MiniMax` / `Z.AI` 是否每家一个 product，还是允许“vendor family + offering”二级结构？
- trusted host 是否要直接集成 Hermes credential pool 作为可选 resolver，而不是只读各产品原生 auth 存储？
