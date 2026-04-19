## 1. Shared-types + interaction kind extension

- [x] 1.1 在 `packages/shared-types/src/interactions.ts` 的 `InteractionKind` union 追加 `'skill_install_confirm'`，不改任何现有成员
- [x] 1.2 追加 `SkillInstallConfirmInteractionContext` 接口（字段与 spec requirement 对齐：`stagingRef` / `skillName` / `skillDescription` / `allowedTools` / `sourceKind` / `sourceRef` / `resolvedScope` / `resolvedEmployeeId` / `assetPaths`）并加入 `InteractionContext` union
- [x] 1.3 在 `packages/shared-types/src/index.ts` 暴露新类型；跑 `pnpm --filter @offisim/shared-types build` 串行序，下游 `core` / `ui-office` 后续重 build

## 2. SkillLoader 统一安装入口

- [x] 2.1 在 `packages/core/src/skills/skill-loader.ts` 新增 `installSkill({ scope, companyId, employeeId?, source, files })` 入口，先跑 tier-3 守卫（`..` / 绝对路径 / 非 `scripts|references|assets` 前缀），再写 SKILL.md → 写 assets → 插 `skills` 行的顺序
- [x] 2.2 把现有 `installCompanyScopeSkill` 改成调用 `installSkill({ scope: 'company', source: { kind: 'marketplace', ref: listingId }, ... })` 的 thin wrapper，**公共签名和返回值不变**
- [x] 2.3 加 slug 冲突跨 source 检测：company-scope 同 slug 来自不同 `source.ref` 直接拒；employee-scope 允许覆盖同 slug company-scope（落在 partial UNIQUE 上）
- [x] 2.4 加 write-through 失败回滚：写 asset 过程中任一失败 → 删已写文件 → 不插 `skills` 行 → 重抛原始 error

## 3. Skill scanner + 源 resolvers

- [x] 3.1 新建 `packages/core/src/skills/skill-scanner.ts`，签名 `scanSkillDir(virtualTree): { skillMdPath, scriptsDir?, referencesDir?, assetsDir?, ambiguousCandidates? }`，对 SKILL.md 在 root 或唯一一级子目录的情况返 skill 根；多个候选返 `ambiguousCandidates`
- [x] 3.2 新建 `packages/core/src/skills/skill-source-resolvers/git.ts`：Desktop 走 Tauri shell `git clone <url> <tmpDir>`（allowlist 需同步改 `apps/desktop/src-tauri/capabilities/default.json` 开 `git` 命令，若还没开）；Web 分支 URL 不含 `github.com/` 主机时返 `git-web-non-github`；GitHub 走 `https://api.github.com/repos/{owner}/{repo}/tarball/{ref?}` + `fflate` 解压
- [x] 3.3 新建 `packages/core/src/skills/skill-source-resolvers/upload.ts`：接 zip / tar.gz / 单 SKILL.md（`fflate` 解压）；多 SKILL.md 返 `upload-multiple-skills`；0 SKILL.md 返 `upload-no-skill-md`
- [x] 3.4 新建 `packages/core/src/skills/skill-source-resolvers/claude-code.ts`：Desktop 扫 `~/.claude/skills/` + `.claude/skills/`，返全量候选（上限 50，超返 `sync-too-many-candidates`）；Web 直接返 `not-supported-in-web`
- [x] 3.5 新建 `packages/core/src/skills/skill-source-resolvers/codex.ts`：Desktop 扫 `~/.codex/skills/`，同样规则；Web 返 `not-supported-in-web`
- [x] 3.6 加 staging 管理：进程内 `Map<stagingRef, StagedPayload>` + 30 分钟 TTL + setInterval GC；退出信号时清 tmp 目录

## 4. 工具注入与 dispatch

