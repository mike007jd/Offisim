## Context

当前 Offisim 已经有正确的业务分层：desktop 本地 runtime 是执行面，platform 是 marketplace/backend 分发面，SDK lanes 在 1.0 口径下只允许文本/推理，真实本机文件/命令/tool 要走 gateway。问题在于几个高危边界还没有硬化到 production-ready：

- `llm_fetch` / OpenAI Agents SDK transport override 仍接收前端构造的最终 URL，再由 Rust 注入本机 provider secret。
- Claude/Codex trusted sidecar 仍允许 request 影响 cwd；Claude 还允许 request 影响 `ANTHROPIC_BASE_URL`。
- Marketplace publish 可以把 draft 绑定到非本人 listing，manifest/artifact 校验也没有统一到 canonical schema/hash 可信链。
- 本地 path/git/deliverable/MCP/shell 能力还没有完全收敛到 project workspace + approval + audit。
- 平台 local runtime bridge routes、API token scopes、Postgres migrations、README 验证口径都还没有和发布候选的真实 gate 对齐。

这次 change 是 release hardening，不是 UI polish，也不是 marketplace 新功能扩张。

## Goals / Non-Goals

**Goals:**

- 把 production release 必须阻断的 P0/P1 安全边界变成可执行、可验收、可归档的 OpenSpec contract。
- 将修复顺序分成 Gate A（泄密/越权/本地执行边界，其中包含 marketplace listing ownership）和 Gate B（marketplace 可信链/平台发布硬化），避免“全都重要”导致执行失焦。
- 明确 fresh desktop 1.0 与 post-release migration 的边界：fresh baseline 可以保留，但平台生产与未来用户升级必须有 migration/runbook。
- 保留现有 local-first 架构，不把真实执行面迁到 platform。

**Non-Goals:**

- 不新增 marketplace 资产类型或安装能力。
- 不把 SDK lanes 升级成 Offisim tool lanes。
- 不要求本轮实现完整 OS sandbox；但 shell/MCP 的 approval/audit/env scrub/network policy 必须先落地，OS sandbox 作为明确后续 hard gate。
- 不把 desktop fresh baseline 改成复杂 migration 链，除非这次代码实现实际引入 post-release persistence 变更。
- 不在本 change 引入 SLSA/Sigstore 级签名 provenance；sha256/size/ownership 是 1.0 最低可信链，签名与 publisher identity attestation 是未来 marketplace 扩张前的 hardening。

## Decisions

### D1. `llm_fetch` 改为 provider-scoped transport，而不是通用 fetch proxy

前端只允许提交 `providerProfileId`、`endpointKind`、`requestId`、body 和少量非 credential header。Rust 侧从 provider profile 解析 baseURL/host/auth scheme，并校验 endpoint kind 对应的 path/network policy。这样 secret 的“目的地”由 Rust 决定，而不是由 webview 的 URL 字符串决定。

替代方案是保留 `url` 参数并加 URL allowlist。这个做法短期改动小，但仍让 JS 持有最终请求目的地，后续 SDK adapter 或恶意资产影响 `baseURL` 时风险更难审计。

### D2. Trusted sidecar 用 project/workspace/provider profile 作为唯一执行上下文

Claude/Codex command 接收 `projectId` / `workspaceId`，Rust 侧解析 canonical workspace root 后设置 cwd。Claude baseURL 从 provider profile 来，不再从 request 透传。这样 sidecar 能继续作为 trusted host，但 trust boundary 不再扩大到任意前端参数。

### D3. 本地路径、git、deliverable、shell、MCP 都按 local execution capability 管

`open_local_path`、`save_deliverable_to_local`、`git_exec` 和 shell/MCP stdio 的共同点不是“UI helper”，而是能触达本机系统。因此统一要求 project/workspace containment、approval、audit、secret redaction。文件树浏览仍走已有 `project_list_dir` / `project_read_file_preview`，不回退到 plugin-fs 直接读项目目录。

### D4. Marketplace publish 以 creator ownership + canonical manifest + artifact integrity 为可信链

发布安全不能只靠 auth middleware。draft 带 `listing_id` 时必须校验 listing 属于当前 creator；moderation 更新 listing 时也必须带 `creator_id` 条件。这一条是 Gate A / P0。manifest 校验必须复用 `@offisim/asset-schema`。artifact 要把 publisher claimed sha、manifest integrity sha、platform computed sha 三者对齐，再写进 `package_versions`。

