## Context

参考项目 credential 处理：
- **ClaudeSource**（Node CLI）：`security find-generic-password` 读 Keychain → Node 同进程 `@anthropic-ai/sdk` clientConfig.apiKey → SDK 发 HTTP。无 renderer，key 不过任何边界
- **ClaudeRust**（Rust CLI）：env/OAuth 文件 → `AuthSource::apply()` reqwest 注入 → 全 Rust。key 不出进程

两者都不是 Tauri 多进程架构，"原生侧注入"对它们是 trivial 的。Offisim Tauri = webview renderer + Rust backend 两进程，webview 跑 SDK 发 HTTP 是 Offisim 独有的架构错配。本 change 把这模型改成对齐参考：**Rust 做 transport，TS 做协议 parsing**。

## Goals

1. Desktop secret 绝不跨 Rust→JS 边界，`runtime_secret_get` 永不引入
2. SDK streaming / tool_call / reasoning_delta / SSE parsing 复用度 100%（不在 Rust 重 implement）
3. Tauri 模式全 LLM scope（boss / manager / employee / summarization / memory / hr / pm-planner）走 custom fetch
4. AbortSignal / timeout 语义保留
5. Web mode 0 回归

## Non-Goals

- Web 模式 credential handling 不动
- 移除 `@anthropic-ai/sdk` / `openai` SDK（让 Rust 端完全做 SSE parser）—— 另立 change，本 change 不折腾
- subscription (ACP) 分支 — 走 `node:child_process`，没 HTTP
- 多 provider key 并存（目前单一 `runtime_secret.txt` 文件条目，切 provider 即覆盖；多 key store 要另立 change）

## Decisions

### D1 — Transport 层用 Tauri `Channel<TransportEvent>`，不开 localhost HTTP server

Tauri `ipc::Channel<T>` 是官方 streaming IPC 通道，不分配 port。少一个端口管理 / 冲突 / 生命周期 / 安全面问题。

**Alternatives:**
- Rust 起 `hyper` localhost server + TS `fetch('http://localhost:<port>')`：port 开销 + 额外 security surface
- `tauri-plugin-http`：不支持 header intercept middleware（2.x 文档），要 fork 或包一层

### D2 — Rust 不解析 SSE，只 pipe raw bytes

Anthropic / OpenAI / MiniMax 的 SSE event schema 各不同。Rust 层只负责：HTTP transport + auth injection + cancellation。`response.bytes_stream()` 原样经 Channel 发给 TS，TS SDK 自己 parse。

**Why**：SDK 每次 provider 协议变化（新的 reasoning event / tool_call 格式）会帮你扛；自己在 Rust 镜像一份 parser 是维护债。

### D3 — AuthScheme per-gateway，不 per-request

TS 侧 adapter 知道自己在对谁说话。Rust 端不做 URL sniffing。`createTauriLlmFetch(scheme)` 在 ctor 时定一次 scheme，整个 adapter 生命周期所有 request 都用同一 scheme。`scheme: 'bearer' | 'x-api-key' | 'none'`。`none` 保留给未来 OAuth / IAM / Bedrock sigv4。

### D4 — Request body 为 string（JSON）

SDK 现在发的 body 全是 JSON string。Rust command signature `body: Option<String>`。multipart / byte body 不在本 change scope（未来文件上传再加）。

### D5 — TransportEvent schema

```rust
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum TransportEvent {
    Headers { status: u16, headers: Vec<(String, String)> },
    Chunk { bytes: Vec<u8> },
    Done,
    Error { message: String },
}
```

TS 侧 `createTauriLlmFetch` 消费：
1. `invoke` fire + Channel `onmessage`
2. 首个 `Headers` → 构造 `Response(new ReadableStream, { status, headers })` return 给 SDK
3. 后续 `Chunk` → stream controller.enqueue(bytes)
4. `Done` → controller.close()
5. `Error` → controller.error(new Error(message))

非 2xx response 走正常 Headers + Chunk + Done 路径（SDK 自己判 status）；只有连接层失败（DNS / TCP / TLS）才发 `Error` 事件。

### D6 — Abort 反向通道：第二 command