- [x] 4.1 新建 `packages/core/src/agents/skill-install-tools.ts`，定义 4 个工具的 JSON schema（`install_skill_from_git` / `install_skill_from_upload` / `sync_from_claude_code` / `sync_from_codex`）+ 对应 handler：handler 做参数校验（scope/target 冲突、target-employee-not-found）→ 调 resolver → stage → emit `InteractionRequest`（kind=`skill_install_confirm`）→ 返 `{ status: 'pending-confirm', interactionId }`
- [x] 4.2 在现有 employee tool kit 组装路径（定位 `packages/core/src/agents/` 里注入 tool 列表的那个文件，按当前 barrel 结构挂载），把 4 个 skill-install tool 加到所有 employee role / internal / external 的统一 tool 集里
- [x] 4.3 在 runtime tool executor（定位当前 dispatch tool 的 switch/map）把 4 个 tool 名字分发到 `skill-install-tools.ts` handler
- [x] 4.4 给 A2A external employee 走 employee-node 的同一 tool 注入路径也确认 4 个 tool 被挂上（brand 切换不影响 tool kit）。Note: `employee-node` 在 `is_external === 1` 时提前 `return runEmployeeA2A(...)`，跳过 `assembleToolKit`；tool 注入层本身不依赖 role / brand，但 A2A 远端 agent 自带 tool kit，不经本地 tool round。技术上 4 个 tool 对 A2A peer 不可见（本地 LLM turn 不发生），属于 A2A 协议边界。Live verify 中标注

## 5. Confirm 回路（interaction response → installSkill）

- [x] 5.1 定位现有 `InteractionResponse` 处理入口（LangGraph node / interaction resolver），加 `skill_install_confirm` 分支：selectedOptionId `'confirm'` → 按 `stagingRef` 拉 payload → 调 `SkillLoader.installSkill(...)` → 成功后发 chat 侧事件 + 清 staging；`'cancel'` / expired → 清 staging + 发取消事件；其它（包括 staging 过期）→ 返 `staging-expired` 结构化错误供 LLM 回应
- [x] 5.2 把 installed skill 事件（成功/失败）按现有 `employee.skill.*` 或 `skills.*` 事件 domain 发出（若已存在 domain），没有就挂在 `interaction.resolved` payload 里由 chat 侧 render

## 6. Preview bubble UI

- [x] 6.1 新建 `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx`：展示 skill name / description / allowedTools（宽口 pattern `bash*` / `network*` / `fs*` / `exec*` 红标）/ 源 URL/path / 可折叠 SKILL.md 正文 / assets 路径列表 / 最终 scope + employee name
- [x] 6.2 在 chat interaction bubble 路由（定位现有按 `InteractionKind` 分发的那个文件）加 `skill_install_confirm` → `SkillInstallConfirmBubble`；unknown kind fallback 不变
- [x] 6.3 danger 视觉复用项目现有 danger token（不自创配色），文案 "Permissions" / "Source" / "Scope" 三个 section heading
- [x] 6.4 assets 路径列表按 `scripts/` / `references/` / `assets/` 分 3 组展示；单 SKILL.md 时空组不显示
- [x] 6.5 SKILL.md 正文默认折叠（高度 6 行 + 渐变遮罩 + "Show full"），点击展开；不 render scripts 内容为 shell highlight（纯 text）

## 7. 平台分支 + Tauri 权限

- [x] 7.1 `apps/desktop/src-tauri/capabilities/default.json` 若未开 `shell:allow-execute` + `git` binary 白名单，补上最小必要 scope（只允许调 `git`，禁掉任意 shell 命令的通配）。Note: 已存在 Rust-level 沙盒 `git_exec` tauri::command（`apps/desktop/src-tauri/src/git.rs`）走 `ALLOWED_SUBCOMMANDS` 白名单 — 不走 tauri-plugin-shell 也不需开 `shell:allow-execute`；本 change 只补 `clone` 到白名单里（`apps/desktop/src-tauri/src/git.rs` ALLOWED_SUBCOMMANDS）
- [x] 7.2 确认 Web runtime 不加载 git 源 resolver 的 Desktop 分支（按 `isTauri()` runtime detect；导入层用 dynamic import 或分支文件）。Core resolver 是 runtime-agnostic，Tauri 专用 adapter 在 `apps/web/src/lib/tauri-skill-install-adapters.ts` 用 lazy `import('@tauri-apps/*')`，Web bundle 不会加载
- [x] 7.3 `apps/web` 下 `apps/web/src/lib/github-tarball.ts`（web-only helper）导出 `fetchGithubTarball(owner, repo, ref?) => Promise<Uint8Array>`，Desktop 路径不引用此文件

