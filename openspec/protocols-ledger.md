# Offisim 协议 / 依赖对齐台账

**目的**：追踪 Offisim 所依赖的外部协议 / SDK / 标准和我们 repo 内实现的一致性，防止"产品前进、底层口径停旧版"型雷（A2A 是前车之鉴，2026-04-14/18 才发现抽象已翻）。

**维护规则**：
1. 任何 change 若碰到本表列出的协议 / SDK / 标准，**archive 前必须核对本表相应行**，如口径已变须同步更新"Repo claim"和"下一步"列。
2. 每季度至少做一次全表对照（用 Context7 + 官方仓库）。
3. 新引入外部协议 / 标准必须加入本表。

**字段**：
- **Repo claim**：Offisim 当前代码 / spec / 文档所声称的版本和用法
- **外部口径**：Context7 / 官方仓库当前主路径
- **一致？**：✅ = 一致 / ⚠️ = 有漂移 / ❌ = 有明显过时
- **下一步**：要做的动作（audit / migrate / 观察 / 接入）

---

## 2026-05-07 台账

| # | 协议 / 依赖 | Repo claim | 外部口径 | 一致？ | 下一步 |
|---|---|---|---|---|---|
| 1 | **A2A Protocol** | v1.0（2026-04-18 Phase 2b #1 rewire 完成：`supportedInterfaces[]` + PascalCase methods + `TASK_STATE_*` enum + 统一 Part one-of） | A2A v1.0 spec（a2a-protocol.org） | ✅ | 观察；如 v1.1 / v2 出现时评估 |
| 2 | **MCP Transport (TypeScript SDK)** | `@modelcontextprotocol/sdk` 统一包；desktop MCP bridge 当前只实际支持 local stdio；UI/registry 仍可记录 legacy `sse`，但 desktop connect 会拒绝；本轮决策见 `openspec/specs/mcp-transport-decision.md` | Context7 2026-05-02：`StreamableHTTPClientTransport` 是现代远程 client transport；client-side `SSEClientTransport` 仍用于 legacy SSE server fallback；server-side SSE v2 已移除/弃用 | ⚠️ | 本 change 不迁移 Streamable HTTP。迁移触发：真实远程 MCP 产品需求、目标 server 不再支持 SSE、或 SDK 移除 client SSE。迁移时必须同时做 auth/header storage、reconnect/health、legacy saved-entry 兼容 |
| 3 | **Better Auth** | `better-auth` + `drizzleAdapter` + `bearer()` plugin + 自定义 `offisim_` 前缀 API token + session / bearer 双路径 | 当前 Better Auth 主配置模式 | ✅ | 观察；平台 token 语义若继续复杂化再单独整 auth model |
| 4 | **Tauri 2** | `@tauri-apps/api ^2.10.1` + `plugin-fs ^2.4.5` + `plugin-sql ^2.3.2` + `plugin-dialog ^2.4.1` + `plugin-opener ^2.5.0`；`__TAURI_INTERNALS__` 认 Tauri 2；fs / sql / dialog / opener plugin 三件套（Cargo.toml + lib.rs init + capabilities/default.json）；**2026-04-20 `isolate-tauri-desktop-llm-credential` 新增 `llm_transport` 模块（2026-04-21 storage backend pivot）**：Rust-side `reqwest` transport for desktop LLM calls（`llm_fetch` + `llm_fetch_abort` 两 command + `Channel<TransportEvent>` streaming IPC）；TS adapter 通过 SDK `{ fetch }` override 透传（gateway-factory / anthropic-adapter / openai-adapter 新 `fetch?: typeof fetch` 契约）；secret 存储改为 Rust-only plaintext file（`<app_local_data_dir>/runtime_secret.txt`，mode 0600，atomic tmp+rename）**而不是 macOS Keychain**——初版 `keyring` 3.x 无 backend 走 mock 丢写，加 `apple-native` 后每次 rebuild binary hash 变弹 ACL prompt；参考 Claude Code `secureStorage` 同样 fallback plaintext。`runtime_secret_get` 永不引入，credential 不跨 Rust→JS 边界；**2026-04-26 `project-workspace-root-binding`** 用 dialog 选择本地 workspace folder、用 opener reveal/open folder，web 端只保留 stub 降级；**2026-04-29 `close-runtime-routing-and-workspace-debt`** 新增 `project_read_file_preview(path, cwd, max_bytes)` Tauri command（`fs-shell` capability 同步追加），server-side 硬上限 64 KB，UTF-8 boundary walk-back 保证 IPC 永不流大文件；**2026-04-30 `add-url-sync-and-deep-links`** 依赖 Tauri 2 asset resolver 对未命中 app path fallback 到 `index.html`，release `.app` 深路径 reload 必须验证 `tauri://localhost/<workspace>` 仍进 SPA；**2026-05-05 `add-chat-attachment-end-to-end`** 新增 5 个 binary-safe IPC command（`attachment_write` / `attachment_read` / `attachment_list` / `attachment_list_all` / `attachment_delete`，`Vec<u8>` 直传无 base64 inflation，`fs-shell` capability allowlist 同步加），`scripts/check-attachment-capabilities.mjs` 在 `apps/desktop` `prebuild` 拦下漂移；存储路径 `<app_local_data_dir>/attachments/<companyId>/<threadId>/<attachmentId>.bin` + `.meta.json`，server-side 硬上限 8 MB / 文件，sha256 verify on read，corrupted 自动 drop row，`attachment_list_all` 只递归读 `.meta.json` 供 GC 使用；新增 Cargo 依赖 `sha2` + `hex` | Tauri 2 当前主路径 | ✅ | 观察；遗留风格混合（绝对路径 vs `BaseDirectory`）作卫生项非紧急 |
| 5 | **LangGraph / checkpoint** | `@langchain/langgraph ^1.3.0` + `@langchain/core ^1.1.44` + `langgraph-checkpoint-sqlite ^1.0.1` + `langgraph-checkpoint ^1.0.2`；web 侧自维护 fork `apps/web/src/lib/tauri-checkpoint.ts`；pnpm patch `patches/@langchain__langgraph@1.3.0.patch` 仅修 retry metadata 对 frozen Error 的 best-effort 写入。fork/patch 边界与季度 checklist 见 `openspec/specs/langgraph-fork-tracking.md` | LangGraph JS 1.3.0 仍未吸收 retry metadata best-effort patch；checkpoint API 继续按 fork-tracking 检查 | ⚠️ | 每季度按 `openspec/specs/langgraph-fork-tracking.md` 对比 upstream SqliteSaver、检查 pnpm patch 是否仍需要、跑 deterministic replay/resume 后再更新本台账 |
| 6 | **SKILL.md 开放标准** | **已接**（T2.1 `add-skills-foundation-two-tier-schema` + T2.2 `add-agent-mediated-skill-install` 2026-04-19 + T2.3 `add-skills-fork-and-edit` 2026-04-20 + T2.4 `create_skill_from_scratch` 2026-04-26）：`packages/core/src/skills/skill-md.ts` parser + serializer 只认 Anthropic 标准字段（`name` + `description` 必填，可选 `allowedTools` / `license` / `version`），禁 `offisim.*` 私有命名空间；self-authoring 额外走 `parseSelfAuthoredSkillMd` strict whitelist，unknown field / `offisim.*` / missing required 都拒收；`SkillLoader` 3-tier API + 统一 `installSkill` 入口 + `forkSkill` 复用 installSkill / `editSkillBody` 独立入口；两层 schema `skills` 表，`source_kind` DB enum CHECK 已放开以保 provenance 扩展；vault 磁盘布局 `companies/{cid}/[employees/{slug}/]skills/{slug}/SKILL.md`；**agent-mutation 路径 T2.2-T2.4 落地**：7 员工工具（`install_skill_from_git` / `install_skill_from_upload` / `sync_from_claude_code` / `sync_from_codex` / `fork_skill` / `edit_skill_body` / `create_skill_from_scratch`）+ `SkillInstallConfirmBubble` preview（action=install/fork/edit/create 四分支）+ `SkillInstallCommitter` 两阶段安全；**fork/self-author provenance 只落 DB**（fork: `source_kind='forked'` + `source_ref='company-skill:<parentId>@<parentVersion>'`; self-author: `source_kind='self-authored'` + `source_ref='llm-author:<modelKey>'`），SKILL.md frontmatter 不扩 `offisim.*`，保 Anthropic 开放标准 portability | Anthropic SKILL.md spec（2025-12 开放标准 / `anthropics/skills` 120k stars / Hermes / Claude Code / Cursor / Codex / Copilot / Windsurf / Gemini 等 19 agent 互通 / 350k+ packages） | ✅ | 观察上游是否加 `version` 等官方字段；目前 `allowedTools` 作 Anthropic 允许的扩展字段 |
| 7 | **agentskills.io registry** | **未接** | agentskills.io 是 Anthropic 主推的 skill 公共 registry，Hermes / Claude / 等都对接 | ❌ | **T2.2** 作 import 源之一（同步 Claude 的 skills，本地 / URL 均可）；不把自家 skill 推过去（Market 只自家生态） |
| 8 | **Anthropic Claude Agent SDK** | `@anthropic-ai/claude-agent-sdk 0.2.132` + `@anthropic-ai/sdk ^0.95.0`；Offisim 通过自有 `ClaudeAgentSdkAdapter` / trusted-host bridge 把 SDK provider lane 限定在 leaf text/reasoning execution adapter；MiniMax Intl 与 Z.AI 有 Claude Agent SDK LLM execution evidence，详见 `openspec/provider-lane-matrix.md`；rich agent 能力属于 `RuntimeEngineCapabilityProfile` / main-harness control-plane，当前 Claude engine 是 text-only preview profile | Anthropic 当前主推 `@anthropic-ai/claude-agent-sdk`；TypeScript SDK 自带 Claude Code native binary，可通过 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 走 LLM gateway；第三方产品需用 API key / cloud auth，不应复用 claude.ai 登录/订阅配额 | ⚠️ | SDK provider lane 不暴露 file/shell/memory/todo/skill/MCP/builtin tools；当前工具工作走默认 Offisim harness / gateway evidence path；full-agent / gateway-bridged Claude employee profile 必须先补 denied-path、cancellation、checkpoint/resume、telemetry、rollback、release evidence |
| 9 | **OpenAI Agents SDK** | `@openai/agents 0.9.1` + `openai ^6.36.0` + `OpenAiAgentsSdkAdapter` + trusted-runtime transport override 已落；native OpenAI / OpenAI-compatible rows仍以 `openspec/provider-lane-matrix.md` 为证据源；Codex local-auth product 是 text/reasoning-only；SDK provider lane 不能自升为 employee-agent / main-harness driver / replacement | npm `@openai/agents` latest 为 0.9.1；OpenAI 2026-04 Agents SDK harness / sandbox 更新主要是能力口径和 Python `openai-agents>=0.14.0` 路径，不代表本 repo 使用的 TypeScript 包已到 2.0 | ⚠️ | 先补 OpenAI native smoke / load / edge evidence，再逐家验证 OpenRouter / Kimi / Z.AI / Gemini / DeepSeek / Qwen compat variant；未有实证前产品不宣称 OpenAI Agents SDK provider lane verified，更不能从 provider lane evidence 推导 full-agent employee support |

