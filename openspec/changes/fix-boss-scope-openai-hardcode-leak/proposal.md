## Why

2026-04-20 Tauri release live verify（在 `fix-tauri-checkpoint-serial-writer` + `fix-tauri-desktop-missing-migrations` 两条 hotfix 之后）仍报告：**direct chat 能正常回应 LLM，team chat 则稳定 401 到 `https://api.openai.com/v1/chat/completions`**。用户的 ProviderConfig 是 MiniMax（无论经 `.env.local` → `VITE_MINIMAX_*` 注入还是 Settings UI 手填），两条路径共用同一 bundle、同一 runtime init、同一 `ctx.llmGateway`。代码静态 trace：

- `createTauriRuntime` 只建**一个** gateway，按 `config.provider` 走（MiniMax → `AnthropicAdapter` + baseURL=`api.minimax.io/anthropic`）
- `modelRegistry` 在 apps/web + ui-office 层从未被 init（`ctx.modelRegistry=undefined`），`recordedLlmStream` 的 `ctx.modelRegistry?.getGateway(model) ?? ctx.llmGateway` 永远 fallback 到单一 `llmGateway`
- `modelResolver.resolve(null, 'boss')` 的 fallthrough 返 `policy.default`，policy.default 应该就是 ProviderConfig 的 provider/model（MiniMax）

按纸面 trace，**所有 chat scope 都该走 MiniMax gateway**。live 报出现 `api.openai.com` 意味着某条代码路径**绕开了 `ctx.llmGateway`** 或**在某个节点运行时重新建了一个 OpenAI gateway**。静态 trace 已到极限——必须上 live instrumentation 才能定位精确 leak 点。

**Bug 本质（不是 feature）**：任何 ProviderConfig（MiniMax / 未来切其它 provider）都应该被**所有**chat scope 无条件尊重。代码里存在一条硬编码 `new OpenAiAdapter(...)` 或忽视 config 的 fallback 路径——定位它、切除它。**与 MiniMax 本身无关**，MiniMax 只是用户此刻能给的测试 provider。

## What Changes

- **第一步 apply（诊断）**：在 `createTauriRuntime` / `createBrowserRuntime` / `createGateway` / `OpenAiAdapter` 构造 / `recordedLlmStream` / `recordedLlmCall` / `boss-node` 关键分叉点加 stack-marker `console.debug`，打印 `provider` / `baseURL` / `model` / gateway class name / apiKey fingerprint（前 4 后 4 脱敏）。一次 Tauri 跑 team chat 就能看清楚 `api.openai.com` 是哪个 stack 造出来的
- **第二步 apply（真 fix）**：基于 instrumentation log 定位 leak 点，删除硬编码 fallback 或让它显式尊重 ProviderConfig。可能形态（取决于 log）：
  - 某 adapter 构造时没传 `baseURL` 导致用 OpenAI SDK 默认
  - 某 system service（`RecordedSystemLlmCaller` 或 middleware）自己调 `createGateway` 用错 provider
  - 某 role-specific fallback（`hr-node` / `pm-planner-node` / boss 重建 gateway）
  - `ModelResolver` 构造时 fallback 参数错位
- **第三步（清理）**：真 fix 落地后移除 instrumentation log（保留 `[tauri-checkpoint/*]` 模式的轻量错误路径 log）

## Capabilities

### New Capabilities
无（纯 bug fix，无新行为）

### Modified Capabilities
- `runtime-provider-boundaries`: ADDED 3 条 requirement — (1) single gateway per runtime (2) gateway must respect ProviderConfig, no SDK default fallback (3) no per-scope gateway rebuild。防未来再出同类 leak

## Impact

- **Instrumentation 阶段**：~10 处 `console.debug` 带 `[provider-trace/<site>]` 前缀，一次 live verify 后移除。临时不影响 bundle size / 运行时开销
- **真 fix 阶段**：视 log 结果定 diff 点（单文件 / 多文件不确定）
- **openspec/specs/**：若新建 `llm-gateway-provider-binding` spec，archive 时一并落地规定 "LLM call 必须尊重 ProviderConfig" 的契约，防回归
- **不影响**：任何 provider 的 feature（MiniMax 本身 / Anthropic / OpenAI / subscription ACP）、T2.3 skill 代码、checkpoint writer、migrations
- **Unblocks**：T2.3 fork/edit 9.x live verify 的**一半前置**（另一半是 `Attempted to assign to readonly property.` direct chat readonly bug，那是独立 change）
- **与 T2.3 无关**：T2.3 是 skill pillar 功能；本 fix 是 LLM gateway 路由 bug。两条独立。本 fix 先走，团队 chat 401 清掉后，后续 direct chat readonly 诊断的 LLM 路径才干净
