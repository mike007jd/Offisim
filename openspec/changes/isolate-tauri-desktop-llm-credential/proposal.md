## Why

2026-04-20 Tauri release live verify（在 `fix-boss-scope-openai-hardcode-leak` archive `62bd8d3d` 之后）证实：desktop team chat 打到 `api.minimax.io` 后，MiniMax 返回 `401 login fail: Please carry the API secret key in the 'Authorization' field`。

根因：Offisim desktop 把 `@anthropic-ai/sdk` / `openai` SDK bundle 进 renderer webview 用 `dangerouslyAllowBrowser: true` 发请求，`apps/web/src/lib/tauri-runtime.ts:135` 硬写 `apiKey: ''`。Rust 侧 `setRuntimeSecret` 写的 secret 永远到不了 Authorization 头——`runtime_secrets.rs` 只暴露 `_status` / `_set` / `_clear`，**没有 `_get`**。

两条修法：

- **捷径**：加 `runtime_secret_get`，TS 读出来填 `config.apiKey`。secret 一旦进 JS 内存 = DevTools 可见 = 违反参考项目（ClaudeSource / ClaudeRust）"credential 永不跨进程边界"的原则。Offisim 未上线，不走补丁。
- **生产路线（本 change）**：HTTP transport 搬回 Rust 侧，TS 侧 SDK 留作协议 parser。Rust 从一个 Rust-only plaintext 文件（`<app_local_data_dir>/runtime_secret.txt`，mode `0600`）读 key + 注入 Authorization + `reqwest` 发请求，流式 response 经 Tauri `Channel<TransportEvent>` 回 TS；TS 侧 SDK 通过 custom `fetch` hook（`new Anthropic({ fetch })` / `new OpenAI({ fetch })` 原生支持）接 Channel 构造标准 `Response`。Key 永不出 Rust 进程。

Storage 选 plaintext file 不用 OS Keychain 的理由：未 code-sign 的 macOS app 每次 rebuild binary hash 变都会触发 Keychain ACL 弹框；Claude Code 自己的 `secureStorage` 在所有平台都接受 plaintext 文件作为 primary 或 fallback（`claude-code-haha/src/utils/secureStorage/`）。本 change 的威胁模型是 webview 侧 prompt-injection，不是 local disk 防御——process-level file isolation 够用。

## What Changes

- **Rust**：新模块 `apps/desktop/src-tauri/src/llm_transport.rs`，暴露 `llm_fetch` + `llm_fetch_abort` 两个 command。`llm_fetch` 从 `runtime_secrets::read_secret_raw()` 拿 secret（内部读 `<app_local_data_dir>/runtime_secret.txt`）按 TS 指示的 `authScheme`（`bearer` / `x-api-key` / `none`）注入，`reqwest::Client::execute` + `response.bytes_stream()` 写 `Channel<TransportEvent>`。Cargo 加 `reqwest` + `tokio-util`；删 `keyring` 依赖
- **Rust runtime_secrets 重构**：`runtime_secret_set/_status/_clear` 改用 plaintext 文件（atomic tmp + rename, chmod 600）；`lib.rs::setup` 调 `runtime_secrets::init_storage(app.handle())` 缓存路径给非-command 调用者（`llm_transport::read_secret`）
- **TS transport**：`apps/web/src/lib/tauri-llm-fetch.ts` 新文件，`createTauriLlmFetch(scheme): typeof fetch` 返回符合 Web Fetch API 的函数，内部 `invoke('llm_fetch', ...)` + 构造 `Response(ReadableStream)` from Channel
- **TS adapter 层**：`gateway-factory.ts` `GatewayConfig` 加 `fetch?: typeof fetch` 透传；`anthropic-adapter.ts` / `openai-adapter.ts` options 新增 `fetch` 字段，ctor 时优先使用
- **TS runtime factory**：`tauri-runtime.ts` `createGateway` 调用改 `apiKey: 'ignored'` + `fetch: createTauriLlmFetch(authSchemeFor(provider, vendor))`。`browser-runtime.ts` 不动（web 沿用原生 fetch）
- **不改**：Settings UI、`runtime_secret_set/_clear/_status` 三命令、subscription (ACP) 分支、web 模式 credential 流

## Capabilities

### New Capability
- `desktop-llm-credential-isolation`: 4 条 requirement（secret 不越界 / `llm_fetch` 唯一 transport / authScheme pass-through 不传 key / AbortSignal 传到 Rust cancel）

### Modified Capability
- `llm-gateway-provider-binding`: ADDED 1 条 — adapter `fetch` override 契约（TS 侧 SDK 通过 custom fetch 可被 Rust-side transport 替换，Tauri 模式必须这么用）

## Impact

- Rust 新依赖 `reqwest` + `tokio-util`（desktop bundle 增 ~1-2 MB）
- Renderer bundle 不减不增（SDK 仍在 TS 侧 parse）
- Migration：用户需在 Settings 重 Save 一次 provider（`setRuntimeSecret` 把 key 写 `runtime_secret.txt`）；老 localStorage 里的 config 仍合法，只是 gateway 建的时候 `apiKey: 'ignored'` 不再真用 TS 侧 key
- Rollback：revert commits，`runtime_secret.txt` 不碍事（老代码完全不读它）
- Unblocks `fix-boss-scope-openai-hardcode-leak` 的 6.2 / 6.3 / 6.4 verify
- Unblocks T2.3 desktop fork/edit live verify 的 LLM 路径
