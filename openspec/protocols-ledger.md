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

## 2026-04-19 台账

| # | 协议 / 依赖 | Repo claim | 外部口径 | 一致？ | 下一步 |
|---|---|---|---|---|---|
| 1 | **A2A Protocol** | v1.0（2026-04-18 Phase 2b #1 rewire 完成：`supportedInterfaces[]` + PascalCase methods + `TASK_STATE_*` enum + 统一 Part one-of） | A2A v1.0 spec（a2a-protocol.org） | ✅ | 观察；如 v1.1 / v2 出现时评估 |
| 2 | **MCP Transport (TypeScript SDK)** | `@modelcontextprotocol/sdk` 统一包；transport 用 `SSEClientTransport` + `StdioClientTransport`；types 枚举 `'stdio' \| 'sse'` | split packages（`@modelcontextprotocol/client` + `@modelcontextprotocol/server`）；远程 transport 主推 `StreamableHTTPClientTransport` + `NodeStreamableHTTPServerTransport`；stdio 继续；SSE 已不再主推 | ❌ | **T1.1 explore** → 审视是继续兼容 SSE 还是迁 Streamable HTTP；split packages 迁移评估。不急改但要出结论 |
| 3 | **Better Auth** | `better-auth` + `drizzleAdapter` + `bearer()` plugin + 自定义 `offisim_` 前缀 API token + session / bearer 双路径 | 当前 Better Auth 主配置模式 | ✅ | 观察；平台 token 语义若继续复杂化再单独整 auth model |
| 4 | **Tauri 2** | `@tauri-apps/api ^2.10.1` + `plugin-fs ^2.4.5` + `plugin-sql ^2.3.2`；`__TAURI_INTERNALS__` 认 Tauri 2；fs / sql plugin 三件套（Cargo.toml + lib.rs init + capabilities/default.json） | Tauri 2 当前主路径 | ✅ | 观察；遗留风格混合（绝对路径 vs `BaseDirectory`）作卫生项非紧急 |
| 5 | **LangGraph / checkpoint** | `@langchain/langgraph ^1.2.1` + `langgraph-checkpoint-sqlite ^1.0.1` + `langgraph-checkpoint ^1.0.0`；**web 侧自维护 fork** `apps/web/src/lib/tauri-checkpoint.ts`（手抄 upstream `SqliteSaver` 用 Tauri async SQL）；**2026-04-20 write-path hotfix `fix-tauri-checkpoint-serial-writer`**：`putWrites` 合并 multi-VALUES 单 execute（消除 BEGIN/INSERT/COMMIT 散 execute 撞 sqlx pool split-conn 的 race）+ 进程级 async mutex 串行化 `put` / `putWrites` / `deleteThread` + 写路径 `[tauri-checkpoint/<method>]` stack logging | LangGraph JS 主 API 当前形态 | ⚠️ | **T1.3** 显式标注 fork 差异 + 建立定期对比 upstream 机制；风险是未来 upstream 加 filter / migration 时本地悄悄落后。本次 hotfix 未解这条根问题，只解 T2.3 暴露的 desktop `database is locked` + `cannot rollback - no transaction is active` race |
| 6 | **SKILL.md 开放标准** | **已接**（T2.1 `add-skills-foundation-two-tier-schema` + T2.2 `add-agent-mediated-skill-install` 2026-04-19）：`packages/core/src/skills/skill-md.ts` parser + serializer 只认 Anthropic 标准字段（`name` + `description` 必填，可选 `allowedTools` / `license` / `version`），禁 `offisim.*` 私有命名空间；`SkillLoader` 3-tier API + 统一 `installSkill` 入口；两层 schema `skills` 表；vault 磁盘布局 `companies/{cid}/[employees/{slug}/]skills/{slug}/SKILL.md`；**agent-install 路径 T2.2 落地**：4 个员工工具（`install_skill_from_git` / `install_skill_from_upload` / `sync_from_claude_code` / `sync_from_codex`）+ `SkillInstallConfirmBubble` preview + `SkillInstallCommitter` 两阶段安全 | Anthropic SKILL.md spec（2025-12 开放标准 / `anthropics/skills` 120k stars / Hermes / Claude Code / Cursor / Codex / Copilot / Windsurf / Gemini 等 19 agent 互通 / 350k+ packages） | ✅ | 观察上游是否加 `version` 等官方字段；目前 `allowedTools` 作 Anthropic 允许的扩展字段 |
| 7 | **agentskills.io registry** | **未接** | agentskills.io 是 Anthropic 主推的 skill 公共 registry，Hermes / Claude / 等都对接 | ❌ | **T2.2** 作 import 源之一（同步 Claude 的 skills，本地 / URL 均可）；不把自家 skill 推过去（Market 只自家生态） |

---

## 新列入待观察（补充条目，非当前雷）

| # | 协议 / 依赖 | 说明 |
|---|---|---|
| 8 | Anthropic Claude API (Messages) | 我们用非官方 CORS-friendly 路径（Bearer 替 x-api-key / strip telemetry / `messages.create({stream:true})` 替 `.stream()`），持续观察官方 breaking 变更 |
| 9 | MiniMax OpenAI-compatible endpoint | web dev fallback 默认；观察 MiniMax SDK 主口径是否改 |
| 10 | DiceBear `avataaars` | 2D 头像来源；跨大版本升级时 outfit color 映射会漂 |
| 11 | Three.js / R3F | 3D scene；版本漂 2D 降级 fallback 还在 |
| 12 | SheetJS CDN tarball | doc-engine xlsx 走 `https://cdn.sheetjs.com/..tgz` install-time 拉（SheetJS 许可），CDN 下线即坏 |

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