## 8. Typecheck + build 串行通

- [x] 8.1 按构建顺序跑 `pnpm --filter @offisim/shared-types build` → `pnpm --filter @offisim/ui-core build` → `pnpm --filter @offisim/core build` → `pnpm --filter @offisim/ui-office build` → `pnpm --filter @offisim/web build`
- [x] 8.2 `pnpm typecheck` 绿（全 26 tasks pass）
- [x] 8.3 `pnpm lint` 绿（Biome）— 本 change 新增文件全部 lint pass；仓库已存在的 102 条 lint errors 与本 change 无关（`git stash` verify）
- [x] 8.4 `apps/web build` 产物 bundle size — **2026-04-20 处理**。原 task 描述"fflate 双份"猜测错了（fflate 已被 `vendor-install` manualChunk 规则统一吸走，skill-install 链条不含 fflate）。真实根因：(a) `OffisimRuntimeProvider.tsx` 用 `await import('@offisim/core/dist/agents/skill-install-tools.js')` dynamic import debug bridge，但 `employee-tool-round` 已 eager 静态引用同一 handler — 两条 ID 不同路径让 rollup 冗余 split 出 `skill-install-tools-*.js`；(b) `browser-runtime` + `tauri-runtime` 两条 lazy 顶点都 eager import `./skill-install-env`，rollup 提成独立共享 chunk（173K / 50K gzip）。改法：(1) OffisimRuntimeProvider 改 eager `import { handleSkillInstallTool } from '@offisim/core/browser'`，消除冗余 dynamic import；(2) `vite.config.ts` manualChunks 追加 skill-install 相关 core 模块 + web 侧 skill-install-env/tauri-skill-install-adapters/github-tarball 合并到既有 `app-install` chunk。结果：`skill-install-env-*.js` + `skill-install-tools-*.js` 两个独立 chunk 消失；`app-install` 15K → 33K gzip（吸收 skill-install 链条）；main `index-*.js` 554K → 544K gzip（-10K）。30K sub-chunk 目标未达（app-install 33K 整包），要继续压需把 `runtimeCtx.skillInstallEnvironment` 字段改成 lazy `() => Promise<SkillInstallEnvironment>` provider，env 只在 LLM 真正触发 skill install tool 时构造 — 属 T2.2+ followup，非本 change scope

## 9. Live verify (agent-native path, 真 runtime)

**所有 9.x 留 `[ ]`** — live verify 需要浏览器 / Tauri 真实 runtime + LLM + 用户 driven chat。本 apply 阶段不承担执行，只写完 live-verify.md 作 archive gate 执行底稿。

