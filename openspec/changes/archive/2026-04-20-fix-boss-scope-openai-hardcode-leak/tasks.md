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

- [x] 2.1 用户 `pnpm --filter @offisim/desktop build` → 启 release bundle with `OFFISIM_DESKTOP_DEVTOOLS=1`
- [x] 2.2 用户在 DevTools Console filter `[provider-trace`，发一条 team chat（例如 `@<某员工> hi`），导出所有 `[provider-trace/*]` log 贴回
- [x] 2.3 同时用户记下 DevTools Network 里那条打 `api.openai.com/v1/chat/completions` 的 request 的 initiator stack（点 request → Initiator tab），贴回 — 实际未点 Initiator（2.2 log 已定位到 `createTauriRuntime` 建 OpenAI gateway 层，stack 追溯无增量信息），用 `localStorage.getItem('offisim-provider-config') === {"provider":"openai","model":"gpt-4o-mini"}` 的 DevTools 取证代替

## 3. 真 fix（apply step 2，基于 log 定位）

> Bifurcation 已定位 = 候选 A。Live log + DevTools 取证结论：
> `localStorage.offisim-provider-config = {"provider":"openai","model":"gpt-4o-mini"}`
> 两字段短 config 是早期 ProviderConfig schema 残留（当前 `handleSave` 一定写 7-10 字段，无路径会再产生这种短记录）。`normalizeProviderConfig` 接受无 apiKey/baseURL 的半 config → 桌面 runtime 拿空 apiKey 打 `api.openai.com` → 401。

- [x] 3.1 定位 bifurcation：从 log 看 `api.openai.com` 出现时是哪个 log site 先报 `OpenAiAdapter-ctor` with baseURL=`(OpenAI SDK default)`
- [x] 3.2 [候选 A] 如果是 `createTauriRuntime` 已经建了 OpenAI gateway → 说明 ProviderConfig 加载的是 OpenAI 不是 MiniMax → 修 `loadProviderConfig` 路径（env fallback 未在 production build 注入；localStorage 有历史 OpenAI config 优先；需要 env 覆盖或清理 stale config）
- [~] 3.3 [候选 B] 如果是 boss-node 或其它 node 独立 `createGateway` → 不适用（log 证实所有 gateway 选择都来自 `ctx.llmGateway`，`viaRegistry: false`）
- [~] 3.4 [候选 C] 如果是 `RecordedSystemLlmCaller` 构造处独立 `createGateway` → 不适用（同 3.3）
- [~] 3.5 [候选 D] 如果 `resolved.provider/model` 本身就是 OpenAI 但 `ctx.llmGateway` 是 MiniMax → 不适用（实际 `resolved.provider='openai'` 就是 `ctx.llmGateway` 的底色，因为 ProviderConfig 本身就是 OpenAI）
- [~] 3.6 [候选 E] 员工 `persona.modelProfile` 硬编码 OpenAI → 不适用（log 证实 boss / employee / summarization 全用同一个 OpenAI gateway，不是 per-employee profile 建的）
- [x] 3.7 真 fix commit — `normalizeProviderConfig` 新增 require-apiKey-OR-baseURL 守卫，拒绝半 config。`subscription` 豁免（ACP 不需要 HTTP 凭证）。stale 记录命中 null → load 走 env fallback → 也 null → runtime 走现有 `*RuntimeReposOnly` empty-state 路径（`useRuntimeInit.ts:67-78` 无 config 分支），不再建 gateway 硬打 OpenAI。

## 4. Clean-up (apply step 3)

- [x] 4.1 移除所有 `[provider-trace/*]` `console.debug` 调用
- [x] 4.2 保留 fp helper 若其它地方有用，否则一并删 — 全删（7 处 fp/fpShort 均无其它 caller）
- [~] 4.3 如果 3.5 走了（证实 modelRegistry 半死），同步删掉 `ctx.modelRegistry` 字段 + `recordedLlmStream` 的 `?? ctx.llmGateway` 降级 — 不适用（3.5 未走，modelRegistry 在本 change scope 外）
- [x] 4.4 串行 build 绿
- [x] 4.5 commit cleanup，message 指向真 fix commit 的 SHA (`096ecc4b`)

## 5. 协议台账 + archive gate