如果 1.0 支持 publisher-provided `external_url`，平台 fetch artifact bytes 时必须按 SSRF 入口处理：禁用自动 redirect 或逐跳重验，校验 scheme/host/port/path 与 DNS A/AAAA 解析结果，拒绝 loopback、link-local、private、multicast、unspecified、metadata 和非 global IP，设置 timeout/max content length/streaming byte cap，并边流式读取边计算 sha256。更保守的 1.0 选择是只支持 registry object upload，不开放 arbitrary external_url。

### D4.1. Shell network policy 不能在无 OS sandbox 时声称 enforce deny

本轮可以做到 shell network access 的显式 approval、audit flag、命令披露和后续 evidence；但只用普通 `bash -c` 不能可靠阻止网络访问。因此规格必须区分“policy-gated/disclosed”与“OS-level enforced deny”。若产品声明网络 deny，必须使用 seatbelt/bubblewrap/Windows Job Object/firewall/proxy 等机制，并用 `curl`/`wget` 失败类命令验证。

### D5. Platform local bridge routes 与 public routes 分清

`resume` / `sessions` / `kanban` 这类 local runtime bridge route 如果继续挂在同一个 Hono app 下，必须有 local-only token / loopback origin / authenticated user guard。长期更好的形态是 public marketplace app 与 local runtime bridge app 分离。

### D6. Install materialization 必须由事务提交

Tauri path 当前没有 `transact`，所以 install-core fallback sequential writes 只能作为 browser/memory fallback，不能作为 desktop reference install 的最终 materialization 路径。优先方案是 Rust-side `install_materialize_transaction` command 在同一 SQLite connection 内提交；次选是给 sqlite-proxy 增加 async transaction contract。

### D7. 验证口径必须承认 deterministic harness，不再说“没有自动化验证”

Offisim 不是恢复宽泛 unit test 套件，但 deterministic harness、targeted Rust safety tests、release `.app` Computer Use 验收都是 release gate。README / RUNBOOK / tasks 需要对齐这句话，避免外部技术方误解为“只有手测”。

## Risks / Trade-offs

- **SDK adapter 改 transport shape 可能影响多个 provider lane** → 先做 provider profile resolver + compatibility adapter，保留 web mode direct fetch 不变，只收紧 Tauri mode。
- **Project-scoped sidecar 可能打破无项目全局聊天** → 没有 workspace 的本机文件/命令/sidecar任务应 fail fast；纯文本聊天可继续走无 tool lane。
- **Artifact 平台计算 hash 需要可下载 artifact bytes** → 首选 registry object upload；若允许 external_url，必须按 SSRF fetch contract 做 redirect/DNS/IP/timeout/byte-cap/streaming-hash 校验。官方 seeded artifact 走平台内置例外。
- **OS sandbox 跨平台成本高** → 本 change 先把 approval/env scrub/audit/network disclosure 落地，OS-level sandbox 作为后续 release-hardening item；未实现 OS sandbox 时，不允许把 shell network deny 写成已 enforce。
- **Migration 政策容易和 pre-launch baseline 冲突** → 明确区分：desktop fresh baseline 继续有效；platform production 和 post-release schema 变更必须迁移化。

## Migration Plan

1. **Gate A - security blockers:** provider-scoped `llm_fetch`、sidecar project/provider binding、local path/git/deliverable containment、shell approval/audit/env scrub、marketplace listing ownership guard。
2. **Gate B - marketplace/platform hardening:** canonical manifest、artifact integrity + SSRF fetch contract、DB unique constraints、API token scopes、local route guard、install transaction、MCP stdio permissioning。
3. **Gate C - release documentation and verification:** README validation policy、SECURITY.md、RUNBOOK.md、release gate checklist、desktop release `.app` verification evidence.

Rollback policy: Gate A/B changes must be fail-closed. If a provider/sidecar/marketplace flow cannot be resolved under the new contract, the UI shows a typed unavailable/error state rather than silently falling back to the old permissive path.

## Default Decisions

- **OS sandbox**: not required for this change. Shell network denial SHALL NOT be claimed unless OS-level sandbox/firewall/proxy enforcement is implemented and verified with evidence.
- **Artifact storage**: registry object upload is preferred. `external_url` is production-allowed only if the full SSRF fetch contract is implemented; otherwise it fails closed and publisher artifacts must use registry object upload.
- **Platform/local split**: local runtime bridge may use a local-only/auth guard in this change. Physically splitting public platform and local bridge apps remains a future architecture cleanup unless implementation shows the guard cannot be made reliable.