---

## 新列入待观察（补充条目，非当前雷）

| # | 协议 / 依赖 | 说明 |
|---|---|---|
| 10 | Anthropic Claude API (Messages) | 我们用非官方 CORS-friendly 路径（Bearer 替 x-api-key / strip telemetry / `messages.create({stream:true})` 替 `.stream()`），持续观察官方 breaking 变更 |
| 11 | MiniMax OpenAI-compatible endpoint | web dev fallback 默认；观察 MiniMax SDK 主口径是否改 |
| 12 | DiceBear `avataaars` | 2D 头像来源；跨大版本升级时 outfit color 映射会漂 |
| 13 | Three.js / R3F | 3D scene；版本漂 2D 降级 fallback 还在 |
| 14 | SheetJS CDN tarball | doc-engine xlsx 走 `https://cdn.sheetjs.com/..tgz` install-time 拉（SheetJS 许可），CDN 下线即坏 |
| 15 | Radix Popover | `@offisim/ui-core` exposes a Radix-backed `Popover` primitive (`@radix-ui/react-popover 1.1.15`, current npm latest on 2026-04-30) integrated with modal-stack as `kind:'popover'`; product code should not hand-roll popover portals or document listeners |

---

## 历史教训（别重蹈）

**A2A 2026-04-14→18 翻盘事件**：
- repo 里按"外包 department"抽象落过一轮（`ExternalDepartmentDefinition` / `department_dispatcher` / `sourceKind:'department'`），产品根本没这概念
- 同时 A2A 协议层还停在 v0.3（snake-case methods + discriminated Part），上游已到 v1.0
- 直到对标时发现 **抽象和协议双翻**，Phase 2b 拆成三件套补救
- **教训**：spec / tasks / code / docs 与上游协议的同步纪律要常规化，不是"出雷才查"

**T1.4 archive gate 是本教训的制度化**：
- 每条 change archive 前必须跑：spec 表达的 scope 是否与 code reality 一致 / tasks 已修正但 spec 未修 / README 注释是否还在输出过期 claim
- 规则写进 CLAUDE.md Truth-source 节
