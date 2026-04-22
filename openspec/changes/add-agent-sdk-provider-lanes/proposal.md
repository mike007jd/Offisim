## Why

ACP 已经不再是 Offisim 可持续的接入面。2026-04-22 本机 `claude 2.1.116` 已无 `claude acp` 子命令，而 Anthropic 当前官方主路径已经转向 Claude Agent SDK + API key / gateway 认证；同时我们也需要把中国厂商常见的 Anthropic-compatible / OpenAI-compatible 接入方式收敛成一个可维护的 provider 模式矩阵，而不是继续堆临时分支。

## What Changes

- 在 `subscription` / ACP 退役后的基础上，正式引入“execution lane”概念：`gateway`、`claude-agent-sdk`、`openai-agents-sdk`
- 保留 Offisim 顶层自研 LangGraph / harness 编排；vendor SDK 只作为底层模型执行 lane，不接管顶层 workflow
- 新增 provider/preset 级别的“接入模式矩阵”，明确每个 provider 允许哪些 lane，而不是仅凭 `anthropic-compatible` / `openai-compatible` 推断
- 第一优先级落 `claude-agent-sdk` lane，面向 Anthropic native 和经过官方文档验证的 Anthropic-compatible coding providers
- 第二优先级落 `openai-agents-sdk` lane，先支持 OpenAI native，再逐家验证第三方 provider，禁止默认全开
- 把后端式 harness 验证升级成正式能力：不经过游戏前端，直接做 smoke/load/edge/boundary/provider-matrix 验证

## Capabilities

### New Capabilities
- `agent-sdk-provider-lanes`: 定义 provider execution lane、trusted-runtime gating、preset 支持矩阵，以及 LangGraph 顶层编排与 vendor SDK lane 的边界
- `backend-harness-verification`: 定义不经过前端的后端式 harness smoke/load/edge/provider-matrix 验证能力

### Modified Capabilities
- `llm-gateway-provider-binding`: 从“一个 runtime 绑定一个 LlmGateway”扩展为“一个 runtime 绑定一个 active execution lane”，并规定 lane 切换与 reinit 语义

## Impact

- Affected code: `packages/core/src/llm/*`、runtime factory、settings provider config / preset / UI、harness scripts、canonical OpenSpec specs
- New dependencies: `@anthropic-ai/claude-agent-sdk`、`@openai/agents`（或同等官方包）
- Product surface: Settings 需要从“选 provider”升级为“选 provider + 选接入模式 + 选 endpoint/baseURL”
- Validation surface: harness 需要覆盖 provider × lane × execution-mode 矩阵，而不是只测单一 gateway happy-path