`invoke('llm_fetch', ...)` Rust 端是一个 task。TS 侧 `signal.addEventListener('abort', () => invoke('llm_fetch_abort', { requestId }))`。Rust global `Lazy<Mutex<HashMap<RequestId, CancellationToken>>>`。Task 完成自动 remove。Abort idempotent（到 Rust 时 request 可能已完成）。

### D7 — Credential 读取路径共享 `runtime_secrets::read_secret_raw()`

`llm_transport.rs` 调 `runtime_secrets::read_secret_raw()` 读 `<app_local_data_dir>/runtime_secret.txt`。不 expose `_get` command 给 TS，只在 Rust 内部 consumer 使用。`runtime_secrets` 模块对 TS 契约不变（`_status` / `_set` / `_clear` 三命令），新增一个 crate-内部 `pub(crate) fn read_secret_raw()`。

### D8 — Storage backend 选 Rust-only plaintext file，不用 OS Keychain

**实施历史（2026-04-21 collapse）**：初版用 `keyring` crate 3.x 写 macOS Keychain，遇到两个相继暴露的 blocker：

1. `keyring = "3.6.3"` 没有 `default` feature；必须显式 `features = ["apple-native"]` 才挂 `security-framework` backend。默认走 mock，`set_password` 返 Ok 但不落盘，`get_password` 返 `NoEntry`
2. 加 `apple-native` 后，Keychain ACL 绑 binary signature；每次 `cargo build --release` binary hash 变，macOS 强制弹 "Offisim wants to use your confidential information" 要求重新 Always Allow。未 code-sign 的开发阶段这等于每次改代码都要手动过 prompt

业界参考：Claude Code 自己的 `secureStorage`（`claude-code-haha/src/utils/secureStorage/`）在所有平台都接受 plaintext 文件作为 primary 或 fallback；ClaudeRust CLI（`claw-code/rust/crates/runtime/src/oauth.rs`）直接 `~/.claw/credentials.json` 明文。

最终方案：`runtime_secret.txt` in `<app_local_data_dir>`，mode `0600`，atomic tmp + rename。威胁模型是 webview prompt-injection（credential 不跨 Rust→JS 边界），不是 local-disk 加密。删 `keyring` 依赖。

## Risks / Trade-offs

- **Channel IPC 序列化开销**：Tauri Channel 序列化 JSON + bytes base64（或 raw）。典型 streaming 每秒数千 chunks × 几 KB = 可接受。后续若 profile 发现瓶颈，切 Tauri `tauri::ipc::InvokeResponseBody::Raw` 或合并小 chunk
- **Error surface 分叉**：连接错误 / 非 2xx / 流中断三路分清（D5 约束）
- **Cancellation 竞态**：abort 到 Rust 时 request 可能已 done。handler idempotent，Missing token treat as no-op
- **Debug 面**：Rust 侧 log 生产 bundle 看不见。保留最小 `log::warn!` 关键点（authScheme 不匹配 / secret-file 读失败 / reqwest 非 network error）
- **第三方 CORS 被 Rust 吸收后 `createCorsCleanFetch` 无效化**：AnthropicAdapter 现在 strip x-stainless-* 的逻辑 Tauri 路径自动 short-circuit（options.fetch 存在就不用 createCorsCleanFetch）。Web 模式 createCorsCleanFetch 保留不动

## Migration Plan

- 无 DB / schema 变化
- 用户需在 Settings 重新 Save 一次当前 provider（走 `setRuntimeSecret` 把 key 写 `runtime_secret.txt`）。已有 `handleSave` 流程就做这件事，UI 不改
- Rollback：revert commits，`runtime_secret.txt` 留着不碍事（老代码完全不读它）；用户可以手动 `rm` 清掉

## Open Questions

- 未来 Bedrock / Vertex / Foundry：需要 sigv4 / IAM / Google Auth token refresh — 在 `authScheme` 处扩展，本 change 先把 `scheme: 'none'` 和 `headerName?` override hook 留好
- `runtime_secrets` 是否应改名或合入 `llm_transport`？短期保持分开（secret storage vs transport 是两层职责，分开更清晰）；未来统一成 `credential-vault` 模块再说
