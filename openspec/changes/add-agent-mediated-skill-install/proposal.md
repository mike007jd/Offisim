## Why

T2.1 `skills-foundation` 把 SKILL.md 两层 schema 和 Marketplace 装包做完了，但用户要把一个 skill 放进公司只有 "发布到 Market 再装回来" 这一条路 — 对 agent-native 产品是倒走弯路。2026 行业共识（Hermes Agent / Claude Code / OpenClaw / Codex）已经把 "装 skill" 做成 chat 里跟员工讲一句话就能完成的事，Offisim 沿用：员工持有 skill-install 工具集，用户在 chat 里说 "装一下 github.com/…"、"导一下我刚传的包"、"同步一下 Claude 里的 skill"，员工调工具抓内容、展示 preview、等用户 confirm 后落盘。顺带天然激活 T2.1 留存的 4 条 deferred live verify 场景（path-traversal / slug collision / cross-scope override / desktop migration），不用单独开 change。

## What Changes

- 新能力：**agent-mediated skill install** — 给所有员工暴露 4 个工具（`install_skill_from_git` / `install_skill_from_upload` / `sync_from_claude_code` / `sync_from_codex`），员工从 LLM prompt 里推断 `scope` 和目标 employee，工具后端按源抓 SKILL.md 及 `scripts/` / `references/` / `assets/`，组装成安装请求
- 新增 preview interaction kind `skill_install_confirm`：沿用现有 `InteractionRequest` 通道，chat bubble 展示 SKILL.md 正文 + `allowedTools` 清单 + 源 URL / 路径，宽口 pattern（`bash:*` / `network:*` / `fs:*`）红色高亮，用户显式 Confirm 后才真正写 vault + 插 DB 行；Cancel 走空操作
- 新增统一安装入口 `SkillLoader.installSkill({ scope, employeeId?, source, files })`：支持 company 和 employee 两种 scope，沿用 T2.1 tier-3 path-traversal 守卫、`skills` 表 scope/employee_id 约束、partial UNIQUE 和 slug 唯一性规则；旧的 `installCompanyScopeSkill` 保留作 company-scope 的便捷 wrapper
- 新增源 resolver 模块：
  - Git（Desktop 走 Tauri shell 的 git clone 到 tmp 目录后扫描；Web 只支持 GitHub，走 `api.github.com/repos/{owner}/{repo}/tarball/{ref?}` + `fflate` 解压，不引入 git 到 web bundle）
  - Upload（zip / tarball / 单 `SKILL.md`；web + desktop 共用 `fflate`）
  - Claude Code 本地同步（扫 `~/.claude/skills/` 和项目本地 `.claude/skills/`；Desktop-only，Web 调工具返回 `not-supported-in-web` 结构化错误）
  - Codex 本地同步（扫 `~/.codex/skills/`；Desktop-only，Web 同样 `not-supported-in-web`）
- 新增 `packages/core/src/skills/skill-scanner.ts`：给目录路径 → 返回 `{ skillMdPath, scriptsDir?, referencesDir?, assetsDir? }` 的规范结构，被 git clone、upload 解压、本地同步三条路径复用
- 安全层强制：安装前必须出 preview interaction；工具调用本身不触碰 vault，只准备 payload；confirm 回调进入 `installSkill` 才执行真正 IO；IO 前再跑一遍 tier-3 守卫（拒 `..` / 绝对路径 / 非 `scripts|references|assets` 前缀）
- 顺路在 live verify 里收 T2.1 的 4 条 deferred scenario：路径穿越拒绝、同 slug 冲突拒绝、employee override 覆盖 company、desktop Tauri 首次装触发老 `runtimeSkill` migration

## Capabilities

### New Capabilities

- `agent-mediated-skill-install`: 员工工具集 + 4 类源 resolver + preview/confirm interaction + 统一 `SkillLoader.installSkill` 入口，覆盖 "chat 说话 → skill 落地" 的全链路安全与幂等契约

### Modified Capabilities

（无 — skills-foundation 的两层 schema / scope 约束 / tier-3 守卫 / Marketplace 装包契约全量保留；新能力以 superset API `installSkill` 包住 `installCompanyScopeSkill`，不改旧语义）

## Impact

**新增文件**：
- `packages/core/src/skills/skill-scanner.ts`
- `packages/core/src/skills/skill-source-resolvers/{git,upload,claude-code,codex}.ts`
- `packages/core/src/agents/skill-install-tools.ts`
- `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx`
- `apps/web/src/lib/github-tarball.ts`（web-only）

**修改文件**：
- `packages/core/src/skills/skill-loader.ts` — 加 `installSkill()` 统一入口，`installCompanyScopeSkill` 降级为 wrapper
- `packages/shared-types/src/interactions.ts` — `InteractionKind` union 加 `'skill_install_confirm'`，对应 `SkillInstallConfirmInteractionContext` 结构
- `packages/core/src/agents/employee-tool-kit.ts`（或等价 tool registry）— 注入 4 个 skill-install 工具
- `packages/core/src/runtime/tool-executor.ts`（或等价 dispatch 层）— 分发 skill-install 工具到 handler
- `packages/ui-office/src/hooks/useInteractionResponse.ts`（或等价 chat interaction hook）— 处理 `skill_install_confirm` kind
- `packages/ui-office/src/components/chat/*`（interaction bubble 路由）— 新 kind 路由到 `SkillInstallConfirmBubble`

**依赖与运行时**：
- 复用 `fflate`（`@offisim/ui-office` 或 `packages/core` 已含作 deliverable export dep）
- Desktop 复用 Tauri shell allowlist（git 命令），需在 `apps/desktop/src-tauri/capabilities/default.json` 追加 `git` 允许项
- Web bundle **不新增** git 依赖；GitHub tarball fetch 走原生 `fetch` + `fflate`
- 不接外部 registry（agentskills.io / skills.sh）— 1.0 口径 "Market 只自家生态"
- 不做 scripts 执行 sandbox — T2.2 只做 import + SKILL.md 可读，执行权留 T2.4 / 后续独立安全 change
- 不做 workstation-scoped 精细化安装权限 — 默认所有员工都能装，精细化留 T2.7

**spec 侧**：
- 新 canonical spec `agent-mediated-skill-install`，archive 后 T2.1 `skills-foundation` 的 4 条 deferred verify 可以在该 change 的 live verify record 里一并勾掉（spec 本身不改）
