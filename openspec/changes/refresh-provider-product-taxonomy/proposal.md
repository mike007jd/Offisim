## Why

Offisim 现在的 provider 口径把用户能理解的产品名、底层协议、兼容层、auth 方式、execution lane 混在了一起，结果是设置页越来越像内部实现泄漏。用户真正想选的是 `Codex`、`OpenAI API`、`Claude`、`Anthropic API`、`Kimi`、`Qwen / Model Studio` 这类产品入口，而不是 `openai-compat`、`anthropic-compatible`、`surface=coding-plan` 这类工程字段。

## What Changes

- 引入“provider product”层，作为 Settings/UI/持久化中的主入口，使用用户可理解的产品名和账号逻辑，而不是直接暴露协议标签。
- 把当前 `provider` / `compatibility` / `surface` / `vendor` / `executionLane` 的职责拆开，明确区分：
  - 用户看到的产品入口
  - auth/access 模式（subscription/local auth、API key、OAuth 等）
  - transport / protocol profile（OpenAI native、Anthropic native、OpenAI-compatible、Anthropic-compatible）
  - execution lane（`gateway` / `claude-agent-sdk` / `openai-agents-sdk`）
- 定义一套新的产品目录，至少覆盖 `Codex`、`OpenAI API`、`Claude`、`Anthropic API`、`OpenRouter`、`Kimi`、`Qwen / Model Studio`、`MiniMax`、`GLM / Z.AI`、`Custom Compatible`。
- **BREAKING**: 废弃当前以 compat/vendor/surface 为中心的 preset 命名与持久化语义，提供迁移规则，把旧配置映射到新的 product-centric schema。
- 调整 Settings UI，使“产品选择”优先于“底层路由选择”；协议、base URL、lane 等降为高级配置或产品派生配置。
- 更新 trusted-host / desktop credential 规则，让 `Codex` / `Claude` 这类 subscription/local-auth 产品有独立的 host-gated 语义，而不是伪装成普通 API-key provider。

## Capabilities

### New Capabilities
- `provider-product-taxonomy`: 定义用户可见 provider product 目录、产品元数据、access mode、以及产品到 transport/lane 的映射规则。

### Modified Capabilities
- `llm-gateway-provider-binding`: ProviderConfig 与 runtime 绑定从原始协议标签迁移为 product-centric config + resolved transport profile。
- `desktop-llm-credential-isolation`: 本地 subscription/auth-backed 产品与 API-key 产品在桌面 trusted host 中使用不同的凭证解析与可用性规则。
- `settings-controller-boundaries`: Settings controller 与 provider UI 从旧 preset/compat 字段迁移到新的产品目录与高级选项模型。

## Impact

- Affected code:
  - `packages/ui-office/src/lib/provider-config.ts`
  - `packages/ui-office/src/components/settings/provider-presets.ts`
  - `packages/ui-office/src/components/settings/**/*`
  - `packages/shared-types/src/models.ts`
  - runtime init / trusted-host provider resolution code in `apps/web` and `apps/desktop`
- Affected persisted state:
  - saved provider config schema in local storage / Tauri persisted settings
- Affected docs/specs:
  - provider matrix
  - protocol ledger
  - settings copy
- Affected product behavior:
  - provider selection UX
  - migration of old configs
  - host-gated availability of `Codex` / `Claude` / API-key products
