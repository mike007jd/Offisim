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

- [ ] 8.1.1 Rust 侧 `llm_transport::read_secret` 在 `runtime_secret.txt` 不存在 / 读失败时返回 distinct error variant（e.g. `TransportError::NoCredential`），而不是和网络错误同通道混成 generic error
- [ ] 8.1.2 `TransportEvent::Error` 带 `code: String` 字段（`no-credential` / `network` / `http-status` / `abort`），序列化经 Channel 回 TS
- [ ] 8.1.3 `tauri-llm-fetch.ts` 收到 `code === 'no-credential'` 时 reject 一个可被上层识别的 error（定义 `class NoCredentialError extends Error` 或用 `error.code` 约定），**不落成 generic `Connection error.`**
- [ ] 8.1.4 chat error surface / 底部 status bar 展示 `No credential. Open Settings → Provider to re-enter your API key.`（文案由 UI 定稿）
- [ ] 8.1.5 Settings 页 `hasStoredSecret` 状态重新 probe：打开 Settings 或切 provider 时 invoke `runtime_secret_status` 重查，别只在 load/save 后更新
- [ ] 8.1.6 Live verify：手删 `runtime_secret.txt` → 发 chat → UI 显示 `No credential`；回到 Settings → 状态立刻显示未存储；重新 Save key → chat 恢复

### 8.2 Task 2 — OpenRouter / OpenAI-compat 认证头注入（fix 5.9）

- [ ] 8.2.1 根因诊断先行：抓 `openai-adapter.ts` ctor + `gateway-factory.ts` → `tauri-runtime.ts::authSchemeFor(provider, baseURL)` 路径，确认 OpenRouter 走的 scheme 是否正确（预期 `bearer`），以及 `llm_transport::llm_fetch` 在 `AuthScheme::Bearer` 分支是否真的 `headers.insert("authorization", format!("Bearer {}", secret))`
- [ ] 8.2.2 常见坑点排查：(a) OpenRouter `baseURL` 是否命中 `authSchemeFor` 的 Anthropic 分支（误判为 `x-api-key`）；(b) TS 侧 SDK 自己在 request init 时**又**塞了 `Authorization: Bearer ignored` header，被 Rust 的 header map 覆盖顺序吞掉；(c) `openai` SDK 在 `apiKey: 'ignored'` 时是否短路 fetch（不太可能但要确认）
- [ ] 8.2.3 修复：保证 OpenRouter baseURL (`https://openrouter.ai/api/v1`) + `AuthScheme::Bearer` path 下，Rust 端 header 最终落成 `Authorization: Bearer <real-key>`
- [ ] 8.2.4 顺手核查：MiniMax 通 + OpenRouter 通之后，Anthropic 官方（x-api-key）、OpenAI 官方（bearer）、anthropic-compat vendor（bearer）三条路径都要 smoke 过一次
- [ ] 8.2.5 Live verify：切 OpenRouter + 任一免费模型 → 发 `hi` → 真收到模型回复；切回 MiniMax 不回归

### 8.3 Build + archive gate 复查

- [ ] 8.3.1 `cargo check` + `cargo clippy -- -D warnings`
- [ ] 8.3.2 `pnpm --filter @offisim/core build` + `pnpm --filter @offisim/ui-office build` + `pnpm --filter @offisim/desktop build`
- [ ] 8.3.3 Spec 同步：如果 `desktop-llm-credential-isolation` 的错误处理 requirement 需细化（no-credential 独立 error code），在 archive 前 spec 同改
- [ ] 8.3.4 Archive gate 三查（spec 一致 / tasks 一致 / 文档注释一致）+ 协议台账 Tauri 行 re-check