- [x] 5.1 `openspec/protocols-ledger.md` 不触（非外部协议）
- [x] 5.2 Spec 一致：delta 从错路径 `specs/runtime-provider-boundaries/spec.md` 迁到 `specs/llm-gateway-provider-binding/spec.md`（原路径 canonical 讲 `OffisimRuntimeProvider` composition，不该污染）。新加一条 requirement "ProviderConfig load rejects unusable half-records" 反映本 fix 真 diff；原 3 条架构不变量 requirement 保留作为 capability seed。
- [x] 5.3 Tasks 一致：1.x / 3.x / 4.x / 5.x / 6.1 按实际落地勾；6.2–6.4 + 7.3–7.6 因 **follow-up change `fix-tauri-desktop-credential-injection`** blocking（desktop `createTauriRuntime` 硬写 `apiKey: ''`，Rust 端缺 `runtime_secret_get` 命令，Keychain key 永远进不了 Authorization 头 → MiniMax 401）标为 blocked，不勾
- [x] 5.4 CLAUDE.md 核查：不加 —— 本 fix 的契约已落 spec；`packages/core/CLAUDE.md` / `tauri-runtime.ts` 头注释无需重复。Desktop credential 注入契约落在 follow-up change 的 spec

## 6. Live verify（真 fix 落完用户复测）

> **前置**：开发机 stale localStorage 需清一次（正常用户装新机不需要这步，只是当前开发机刚好命中）。DevTools Console：
> ```js
> localStorage.removeItem('offisim-provider-config');
> ```
> 或在 Tauri WebKit localstorage.sqlite3 路径下直接删行。清完 Settings UI 重配一条 provider 再测。

- [x] 6.1 Tauri rebuild 后跑 team chat（同 2.2 场景）→ DevTools Network 无 `api.openai.com` 请求 — **PASS**（2026-04-20 Tauri release live：顶栏 `MiniMax-M2.7-highspeed`，状态栏 `Boss is calling MiniMax-M2.7-highspeed`，Network 外部域名 = `api.minimax.io`，`api.openai.com` 命中 0）
- [~] 6.2 Direct chat 仍然正常（无回归） — **BLOCKED by `fix-tauri-desktop-credential-injection`**（desktop `createTauriRuntime` `apiKey: ''` 硬写 + Rust 缺 `runtime_secret_get`，Keychain key 进不了 Authorization 头，MiniMax 返 `login fail: Please carry the API secret key in the 'Authorization' field` 401；非本 change scope，follow-up 修）
- [~] 6.3 Settings UI 切换 ProviderConfig（若可）→ 新 config 生效，team + direct 都走新 baseURL — **BLOCKED**（同 6.2 根因，Settings 切到 MiniMax 后 baseURL 确实已切 `api.minimax.io`，但 Authorization 注入链未修通）
- [~] 6.4 T2.3 `Attempted to assign to readonly property.` 副产物观察 — **BLOCKED**（6.2 没跑通之前观察不到；T2.3 独立 bug，本 change 不承担）

## 7. Verify records

- [x] 7.1 2.x instrumentation log 收集 — 2026-04-20 Tauri release bundle + DevTools Console `[provider-trace/*]` 导出 + DevTools `localStorage.getItem('offisim-provider-config')` = `{"provider":"openai","model":"gpt-4o-mini"}`。Tauri WebKit localstorage.sqlite3 复核一致。
- [x] 7.2 3.x 真 fix 定位点 — bifurcation = `loadProviderConfig()` 读到 stale 半 config → `normalizeProviderConfig` 误放行（仅校验 provider/model 合法，不校验 apiKey/baseURL）→ `createTauriRuntime` 拿到 `{provider:'openai',model:'gpt-4o-mini'}` 喂 `createGateway` → `OpenAiAdapter` 无 baseURL 走 SDK 默认 `api.openai.com` + 空 apiKey → 401。真 fix diff = `provider-config.ts` `normalizeProviderConfig` 新增 require-apiKey-OR-baseURL 守卫（commit `096ecc4b`）。
- [x] 7.3 6.1 team chat 不再打 OpenAI — 2026-04-20 Tauri release live：Network 面板 `api.openai.com` 命中 0，外部请求 = `api.minimax.io`
- [~] 7.4 6.2 direct chat 无回归 — BLOCKED by `fix-tauri-desktop-credential-injection`
- [~] 7.5 6.3 Provider 切换 smoke — BLOCKED（同 7.4）
- [~] 7.6 6.4 T2.3 readonly 副产物观察 — BLOCKED（同 7.4）
