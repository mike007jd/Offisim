## Why

GPT 5.5 Pro 的源码审计指出的高危边界在当前 repo 中基本成立：provider secret 目的地仍可被 webview 请求影响，trusted sidecar 的 cwd/baseURL 还没绑定到项目和 Rust-side provider profile，marketplace 发布链路缺 creator ownership、canonical manifest 与 artifact integrity 可信链。

这不是业务功能缺失，而是 1.0 发布候选的安全边界没有闭合。当前架构方向可以继续，但 production-ready 口径必须先把本机执行、provider secret、marketplace 发布、平台 auth/migration/release gate 这些边界写进 OpenSpec 并按 gate 执行。

## What Changes

- **Block release on provider-scoped transport.** `llm_fetch` 不再是“前端给任意 URL + Rust 注入 secret”的通用代理；Tauri gateway 请求必须绑定 Rust-side provider profile / endpoint kind / host allowlist，并禁止 credential 跨 host redirect。
- **Bind trusted sidecars to project/workspace/provider profile.** Claude/Codex trusted-host commands 不再接受任意 cwd；Claude baseURL 不再由前端透传，必须由 Rust-side provider profile 决定。
- **Unify local file/path/git/deliverable execution behind project workspace gateway.** `open_local_path`、`save_deliverable_to_local`、`git_exec` 必须改为 project-scoped API，复用 workspace containment、审计和用户 approval 语义。
- **Harden shell and MCP as high-risk local execution lanes.** `bash_execute`、MCP stdio 注册/启动都要按本机进程能力处理：项目绑定、显式 approval、最小环境、审计记录、secret redaction。
- **Block release on marketplace ownership.** draft create/update/submit/moderation 必须校验 listing ownership；cross-creator listing takeover 属于 Gate A / P0，不得降级为后续 hardening。
- **Harden marketplace publish integrity.** 发布校验必须复用 `@offisim/asset-schema` canonical validator；artifact sha256/size 必须进入平台可信链；external artifact fetch 必须有 SSRF 防护；DB 约束补齐去重语义。
- **Make desktop install materialization atomic.** Tauri desktop install path 不能用 async sequential fallback 作为最终安装提交路径，必须有 Rust-side transaction 或 async transaction contract。
- **Separate platform public API from local runtime bridge.** root-level local runtime routes 要么和 public platform app 分离，要么有 local-only/auth guard；API token scopes 要真实执行。
- **Clarify migration and release-gate policy.** 平台 Postgres 必须有正式 migration/runbook；desktop fresh 1.0 可以继续 single baseline，但任何 post-release persistence 变更必须有 migration/rollback 计划。README 验证口径要承认 deterministic harness + targeted Rust safety tests 是 release gates。
- **Keep future provenance out of this scope.** Signed artifact provenance / publisher attestation 是后续 broad third-party marketplace hardening，不进入本 change 的 Gate A。

## Capabilities

### New Capabilities

- `marketplace-publish-integrity`: marketplace publish / moderation / artifact / DB uniqueness 的生产发布可信链。
- `install-materialization-atomicity`: desktop install materialization 的事务性、失败补偿和 partial-row 防护。
- `desktop-mcp-stdio-permissioning`: MCP stdio 注册、启动、tool call 的本机进程权限、安装来源和审计边界。
- `platform-api-auth-boundaries`: platform public routes、local runtime bridge routes、API token scopes 和 local-only guards 的授权边界。

### Modified Capabilities

- `desktop-llm-credential-isolation`: secret 不仅不能跨 Rust→JS，也不能被 Rust 作为任意 URL credential proxy 发往攻击者 host；trusted sidecars 必须 project/provider scoped。
- `llm-gateway-provider-binding`: provider config resolution 必须产出 Rust 可验证的 provider profile、endpoint kind、scheme/host/network policy；前端不得传任意 auth header name 或最终 credential 目的地。
- `project-workspace-binding`: 所有本地 path/git/deliverable command 必须绑定 project/workspace_root，复用同一 containment helper；shell 默认按高危能力审批和审计。
- `runtime-live-verification-gates`: production release gate 必须包含安全阻断项、canonical manifest/artifact checks、platform migration checks、desktop release `.app` verification，以及 README/Runbook 验证口径一致性。

## Impact

- **Desktop/Tauri**: `llm_transport.rs`, `claude_agent_host.rs`, `codex_agent_host.rs`, `builtin_tools.rs`, `local_paths.rs`, `git.rs`, `mcp_bridge/*`, Tauri permissions/capabilities, release `.app` verification.
- **Web/UI runtime**: `tauri-llm-fetch.ts`, `tauri-engine-adapters.ts`, `tauri-runtime.ts`, provider config persistence/resolution, desktop local path helpers, marketplace publish/install UI surfaces where needed.
- **Platform**: `routes/publish.ts`, `services/moderation.ts`, `services/validation.ts`, `routes/install.ts`, `routes/{resume,sessions,kanban}.ts`, `middleware/auth.ts`, `db-platform` schema/migrations/runbook.
- **Packages**: `@offisim/asset-schema`, `install-core`, registry client types, db-local/db-platform schemas, deterministic harness scenarios and Rust safety tests.
- **Docs/gates**: README validation policy, `SECURITY.md`, release runbook, provider lane matrix, OpenSpec tasks/archive gates.