- [ ] 9.1 Web MiniMax + 内置 employee → 用户说 "装一下 github.com/anthropics/skills 里的 do-research" → 工具调用 → preview bubble 出 → 看到 SKILL.md 正文 + allowedTools + 源 URL → confirm → skills 表出 company-scope 行、vault 出 `companies/{id}/skills/do-research/SKILL.md`
- [ ] 9.2 Web 对同一员工说 "装到 Alice 那儿" → scope 推成 employee + targetEmployeeId 解析 → preview 显示 `Scope: Employee: Alice` → confirm → skills 表出 employee-scope 行
- [x] 9.3 Desktop Tauri 跑 9.1 重演一遍（git 走 Tauri shell clone）— **verified 2026-04-20**（release `Offisim.app` + Computer Use；`install_skill_from_git({ url: 'github.com/anthropics/skills', subpath: 'skills/frontend-design' })` → `pending-confirm` → `respondToInteraction('confirm')` → `"Skill installed."`；skills 行 `frontend-design|company|installed|git:https://github.com/anthropics/skills#skills/frontend-design|companies/<id>/skills/frontend-design/SKILL.md`；vault 落盘 `~/Library/Application Support/com.offisim.desktop/vault/companies/<id>/skills/frontend-design/SKILL.md`）
- [ ] 9.4 Desktop 用户上传一个 zip（含 SKILL.md + scripts/）→ preview 显示 assets 列表 → confirm → vault 出对应 scripts 文件
- [ ] 9.5 Desktop 用户说 "同步一下 Claude 里关于 review 的 skill" → `sync_from_claude_code` 返全量候选 → LLM 按 filter 挑一个 → 单独触发一个 confirm → 装
- [ ] 9.6 Web 用户调 `sync_from_claude_code` → tool 返 `not-supported-in-web` → LLM 跟用户解释 + 引导切桌面端 / 上传
- [ ] 9.7 **T2.1 deferred 11.8 (path-traversal)**：构造一个 upload zip，包含 `scripts/../../../etc/passwd` 路径项 → preview 阶段允许 LLM 看到，但 confirm → `installSkill` 守卫拒；写 observation
- [ ] 9.8 **T2.1 deferred 11.7 (slug collision)**：先装一个 `do-research` → 再装另一个不同 source 的同 slug → 第二次 preview 可出，但 confirm 拒 + 返回错误给 chat
- [ ] 9.9 **T2.1 deferred 11.9 (cross-scope override)**：先 company scope 装 `email-triage` → 再给 Alice 装 `email-triage` → 给 Alice 出 prompt 时只看到 Alice 那份
- [ ] 9.10 **T2.1 deferred 11.3 (desktop migration)**：Desktop 环境里先塞一个老 `config_json.runtimeSkill` 的员工 → 首次触发 `installSkill` → 观察 migrateRuntimeSkills 同时跑完、marker 写入、新 runtimeSkill 在 employee config 被 strip
- [ ] 9.11 Cancel / timeout 流：触发一次 `install_skill_from_git` 后 cancel → staging 清空、skills 无新行；再触发一次后等 30 分钟过 TTL 模拟 → confirm 返 `staging-expired`
- [ ] 9.12 宽口 pattern 红标：构造一个 SKILL.md `allowedTools: ['bash:*', 'network:read']` → preview bubble `bash:*` 红标，`network:read` 正常；截图入 live-verify record

## 10. Archive 前三查

- [x] 10.1 Spec 一致性：`specs/agent-mediated-skill-install/spec.md` 8 条 requirement 全部落地到代码（tool kit injection / scope LLM-driven / confirm-before-apply / 安全元数据 / git 分叉 / upload 三形式 / sync Desktop-only / 统一 installSkill / 新 kind 类型）。Archive gate 应再核一遍 spec id ↔ code symbol 对齐
- [ ] 10.2 Tasks 一致性：本 tasks.md `[x]` 项全部落到代码 + build + typecheck 均 green。**9.x live verify 全部 `[ ]`** — 待用户在真实 runtime 走。Archive 前须先跑 live-verify.md 或保留 `[ ]` + 写 observation
- [x] 10.3 文档 / 注释一致性：`skill-loader.ts` 保留 runtimeSkill 字样仅在 `installCompanyScopeSkill` 的 wrapper doc 里指涉 marketplace，新增 `installSkill` 作 superset 入口 — 无漂移。`openspec/specs/skills-foundation/spec.md` 未动。CLAUDE.md 本 change 无新 gotcha 必须加（live verify 会暴露是否需要；暂不预写）
- [x] 10.4 协议台账：`openspec/protocols-ledger.md` 的 **SKILL.md** 行 6 已追加 "agent-install 路径已落 2026-04-19"，scope 写清 4 工具 + preview 组件 + committer 的 landing 形态
