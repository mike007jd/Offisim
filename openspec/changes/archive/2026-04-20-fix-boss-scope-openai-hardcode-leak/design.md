## Context

Tauri release bundle 2026-04-20 live verify confirm：

- direct chat 正常回应（走 ProviderConfig 的 MiniMax `AnthropicAdapter` baseURL=`api.minimax.io/anthropic`）
- team chat 稳定 401 到 `https://api.openai.com/v1/chat/completions`
- 同 bundle 同 runtime，不是 "全局 provider 失效"；是 **某条 scope 偷用了 OpenAI endpoint**

静态 trace 查到：

1. `createTauriRuntime`（`apps/web/src/lib/tauri-runtime.ts:133`）建 **单** gateway：
   ```ts
   const gateway = createGateway({
     provider: config.provider,  // 'anthropic' for MiniMax
     baseURL: config.baseURL,    // api.minimax.io/anthropic
     apiKey: '',                 // 空，由 runtime 注入 Keychain
     ...
   });
   ```
2. `modelResolver = new ModelResolver(runtimePolicy, { provider, model, ... })`（line 149）—— fallback 按 policy.default
3. `recordedLlmStream` 取 gateway：
   ```ts
   const gateway = ctx.modelRegistry?.getGateway(meta.model) ?? ctx.llmGateway;
   ```
   `ctx.modelRegistry` 在 apps/web + ui-office 里**没有任何调用方 init**（grep 确认），所以永远 undefined → fallback `ctx.llmGateway` → MiniMax

理论上**所有 scope 都该走 MiniMax**，live 结果相反。candidates：

- **C1**: `ProviderConfig` 加载的 provider 实际不是 MiniMax（localStorage 里有历史 OpenAI config 覆盖了 env fallback）
- **C2**: `modelResolver.resolve(null, 'boss')` 意外返回 OpenAI profile（policy.default 被某处覆盖成 OpenAI）
- **C3**: `createGateway` 收到 provider='openai' 的 config（上游传错）
- **C4**: boss-node / manager-node / hr-node / pm-planner-node 某处自己调了 `createGateway` 建独立 gateway 没走 `ctx.llmGateway`
- **C5**: 某 system middleware（`RecordedSystemLlmCaller` 构造方 / summarization / node-context）独立建 OpenAI gateway
- **C6**: `employee-preflight` 里员工的 `persona.modelProfile` 写死 OpenAI，direct chat 某种方式**仍然 work**（key 可用或路径差）而 boss/team 去不了

静态辨别不出 which。**必须 instrument**。

## Goals / Non-Goals

**Goals:**

- 定位 `api.openai.com` 的精确 stack origin
- 删除或纠正硬编码 OpenAI fallback
- 契约化 "LLM call must respect ProviderConfig"，防回归

**Non-Goals:**

- **不做** MiniMax-specific 硬编码（哪怕 MiniMax 是当下唯一可用 provider）
- 不切 provider（切换逻辑本身工作；是某 scope **绕开** 切换的问题）
- 不改 employee `persona.modelProfile` 数据（即使 C6 真是因，fix 也是让 employee profile 被 ProviderConfig 兜底，不是清用户数据）
- 不修 direct chat readonly（独立 bug，独立 change）

## Decisions

### D1 — Apply 分两步：先 instrumentation，再真 fix

**Chosen**: apply 先落 instrumentation-only commit，等用户 Tauri live 拿 log 回传，再同 change 内追加 second apply commit（真 fix），最后 clean-up commit 移除 instrumentation。**三 commit 一 change**。

**Alternatives considered:**

- 一次性猜 + fix：静态已到极限，无 log 猜错概率高
- 分两个 change：scope 其实同一个（LLM gateway provider binding），拆两条 archive gate 重复

**Why**: T2.3 的 `[skill-*]` instrumentation 证明这套路径有效（hotfix after 精确定位 leak）。这里同理。

### D2 — Instrumentation sites

**Chosen**: 7 处，每处 `console.debug('[provider-trace/<site>]', { ...fields })`：

