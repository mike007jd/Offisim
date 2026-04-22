## Why

Offisim 现在的 provider 口径把用户能理解的产品名、底层协议、兼容层、auth 方式、execution lane 混在了一起，结果是设置页越来越像内部实现泄漏。用户真正想选的是 `Codex`、`OpenAI API`、`Claude`、`Anthropic API`、`Kimi`、`Qwen / Model Studio` 这类产品入口，而不是 `openai-compat`、`anthropic-compatible`、`surface=coding-plan` 这类工程字段。

与此同时，`add-provider-source-registry` 已经把 provider/model 元数据上游治理收口成 repo-owned 的 reviewed catalog：官方 fixture、LiteLLM 等社区聚合源、以及 Offisim curated override 都先进入 `catalog/provider-source-registry/generated/`。因此这个 change 不应再自己维护第二套 provider facts；它应该消费 source-registry 的 curated output，把这些底层 provider variants 重新组织成用户可理解的 product layer，并补上 `codex` / `claude` 这类 host-gated、本地 auth 产品。

## What Changes

- 引入“provider product”层，作为 Settings/UI/持久化中的主入口，使用用户可理解的产品名和账号逻辑，而不是直接暴露协议标签。
- 把当前 `provider` / `compatibility` / `surface` / `vendor` / `executionLane` 的职责拆开，明确区分：
  - 用户看到的产品入口
  - auth/access 模式（subscription/local auth、API key、OAuth 等）
  - source-registry 提供的 provider variant / transport profile
  - execution lane（`gateway` / `claude-agent-sdk` / `openai-agents-sdk`）
- 定义一套新的产品目录：API/compat 产品默认消费 reviewed curated catalog，而不是在 Settings 侧重复硬编码 provider facts；首批产品至少覆盖 `Codex`、`OpenAI API`、`Claude`、`Anthropic API`、`OpenRouter`、`Kimi`、`Qwen / Model Studio`、`MiniMax`、`GLM / Z.AI`、`Custom Compatible`。
- 为 `codex` / `claude` 这类不属于公开 API provider variant 的 host-gated 产品补充 repo-owned product metadata，与 source-registry 的 API/compat provider variants 一起组成完整 product layer。
- **BREAKING**: 废弃当前以 compat/vendor/surface 为中心的 preset 命名与持久化语义，提供迁移规则，把旧配置映射到新的 product-centric schema。
- 调整 Settings UI，使“产品选择”优先于“底层路由选择”；协议、base URL、lane 等降为高级配置或产品派生配置。
- 更新 trusted-host / desktop credential 规则，让 `Codex` / `Claude` 这类 subscription/local-auth 产品有独立的 host-gated 语义，而不是伪装成普通 API-key provider。

## Capabilities

### New Capabilities
- `provider-product-taxonomy`: 定义用户可见 provider product 目录、产品元数据、access mode、以及产品到 provider variant / transport / lane 的映射规则。

### Modified Capabilities
- `provider-source-registry`: curated merged catalog 作为 product taxonomy 的上游输入，不再让 Settings/preset 体系各自维护重复的 provider facts。
- `llm-gateway-provider-binding`: ProviderConfig 与 runtime 绑定从原始协议标签迁移为 product-centric config + resolved provider variant + resolved transport profile。
- `desktop-llm-credential-isolation`: 本地 subscription/auth-backed 产品与 API-key 产品在桌面 trusted host 中使用不同的凭证解析与可用性规则。
- `settings-controller-boundaries`: Settings controller 与 provider UI 从旧 preset/compat 字段迁移到新的产品目录与高级选项模型。

## Impact

- Affected code:
  - `packages/ui-office/src/lib/provider-config.ts`
  - `packages/ui-office/src/components/settings/provider-presets.ts` 或其替代产品目录实现
  - `packages/ui-office/src/components/settings/**/*`
  - `packages/shared-types/src/models.ts`
  - `catalog/provider-source-registry/generated/*`
  - runtime init / trusted-host provider resolution code in `apps/web` and `apps/desktop`
- Affected persisted state:
  - saved provider config schema in local storage / Tauri persisted settings
- Affected docs/specs:
  - provider matrix
  - protocol ledger
  - settings copy
  - product taxonomy spec and source-registry integration rules
- Affected product behavior:
  - provider selection UX
  - migration of old configs
  - host-gated availability of `Codex` / `Claude` / API-key products
