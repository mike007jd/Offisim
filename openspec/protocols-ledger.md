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

## 2026-04-22 台账

| # | 协议 / 依赖 | Repo claim | 外部口径 | 一致？ | 下一步 |
|---|---|---|---|---|---|
| 1 | **A2A Protocol** | v1.0（2026-04-18 Phase 2b #1 rewire 完成：`supportedInterfaces[]` + PascalCase methods + `TASK_STATE_*` enum + 统一 Part one-of） | A2A v1.0 spec（a2a-protocol.org） | ✅ | 观察；如 v1.1 / v2 出现时评估 |
| 2 | **MCP Transport (TypeScript SDK)** | `@modelcontextprotocol/sdk` 统一包；transport 用 `SSEClientTransport` + `StdioClientTransport`；types 枚举 `'stdio' \| 'sse'` | split packages（`@modelcontextprotocol/client` + `@modelcontextprotocol/server`）；远程 transport 主推 `StreamableHTTPClientTransport` + `NodeStreamableHTTPServerTransport`；stdio 继续；SSE 已不再主推 | ❌ | **T1.1 explore** → 审视是继续兼容 SSE 还是迁 Streamable HTTP；split packages 迁移评估。不急改但要出结论 |
| 3 | **Better Auth** | `better-auth` + `drizzleAdapter` + `bearer()` plugin + 自定义 `offisim_` 前缀 API token + session / bearer 双路径 | 当前 Better Auth 主配置模式 | ✅ | 观察；平台 token 语义若继续复杂化再单独整 auth model |
| 4 | **Tauri 2** | `@tauri-apps/api ^2.10.1` + `plugin-fs ^2.4.5` + `plugin-sql ^2.3.2` + `plugin-dialog ^2.4.1` + `plugin-opener ^2.5.0`；`__TAURI_INTERNALS__` 认 Tauri 2；fs / sql / dialog / opener plugin 三件套（Cargo.toml + lib.rs init + capabilities/default.json）；**2026-04-20 `isolate-tauri-desktop-llm-credential` 新增 `llm_transport` 模块（2026-04-21 storage backend pivot）**：Rust-side `reqwest` transport for desktop LLM calls（`llm_fetch` + `llm_fetch_abort` 两 command + `Channel<TransportEvent>` streaming IPC）；TS adapter 通过 SDK `{ fetch }` override 透传（gateway-factory / anthropic-adapter / openai-adapter 新 `fetch?: typeof fetch` 契约）；secret 存储改为 Rust-only plaintext file（`<app_local_data_dir>/runtime_secret.txt`，mode 0600，atomic tmp+rename）**而不是 macOS Keychain**——初版 `keyring` 3.x 无 backend 走 mock 丢写，加 `apple-native` 后每次 rebuild binary hash 变弹 ACL prompt；参考 Claude Code `secureStorage` 同样 fallback plaintext。`runtime_secret_get` 永不引入，credential 不跨 Rust→JS 边界；**2026-04-26 `project-workspace-root-binding`** 用 dialog 选择本地 workspace folder、用 opener reveal/open folder，web 端只保留 stub 降级 | Tauri 2 当前主路径 | ✅ | 观察；遗留风格混合（绝对路径 vs `BaseDirectory`）作卫生项非紧急 |
| 5 | **LangGraph / checkpoint** | `@langchain/langgraph ^1.2.9` + `langgraph-checkpoint-sqlite ^1.0.1` + `langgraph-checkpoint ^1.0.0`；**web 侧自维护 fork** `apps/web/src/lib/tauri-checkpoint.ts`（手抄 upstream `SqliteSaver` 用 Tauri async SQL）；**2026-04-20 write-path hotfix `fix-tauri-checkpoint-serial-writer`**：`putWrites` 合并 multi-VALUES 单 execute（消除 BEGIN/INSERT/COMMIT 散 execute 撞 sqlx pool split-conn 的 race）+ 进程级 async mutex 串行化 `put` / `putWrites` / `deleteThread` + 写路径 `[tauri-checkpoint/<method>]` stack logging；**2026-04-26 dispatcher convergence fix**：`step_dispatcher` / `step_advance` 共享 terminal guard，all-terminal plan 直接 `boss_summary`，未来 recursion-limit 先发 `sop.dispatcher.recursion_limit` diagnostic event | LangGraph JS 主 API 当前形态 | ⚠️ | **T1.3** 显式标注 fork 差异 + 建立定期对比 upstream 机制；风险是未来 upstream 加 filter / migration 时本地悄悄落后。dispatcher 收敛属于 repo graph invariant，不改 LangGraph limit |
| 6 | **SKILL.md 开放标准** | **已接**（T2.1 `add-skills-foundation-two-tier-schema` + T2.2 `add-agent-mediated-skill-install` 2026-04-19 + T2.3 `add-skills-fork-and-edit` 2026-04-20 + T2.4 `create_skill_from_scratch` 2026-04-26）：`packages/core/src/skills/skill-md.ts` parser + serializer 只认 Anthropic 标准字段（`name` + `description` 必填，可选 `allowedTools` / `license` / `version`），禁 `offisim.*` 私有命名空间；self-authoring 额外走 `parseSelfAuthoredSkillMd` strict whitelist，unknown field / `offisim.*` / missing required 都拒收；`SkillLoader` 3-tier API + 统一 `installSkill` 入口 + `forkSkill` 复用 installSkill / `editSkillBody` 独立入口；两层 schema `skills` 表，`source_kind` DB enum CHECK 已放开以保 provenance 扩展；vault 磁盘布局 `companies/{cid}/[employees/{slug}/]skills/{slug}/SKILL.md`；**agent-mutation 路径 T2.2-T2.4 落地**：7 员工工具（`install_skill_from_git` / `install_skill_from_upload` / `sync_from_claude_code` / `sync_from_codex` / `fork_skill` / `edit_skill_body` / `create_skill_from_scratch`）+ `SkillInstallConfirmBubble` preview（action=install/fork/edit/create 四分支）+ `SkillInstallCommitter` 两阶段安全；**fork/self-author provenance 只落 DB**（fork: `source_kind='forked'` + `source_ref='company-skill:<parentId>@<parentVersion>'`; self-author: `source_kind='self-authored'` + `source_ref='llm-author:<modelKey>'`），SKILL.md frontmatter 不扩 `offisim.*`，保 Anthropic 开放标准 portability | Anthropic SKILL.md spec（2025-12 开放标准 / `anthropics/skills` 120k stars / Hermes / Claude Code / Cursor / Codex / Copilot / Windsurf / Gemini 等 19 agent 互通 / 350k+ packages） | ✅ | 观察上游是否加 `version` 等官方字段；目前 `allowedTools` 作 Anthropic 允许的扩展字段 |
| 7 | **agentskills.io registry** | **未接** | agentskills.io 是 Anthropic 主推的 skill 公共 registry，Hermes / Claude / 等都对接 | ❌ | **T2.2** 作 import 源之一（同步 Claude 的 skills，本地 / URL 均可）；不把自家 skill 推过去（Market 只自家生态） |
| 8 | **Anthropic Claude Agent SDK** | `@anthropic-ai/claude-agent-sdk 0.2.117`；Offisim 通过自有 `ClaudeAgentSdkAdapter` / trusted-host bridge 把 SDK 限定在 leaf execution adapter，顶层仍由 LangGraph / OrchestrationService 持有；2026-04-22 backend harness + Tauri trusted host 已跑通 MiniMax Intl 与 Z.AI 的 Anthropic-compatible lane。**Curated provider facts（endpoint / model / region）由 `provider-source-registry` 产出，产品身份 / access mode / trusted-host gating 由 repo-owned product taxonomy 决定**；browser 仍只暴露 `gateway` | Anthropic 当前主推 `@anthropic-ai/claude-agent-sdk`；TypeScript SDK 自带 Claude Code native binary，可通过 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 走 LLM gateway；第三方产品需用 API key / cloud auth，不应复用 claude.ai 登录/订阅配额 | ⚠️ | Anthropic-compatible verified providers（当前 MiniMax / Z.AI）已作为 Claude lane gating evidence；后续继续逐家补 Kimi / Qwen / Anthropic native 样本，并把证据写入 `openspec/provider-lane-matrix.md`；随后决定桌面分发是否要内置 Node sidecar 依赖 |
| 9 | **OpenAI Agents SDK** | `@openai/agents 0.8.5` + `OpenAiAgentsSdkAdapter` + trusted-runtime transport override 已落；Tauri `openai-agents-sdk` lane 现可复用 Rust `llm_fetch` 做 credential-isolated OpenAI transport，native OpenAI 是默认实现路径。**Curated compat/default endpoint facts 由 `provider-source-registry` 维护，哪些产品 / variants 可以暴露该 lane 由 repo-owned product taxonomy + lane matrix 决定**；产品面仍只暴露 `gateway` | OpenAI 当前主 SDK 为 `@openai/agents`，支持默认 OpenAI provider、内建 model/provider 扩展点，以及非 OpenAI provider / adapter 路径；不同 provider 功能差异需单独验证 | ⚠️ | 先补 OpenAI native smoke / load / edge evidence，再逐家验证 OpenRouter / Kimi / Z.AI / Gemini / DeepSeek 等 compat variant；在 `openspec/provider-lane-matrix.md` 有实证前继续保持 product host gateway-only |

---

## 新列入待观察（补充条目，非当前雷）

| # | 协议 / 依赖 | 说明 |
|---|---|---|
| 10 | Anthropic Claude API (Messages) | 我们用非官方 CORS-friendly 路径（Bearer 替 x-api-key / strip telemetry / `messages.create({stream:true})` 替 `.stream()`），持续观察官方 breaking 变更 |
| 11 | MiniMax OpenAI-compatible endpoint | web dev fallback 默认；观察 MiniMax SDK 主口径是否改 |
| 12 | DiceBear `avataaars` | 2D 头像来源；跨大版本升级时 outfit color 映射会漂 |
| 13 | Three.js / R3F | 3D scene；版本漂 2D 降级 fallback 还在 |
| 14 | SheetJS CDN tarball | doc-engine xlsx 走 `https://cdn.sheetjs.com/..tgz` install-time 拉（SheetJS 许可），CDN 下线即坏 |

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