1. `createTauriRuntime` gateway build site：log `{ provider, baseURL: baseURL ?? '(undefined)', model, apiKeyFp: fp(config.apiKey) }`
2. `createGateway` 入口：log `{ provider, baseURL, hasApiKey: !!config.apiKey }`
3. `OpenAiAdapter` constructor：log `{ providerLabel, baseURL: baseURL ?? '(OpenAI default)', apiKeyFp }`（定位**任意** OpenAI adapter 创建）
4. `AnthropicAdapter` constructor：同上
5. `recordedLlmStream` gateway 选择点：log `{ nodeName: meta.nodeName, metaModel: meta.model, metaProvider: meta.provider, chosenGateway: gateway.constructor.name, hasModelRegistry: !!ctx.modelRegistry }`
6. `recordedLlmCall` 同 5
7. `boss-node` 的 `modelResolver.resolve(null, 'boss')` 之后：log `{ resolvedProvider, resolvedModel }`

以 `[provider-trace/...]` 前缀统一，用户 Tauri 跑一次 team chat，DevTools Console grep `[provider-trace]` 导出即定位。

### D3 — apiKey fingerprinting

**Chosen**: `fp(key): string` = `${key.slice(0,4)}…${key.slice(-4)}`（前 4 后 4）若 key 长度 ≥ 8，否则 `'(too-short)'`；undefined → `'(none)'`。脱敏但可区分 MiniMax / OpenAI / 空 key。

**Why**: live log 看到 fp 能立刻判 "这把 key 是 MiniMax 的还是 OpenAI 的（还是空）"。完整 key 到 DevTools 不安全（虽然 DevTools 本地），脱敏 hygiene。

### D4 — Spec 契约：`llm-gateway-provider-binding`

**Chosen**: 新建 capability `llm-gateway-provider-binding`（若没有同类），3 条 requirement：

1. **Single gateway per runtime**：`RuntimeContext.llmGateway` 是唯一的 LLM gateway 实例；所有 scope 共用
2. **Gateway respects ProviderConfig**：gateway 构造时的 `provider` / `baseURL` / `apiKey` SHALL 严格从当前 `ProviderConfig` 取，不得用 adapter SDK 默认（`OpenAiAdapter` 无 baseURL 默认 OpenAI 是**禁止**的场景，当 config 指定非 OpenAI 时）
3. **No per-scope gateway rebuild**：boss/manager/hr/pm-planner/employee 节点 + 任何 system service/middleware 都 SHALL NOT 自己调 `createGateway`；一律复用 `ctx.llmGateway`

**Alternatives considered:**

- 只加 "消除 leak" 无 spec 契约：下次同类 bug 无 gate 防
- spec 加到 `runtime-provider-boundaries`（若存在）：需 audit，本次新建更快

**Why**: T1.4 archive gate 10.1 需要 spec 真实对照 code；建立这条硬契约，以后 archive 任何 change 有新加 `createGateway` callsite 会被 gate 挡。

## Risks / Trade-offs

**[instrumentation 可能误判脱敏]** → `fp()` 只看前后 4 字符，长 key 中间 padding 泄露 0 字节。接受。

**[log 输出冗长污染 DevTools]** → 每条 LLM call 2-3 条新 log；team chat 1 轮 ~5 条 LLM call (boss + manager + employee + maybe summarization)。接受一次性诊断代价。

**[真 fix 可能要改 ModelRegistry / RecordedSystemLlmCaller / per-node init 逻辑]** → scope 可能超出"一个文件改一行"。视 log 而定。

**[脱敏 key 仍可能被工具扫描认出 provider]** → sk-cp-xxxx…xxxx (MiniMax) vs sk-xxxx…xxxx (OpenAI) 前 4 字符 "sk-c" vs "sk-" 可区。这正是诊断需要的区分力。不是 secret 泄露问题。

## Migration Plan

- 无 DB migration
- 无 schema breaking
- Rollback：每一步 commit 独立可 revert；真 fix commit 独立可 revert 不破坏 instrumentation（但无价值留 instrumentation）

## Open Questions

- 是否 `modelRegistry` 应该被正式弃用（代码里存在但无 caller）？目前先忽略，本 fix scope 内不清除 dead code
