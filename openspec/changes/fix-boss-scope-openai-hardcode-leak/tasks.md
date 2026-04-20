## 1. Instrumentation (apply step 1)

- [x] 1.1 写 `fp(key): string` helper 在 `apps/web/src/lib/tauri-runtime.ts`（module-local） —— key 长度 ≥ 8 返 `${key.slice(0,4)}…${key.slice(-4)}`，否则 `'(too-short)'`，undefined/空 → `'(none)'`。
- [x] 1.2 `createTauriRuntime` gateway 建后加 `console.debug('[provider-trace/tauri-runtime-gateway]', { provider, baseURL: config.baseURL ?? '(undefined)', model: config.model, apiKeyFp: fp(config.apiKey) })`
- [x] 1.3 同样 log 加到 `apps/web/src/lib/browser-runtime.ts` 的 `createGateway` 后（以 `[provider-trace/browser-runtime-gateway]` 前缀），便于对比
- [x] 1.4 `packages/core/src/llm/gateway-factory.ts:createGateway` 入口加 `console.debug('[provider-trace/createGateway]', { provider, baseURL: config.baseURL ?? '(undefined)', hasApiKey: !!config.apiKey, apiKeyFp: fpShort(config.apiKey) })`（加本地 `fpShort` 复用 fp 逻辑）
- [x] 1.5 `packages/core/src/llm/openai-adapter.ts:OpenAiAdapter` constructor 加 `console.debug('[provider-trace/OpenAiAdapter-ctor]', { providerLabel: this.providerLabel, baseURL: options?.baseURL ?? '(OpenAI SDK default = api.openai.com)', apiKeyFp: fpShort(apiKey) })`
- [x] 1.6 `packages/core/src/llm/anthropic-adapter.ts:AnthropicAdapter` constructor 加同款 log `[provider-trace/AnthropicAdapter-ctor]`
- [x] 1.7 `packages/core/src/llm/recorded-call.ts` `recordedLlmStream` gateway 选择后加 `console.debug('[provider-trace/recordedLlmStream]', { nodeName: meta.nodeName, metaModel: meta.model, metaProvider: meta.provider, gatewayClass: gateway.constructor.name, viaRegistry: !!(ctx.modelRegistry?.getGateway(meta.model)) })`
- [x] 1.8 同 1.7 加到 `recordedLlmCall`（`[provider-trace/recordedLlmCall]`）
- [x] 1.9 `packages/core/src/agents/boss-node.ts` `resolved = modelResolver.resolve(null, 'boss')` 后加 `console.debug('[provider-trace/boss-node-resolved]', { resolvedProvider: resolved.provider, resolvedModel: resolved.model })`
- [x] 1.10 串行 build 绿：`pnpm --filter @offisim/shared-types build` → core → ui-office → web
- [x] 1.11 commit instrumentation-only，message `chore(llm): provider-trace instrumentation for boss-scope 401 diag`

## 2. Live verify 拿 log（用户侧 Tauri）

> 本 change 挂在此处等用户给 log

- [ ] 2.1 用户 `pnpm --filter @offisim/desktop build` → 启 release bundle with `OFFISIM_DESKTOP_DEVTOOLS=1`
- [ ] 2.2 用户在 DevTools Console filter `[provider-trace`，发一条 team chat（例如 `@<某员工> hi`），导出所有 `[provider-trace/*]` log 贴回
- [ ] 2.3 同时用户记下 DevTools Network 里那条打 `api.openai.com/v1/chat/completions` 的 request 的 initiator stack（点 request → Initiator tab），贴回

## 3. 真 fix（apply step 2，基于 log 定位）

> 视 log 结果展开；以下为候选动作，按真相选一或多

