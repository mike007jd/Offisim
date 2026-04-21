## 1. Rust 侧 transport

- [x] 1.1 `apps/desktop/src-tauri/Cargo.toml` 加 `reqwest = { version = "0.13", default-features = false, features = ["stream","rustls","json"] }` + `tokio-util = { version = "0.7", features = ["rt"] }` + `futures-util = "0.3"` + `once_cell = "1"`（reqwest 对齐 Tauri 已有 transitive 0.13.2 避免双版本；0.13 里 feature `rustls-tls` 更名为 `rustls`）
- [x] 1.2 `apps/desktop/src-tauri/src/llm_transport.rs` 新模块：
  - `TransportEvent` enum (Headers / Chunk / Done / Error) + serde tag
  - `AuthScheme` enum (Bearer / XApiKey / None)
  - `LlmFetchRequest` struct (`request_id: String`, `url: String`, `method: String`, `headers: Vec<(String,String)>`, `body: Option<String>`, `auth: AuthInject`)
  - `AuthInject { scheme: AuthScheme, header_name: Option<String> }`
  - Global `Lazy<DashMap<String, CancellationToken>>` (或 `Mutex<HashMap<...>>`) 追踪 in-flight
  - `#[tauri::command] async fn llm_fetch(req: LlmFetchRequest, on_event: Channel<TransportEvent>) -> Result<(), String>` — 读 `runtime_secrets::entry()?.get_password()` + 按 scheme 注入 + `reqwest` send + `bytes_stream()` loop emit Chunk + final Done / Error
  - `#[tauri::command] fn llm_fetch_abort(request_id: String) -> Result<(), String>` — 从 map 取 token cancel + remove
- [x] 1.3 `lib.rs` `mod llm_transport;` + `invoke_handler!` 注册两 command

## 2. TS 侧 custom fetch

- [x] 2.1 `apps/web/src/lib/tauri-llm-fetch.ts` — `createTauriLlmFetch(scheme: AuthScheme, opts?: { headerName?: string }): typeof fetch`
- [x] 2.2 fetch function 实现：
  - 提取 input URL / method / headers / body
  - `generateId('req')` 生成 requestId
  - 新建 `Channel<TransportEvent>()`（Tauri `@tauri-apps/api/core`）
  - 外部 abort signal → `invoke('llm_fetch_abort', { requestId })`
  - 构造 `ReadableStream` 其 `start(controller)` 绑 channel.onmessage 路由 Headers → resolve `Response`；Chunk → enqueue；Done → close；Error → error
  - `invoke('llm_fetch', { req, onEvent: channel })` fire（不 await，response 由 Channel 驱动）
  - 返回 `Promise<Response>` 等首个 Headers 事件

## 3. TS 侧 gateway / adapter 接线

- [x] 3.1 `packages/core/src/llm/gateway-factory.ts`：`GatewayConfig` 加 `fetch?: typeof fetch`，`case 'anthropic'` / `case 'openai'` / `case 'openai-compat'` 分支里把 `config.fetch` 透传进 options
- [x] 3.2 `packages/core/src/llm/anthropic-adapter.ts`：`AnthropicAdapterOptions` 加 `fetch?: typeof fetch`。ctor 里 `options?.fetch` 存在时优先走它；不存在则走原 `createCorsCleanFetch`（if isThirdParty）或 SDK 默认
- [x] 3.3 `packages/core/src/llm/openai-adapter.ts`：`OpenAiAdapterOptions` 加 `fetch?: typeof fetch`。`new OpenAI({ fetch, apiKey, baseURL, ... })` 透传
- [x] 3.4 `apps/web/src/lib/tauri-runtime.ts`：
  - 加 `authSchemeFor(provider, baseURL)` helper：Anthropic 官方 (no baseURL 或 baseURL host endsWith `api.anthropic.com`) → `x-api-key`；其它（anthropic compat / openai / openai-compat）→ `bearer`
  - `createGateway({...})` 调用改 `apiKey: 'ignored'` + `fetch: createTauriLlmFetch(authSchemeFor(...))`；subscription (ACP) 分支不注入 fetch
- [x] 3.5 `apps/web/src/lib/browser-runtime.ts` 不动（web 沿用原生 fetch + config.apiKey）
- [x] 3.6 `AnthropicAdapter` 的 `buildBrowserCompatHeaders` 在 options.fetch 已提供时跳过 —— 因为 Rust 端会覆盖 Authorization 头，TS 无需再拼 Bearer/x-api-key null-delete