- [ ] 3.1 定位 bifurcation：从 log 看 `api.openai.com` 出现时是哪个 log site 先报 `OpenAiAdapter-ctor` with baseURL=`(OpenAI SDK default)`
- [ ] 3.2 [候选 A] 如果是 `createTauriRuntime` 已经建了 OpenAI gateway → 说明 ProviderConfig 加载的是 OpenAI 不是 MiniMax → 修 `loadProviderConfig` 路径（env fallback 未在 production build 注入；localStorage 有历史 OpenAI config 优先；需要 env 覆盖或清理 stale config）
- [ ] 3.3 [候选 B] 如果是 boss-node 或其它 node 独立 `createGateway` → 删除，改用 `ctx.llmGateway`
- [ ] 3.4 [候选 C] 如果是 `RecordedSystemLlmCaller` 构造处独立 `createGateway` → 同候选 B
- [ ] 3.5 [候选 D] 如果 `resolved.provider/model` 本身就是 OpenAI 但 `ctx.llmGateway` 是 MiniMax → `recordedLlmStream` 里 `ctx.modelRegistry?.getGateway(meta.model)` 实际命中某 stale registry（证伪静态 trace）→ 清掉 `modelRegistry` 半死路径
- [ ] 3.6 [候选 E] 员工 `persona.modelProfile` 硬编码 OpenAI → employee-preflight 走 employeeProfile 路径建 per-call gateway → 修成 fall back `ctx.llmGateway` 或让 `persona.modelProfile` 被 ProviderConfig override
- [ ] 3.7 真 fix commit，message 包含实际定位点

## 4. Clean-up (apply step 3)

- [ ] 4.1 移除所有 `[provider-trace/*]` `console.debug` 调用
- [ ] 4.2 保留 fp helper 若其它地方有用，否则一并删
- [ ] 4.3 如果 3.5 走了（证实 modelRegistry 半死），同步删掉 `ctx.modelRegistry` 字段 + `recordedLlmStream` 的 `?? ctx.llmGateway` 降级（保持代码自洽）
- [ ] 4.4 串行 build 绿
- [ ] 4.5 commit cleanup，message 指向真 fix commit 的 SHA

## 5. 协议台账 + archive gate

- [ ] 5.1 `openspec/protocols-ledger.md` 不触（非外部协议）
- [ ] 5.2 Spec 一致：`runtime-provider-boundaries` delta 3 条 requirement 与真 fix 对齐，archive 前核
- [ ] 5.3 Tasks 一致：1.x / 3.x / 4.x 按实际落地勾；live 2.x evidence 真跑才勾
- [ ] 5.4 CLAUDE.md 核查：`packages/core/CLAUDE.md` / `apps/web/src/lib/tauri-runtime.ts` 头部注释是否需要加 "LLM gateway 单一性契约" 一行 —— archive 前决定

## 6. Live verify（真 fix 落完用户复测）

- [ ] 6.1 Tauri rebuild 后跑 team chat（同 2.2 场景）→ DevTools Network 无 `api.openai.com` 请求
- [ ] 6.2 Direct chat 仍然正常（无回归）
- [ ] 6.3 Settings UI 切换 ProviderConfig（若可）→ 新 config 生效，team + direct 都走新 baseURL
- [ ] 6.4 如果真 fix 同时清掉 T2.3 `Attempted to assign to readonly property.`（直接的 hypothetic connection：boss 401 产生 error response → LangGraph 写 frozen state），顺便在本 change archive 注 "副产物解决" —— 但不算本 change 的必要目标

## 7. Verify records（archive 时填）

- [ ] 7.1 2.1-2.3 instrumentation log 收集 — ⟨date / evidence⟩
- [ ] 7.2 3.x 真 fix 定位点 — ⟨bifurcation site / fix diff summary⟩
- [ ] 7.3 6.1 team chat 不再打 OpenAI — ⟨date / evidence⟩
- [ ] 7.4 6.2 direct chat 无回归 — ⟨date / evidence⟩
- [ ] 7.5 6.3 Provider 切换 smoke — ⟨date / evidence⟩
- [ ] 7.6 6.4 T2.3 readonly 副产物观察 — ⟨date / evidence⟩