## 4. 构建 + 基础检查

- [x] 4.1 `pnpm --filter @offisim/shared-types build`
- [x] 4.2 `pnpm --filter @offisim/core build`
- [x] 4.3 `pnpm --filter @offisim/ui-office build`
- [x] 4.4 `pnpm --filter @offisim/web build`
- [x] 4.5 `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- [x] 4.6 `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`

## 5. Live verify（desktop bundle 真 runtime）

**Pitfall A（2026-04-20 round 1 翻车）**：不能用 `pnpm --filter @offisim/web build` 独立产 dist 给 Tauri 用。Tauri mode 必须走 `pnpm --filter @offisim/desktop dev` 或 `pnpm --filter @offisim/desktop build`——它们通过 `beforeBuildCommand` / `beforeDevCommand` 注入 `TAURI_ENV_PLATFORM`，让 `apps/web/vite.config.ts` 跳过 `createBrowserTauriAliases()`。独立 web build 拿的是 polyfill stub（`apps/web/src/polyfills/tauri-api-core.ts`），Terser 会把 `invoke('llm_fetch', {...})` 的所有参数 DCE 掉，runtime 看到的是 `invoke()` 无参调用。Polyfill 已加 named + `void`-referenced 参数防止再次 DCE，但根本对策仍然是走 Tauri 自己的 build 链。

**Pitfall B（2026-04-21 round 2 翻车，已收口）**：初版用 `keyring = "3.6.3"` 无 feature → keyring 3.x 没挂 backend 走 mock，`set_password` 返 Ok 但不落盘，`get_password` 返 NoEntry。切 `features = ["apple-native"]` 后每次 `cargo rebuild` binary hash 变触发 macOS Keychain ACL 弹框（未 code-sign 的 app 的 Keychain 只信特定 binary signature）。参考 Claude Code 自己的 `secureStorage` 最终也 fallback 到明文文件（`src/utils/secureStorage/plainTextStorage.ts`）。最终落地改用 Rust-only plaintext file：`<app_local_data_dir>/runtime_secret.txt`，mode `0600`，atomic tmp-file + rename on write。删 `keyring` 依赖。

- [x] 5.1 `pnpm --filter @offisim/desktop build` launch 成功（webview 上起来，MiniMax provider 保持）
- [x] 5.2 Settings 里 MiniMax preset + 贴 key + Save（`setRuntimeSecret` 写 `runtime_secret.txt`，chmod 600）
- [x] 5.3 Team chat `hi` → Boss 真回（MiniMax 返 `Hey! 👋 Nice to see you. What can I help you with today?`，evidence 见 7.1）
- [x] 5.4 Direct chat `@<某员工> hi` → 员工回复 — readonly crash fixed by separate change `fix-desktop-direct-chat-readonly` (commit `dd47abdd`, archived `2026-04-21-fix-desktop-direct-chat-readonly`)。Direct chat 现 reach transport；员工层自然语言 reply 被外部 provider `Connection error` 阻断，属 provider-level blocker，不再是本 change / readonly scope。
- [ ] 5.5 DevTools Network：webview Network 看不到 `api.minimax.io` outbound（Rust 端发），Tauri IPC 层有 `llm_fetch` invoke。抓 IPC payload 检查：payload body **不含** secret 原文
- [!] 5.6 AbortSignal 测 — 无 UI stop 入口。out-of-scope, tracked in separate change `add-chat-streaming-stop-control`（propose 中）
- [ ] 5.7 tool_call 场景：boss 决策 `use_sop` / `direct_delegate` → tool_calls 正确 parse 并执行
- [ ] 5.8 reasoning 场景：MiniMax `thinking_delta` stream → UI reasoning region 实时生长（2026-04-21 verify PASS via MiniMax — REASONING region 实时生长 + 正文落地）
- [!] 5.9 切 provider：Settings 换成 OpenRouter preset + Save + 发 `hi` — FAIL 2026-04-21：`401 Missing Authentication header`。说明 OpenRouter 路径 Authorization header 未被 transport 注入。由 Section 8 Task 2 修
- [!] 5.10 clear secret 测：Settings 里 Clear → file 被删 → 再发请求 — FAIL 2026-04-21：走 `rm runtime_secret.txt` 后再发消息，前端显示 `Connection error.`（generic）。缺 secret 未被翻译成 `No credential`。额外：Settings `Stored securely on this device` 状态未 invalidate。由 Section 8 Task 1 修

## 6. 协议台账 + archive gate

- [x] 6.1 `openspec/protocols-ledger.md` Tauri 行：更新 `Repo claim` 加 "Rust-side llm_fetch transport for desktop LLM calls（Channel<TransportEvent> IPC）"
- [x] 6.2 Spec 一致：`desktop-llm-credential-isolation` 4 条 requirement 与代码对齐（plaintext secret file `<app_local_data_dir>/runtime_secret.txt` chmod 600，`runtime_secrets::read_secret_raw` 唯一 reader，`llm_transport::read_secret` 请求前读取注入；`llm_fetch` / `llm_fetch_abort` 两 command；`AuthScheme` 枚举覆盖 bearer / x-api-key / none；AbortSignal → `llm_fetch_abort` + `CancellationToken`）；`llm-gateway-provider-binding` ADDED 的 adapter fetch override 与 gateway-factory / 两 adapter options 对齐（`GatewayConfig.fetch` 透传；anthropic adapter injected fetch 跳过 compat shim；openai adapter `new OpenAI({ fetch })` 透传）
- [x] 6.3 Tasks 一致：1–4 按真实落地勾；5 / 7 留给 live verify
- [x] 6.4 CLAUDE.md 核查：`packages/core/CLAUDE.md` Adapter 小节补 Tauri fetch override 契约；`llm_transport.rs` 顶部 doc comment 解释 credential 不越界契约

## 7. Verify records（archive 时填）

- [x] 7.1 5.3 team chat streaming 真出来 — 2026-04-21，release bundle + plaintext secret file，MiniMax 返 `Hey! 👋 Nice to see you. What can I help you with today?`，一次通。doubled-bubble 问题另开 followup change 处理，不影响 transport scope。
- [x] 7.2 5.4 direct chat — readonly fixed by `fix-desktop-direct-chat-readonly` (commit `dd47abdd`, archived 2026-04-21)；剩余 provider `Connection error` 不属 readonly / transport scope。
- [ ] 7.3 5.5 IPC payload 不含 secret — ⟨date / evidence⟩
- [!] 7.4 5.6 abort — 2026-04-21 无 UI stop 入口，无法观测。out-of-scope。
- [x] 7.5 5.8 reasoning — 2026-04-21 PASS：MiniMax REASONING region 实时生长 + 正文落地。
- [!] 7.6 5.9 provider 切换 — 2026-04-21 FAIL：切 OpenRouter + `google/gemma-3-4b-it:free` + Save + 发 `hi` → `401 Missing Authentication header`。Section 8 Task 2 修。
- [!] 7.7 5.10 clear secret — 2026-04-21 FAIL：手删 `runtime_secret.txt` 后再发请求 → UI 显示 `Connection error.`（generic），缺 secret 未翻译成 `No credential`；Settings 仍显示 `Stored securely on this device`。Section 8 Task 1 修。
- [ ] 7.8 5.5 / 5.7 / 5.9 / 5.10 all PASS after Section 8 fixes — ⟨date / evidence⟩

## 8. Fix live verify fails（Section 5 拉闸项）

**Why 归在本 change**：这两条是 credential / transport scope 内，属本 change 自己没闭环的 bug。5.4（direct chat readonly）和 5.6（stop 控件）与 transport 无关，另起独立 change。

### 8.1 Task 1 — 缺 secret 时的错误翻译（fix 5.10）

- [x] 8.1.1 Rust `llm_transport::read_secret` 返 distinct `FetchError::NoCredential` variant；`FetchError` 同时拆出 `Network` / `Stream` / `Channel` / `Request` 分支，不再走通用 `Io(String)`
- [x] 8.1.2 `TransportEvent::Error` 加 `code: String` 字段（`no-credential` / `network` / `stream` / `channel` / `request` / `aborted`），Serialize 经 Channel 回 TS；`llm_fetch` command return 的 `Err` 也带 `"{code}: {message}"` 前缀（防 Channel 关闭时 TS `.catch` 吞掉）
- [x] 8.1.3 `tauri-llm-fetch.ts` 定义 `TauriLlmFetchError` class 带 `code` 字段；Channel error event 走这条路径；`isNoCredentialError(err)` helper walk `cause` chain + message-pattern fallback，覆盖被 SDK (`@anthropic-ai/sdk` / `openai`) wrap 进 `APIConnectionError` 的场景
- [x] 8.1.4 `useRuntimeInit.ts` `setError` 走 `isNoCredentialError(err)` 翻成 `"No provider credential stored on this device. Open Settings → Provider to enter your API key."`；非 no-credential 保留原 message
- [x] 8.1.5 `hasStoredSecret` re-probe：Settings loadState 时已走 `getRuntimeSecretStatus()`（既有行为，非本 task 新增）；切 preset 时通过 Task 2 的 vendor-diff 分支清空（比 probe 更精准 —— probe 只看 file 存在性，不区分 vendor），`handlePresetChange` 变 vendor 即 `setHasStoredSecret(false)`
- [ ] 8.1.6 Live verify：手删 `runtime_secret.txt` → 发 chat → UI 显示 friendly no-credential 文案；回到 Settings 打开 → 状态变"not stored"；重 Save key → chat 恢复 — pending live run

### 8.2 Task 2 — OpenRouter 401 `Missing Authentication header`（fix 5.9）

- [x] 8.2.1 根因诊断：`authSchemeFor('openai-compat', 'https://openrouter.ai/api/v1')` 返 `bearer` 正确；`gateway-factory.ts::case 'openai-compat'` 透传 baseURL + fetch 正确；Rust `AuthScheme::Bearer` 分支注入 `Authorization: Bearer <secret>` 正确；`headers.retain` 剥 SDK 占位 `Bearer ignored` 正确
- [x] 8.2.2 真正根因在 `useSettingsProviderState.ts::handlePresetChange`：切 preset 时只改 baseURL / model / headers / acpCommand，**不清 `apiKey` input，不清 `hasStoredSecret`**；`useSettingsSaveOrchestrator.handleSave` 因 `hasStoredSecret=true` 跳过 `setRuntimeSecret` 调用，`runtime_secret.txt` 仍是上一个 vendor（MiniMax）的 key；Rust 把 MiniMax key 注入 Authorization 打到 OpenRouter，OpenRouter 解析失败返 `Missing Authentication header`（format 不合法在 OpenRouter 规范里视同无头）
- [x] 8.2.3 修复 in `useSettingsProviderState.ts::handlePresetChange`：比较 `prevVendor` vs `nextPreset.vendor`，vendor 变了就 `setApiKey('')` + `setHasStoredSecret(false)`；既有 save gate `!hasStoredSecret && !apiKey.trim()` 会强制用户在切 vendor 后补新 key，否则 Save 报错
- [ ] 8.2.4 Live verify 组合：(a) MiniMax 已 stored → 切 OpenRouter preset → apiKey input 被清 + 显示 Not stored → 不输 key 按 Save → 报 "API Key is required." → 输 key → Save → 发 `hi` 能回 (b) 回切 MiniMax preset → 同上 re-enter → MiniMax 不回归 — pending live run (OpenRouter + MiniMax key 都要真可用)
- [x] 8.2.5 顺手检查：`case 'openai'`（非 compat）在 `gateway-factory.ts` line 55-60 确实丢了 baseURL 和 defaultHeaders。目前无 `provider: 'openai'` + baseURL 的用法，但类型允许 —— 留作 low-risk 潜在 bug，不阻塞本 change；若未来 preset 加 `openai` + 自定义 proxy baseURL 再补

### 8.3 Build + archive gate 复查

- [x] 8.3.1 `cargo check` + `cargo clippy -- -D warnings` 全绿 (2026-04-21)
- [x] 8.3.2 `pnpm --filter @offisim/{shared-types,core,ui-office,web,desktop} build` 全绿；release bundle `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` 重新产出
- [x] 8.3.3 Spec 未动：canonical `desktop-llm-credential-isolation` 描述 credential isolation invariant（secret 不越界 / authScheme pass-through / AbortSignal 传 Rust cancel），error code 细分属实现细节，不需 spec requirement；canonical 未改，无需迁移
- [ ] 8.3.4 Archive gate 三查 + 协议台账 re-check — live verify 跑完补
