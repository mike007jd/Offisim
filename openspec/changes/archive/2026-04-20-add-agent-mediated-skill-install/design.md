## Context

T2.1 把 skill 做成一等资产，但"进货通道"只开了 Marketplace。用户在 chat 里跟员工说一句话就把外部 skill 装进公司/自己，是 2026 年 agent 产品的通用 UX（Hermes / Claude Code / OpenClaw / Codex 都这么做），也是 Offisim 1.0 roadmap 的 T2.2。T2.1 遗留的 4 条 deferred live verify（path-traversal / slug collision / cross-scope override / desktop migration）在这条 change 里天然会被跑到，不用单独再开一条。

落地约束：
- Web 浏览器跑 + Tauri Desktop 跑，两侧 bundle 不能互相引入对方的 native 依赖
- 1.0 口径 "Market 只自家生态"，不接 agentskills.io / skills.sh 外部 registry
- 不执行 scripts（sandbox 不在 T2.2 scope）
- 所有员工都能装，不按 role 分；精细化权限留 T2.7
- OpenClaw 2026-01 事件教训：任何 skill 落盘前必须有强制 preview + 用户显式 confirm，不能让 LLM 直接写 vault

## Goals / Non-Goals

**Goals:**
- Chat 里一句自然语言 → 员工工具调用 → 源 fetch → preview bubble → 用户 confirm → skill 落地；整条链路是产品主路径
- 4 种源（git / 上传 / Claude Code 本地 / Codex 本地）统一走 `SkillLoader.installSkill` 入口，不让 4 份写 IO 代码散落
- Security boundary 清晰：工具 handler 只做 fetch + stage，不碰 vault；确认后的 commit handler 才跑 tier-3 守卫 + 落盘
- 顺道让 T2.1 的 4 条 deferred scenario 被真实触发，live verify record 里统一勾掉

**Non-Goals:**
- 不做 Market Scout 专职员工（用户已澄清）
- 不做 scripts sandbox 执行能力
- 不做外部 registry 对接
- 不做 workstation-scoped install 权限（留 T2.7）
- 不改 Marketplace 的 publish / install 语义（`installCompanyScopeSkill` 降级成 wrapper，签名不变）
- 不改 T2.1 canonical spec（skills-foundation）任何 requirement

## Decisions

### 1. Scope 推断走 LLM 而非 UI selector

**Decision**: `scope: 'company' | 'employee'` 做成 tool 参数，默认 `'company'`，`targetEmployeeId` 可选；LLM 从用户话里推断并填。UI 不做 scope 选择器。

**Why**: agent-native 产品抓手在"说话即意图"。加 UI selector 意味着每次装 skill 都要弹一个 dialog，用户反而要学新界面；LLM 已有足够能力从"装给 Alice"判断 scope。Preview bubble 里**显示**最终 resolved scope + employee name 做 sanity check，但选择权在 LLM，修正由用户在 chat 里下一句话完成。

**Alternatives considered**:
- B: UI 弹 scope selector — 否。违反 agent-native 方向，增加 UX 层级
- C: 后端从 user message 文本正则识别 — 否。脆弱，LLM 比正则强

### 2. 工具只 stage + 出 interaction，不写 vault

**Decision**: 4 个工具的 handler 做 fetch + skill-scanner 校验 + 构造 preview payload + emit `skill_install_confirm` interaction；返回给 LLM 的 tool 结果是 `{ status: 'pending-confirm', interactionId }`。真实 `installSkill` 只在 interaction response 是 `'confirm'` 时才执行。

**Why**: 两层保护：
1. 没有 user confirm 就没有 vault 写入 — 防止 LLM prompt injection 或误操作
2. tool handler 可以 live 在 worker / HTTP context 里，写盘动作集中在 confirm handler 里调 SkillLoader，职责清晰

Interaction 复用现有 `InteractionRequest` 通道，跟 PlanReview / Permission 共享 chat bubble 生命周期和 boss_proxy / human_in_loop 模式切换；不引入新 ceremony。

**Trade-off**: stagingRef 需要一个 server-side 的临时存活机制（进程内 map / tmp 目录）。采用 in-memory `Map<stagingRef, StagedPayload>` + 30 分钟 TTL，过期自动 GC；上传源的 tmp 文件挂在同一个 GC 上。超时用户再 confirm → 返回 `staging-expired` 错误，LLM 引导用户重新触发工具。

### 3. Git 源 Web / Desktop 分支

**Decision**: Desktop 用 Tauri shell 白名单里的 `git clone`，支持任意 URL；Web 只允许 `github.com` 走 tarball API 解压。

**Why**:
- Web bundle 不能引入 isomorphic-git（~400 KB + WASM），违反 1.0 体积目标；GitHub tarball 是免认证 + 免 git 的原生 HTTP
- 非 GitHub 的 web 场景直接返回结构化错误，让 LLM 跟用户说 "请在桌面端装 / 请贴 GitHub URL"，不假装支持

**Alternatives considered**:
- isomorphic-git 统一方案 — 否，bundle cost 不值
- Backend proxy — 否，Offisim 无托管后端，违反 BYO-key + local-first 产品定位

### 4. Upload 源统一走 `fflate`

**Decision**: zip / tar.gz 都用 `fflate`（web + desktop 共用），单 SKILL.md 直通。多 SKILL.md 的包返回 `upload-multiple-skills` 让 LLM 再问用户。

**Why**: `fflate` 已是 ui-office 依赖（doc-engine 导出用），不新增包；纯 TS 无 native 依赖，两端无分叉。tar.gz 要先 gunzip 再 untar，这一步 `fflate` 也够用。

### 5. Claude Code / Codex 同步在 Web 下直接返回 `not-supported-in-web`

**Decision**: Web runtime 没有 `~/.claude/skills/` 访问能力（FSAccess 不给 home dir），工具 handler 直接返 `{ kind: 'not-supported-in-web' }`；不尝试在 Web 假装实现。

**Why**: Web 场景用户通常跟 desktop 处理能力不同，与其做半残实现（比如让用户手动上传一包 Claude skill），不如把边界讲清楚，让 LLM 引导用户切 Desktop 或换 upload 路径。

### 6. Preview bubble 展示 SKILL.md 正文 + allowedTools 红标

**Decision**: `SkillInstallConfirmBubble` 渲染：skill name + description + allowedTools（宽口 pattern 红标）+ 源 URL/path + 可折叠 SKILL.md 正文 preview + 资产相对路径列表 + 最终 scope/employee。

**Why**: OpenClaw 事件核心教训 = 用户"没看清就装了"。把用户有可能不看的关键安全信号（allowedTools 宽口、源可疑 URL）做视觉 escalation，而不是把 confirm 做得更麻烦。Markdown 正文折叠默认收起，避免长 skill 撑爆 chat，但点击可展。

### 7. `SkillLoader.installSkill` 作为唯一 mutation 入口

**Decision**: 新加 `installSkill({ scope, companyId, employeeId?, source, files })` 作为所有 skill 写入的唯一入口；`installCompanyScopeSkill` 降级为 wrapper，签名 / 副作用语义 / 返回值**不变**（保持 Marketplace 代码零改动）。

**Why**:
- 写路径集中 = tier-3 守卫 / slug 冲突 / write-through order 只在一处维护，避免散落
- 保 Marketplace 签名不变 = 减小 T2.2 的 blast radius，`add-external-employee-install-entry` 和其他 installer 都不需要同步改
- 未来 T2.3+（fork / self-create / peer-transfer）自然也走这个入口

### 8. 顺路收 T2.1 deferred verify，不新加 scenario 到 skills-foundation

**Decision**: 4 条 deferred（path-traversal / slug collision / cross-scope override / desktop migration）在 T2.2 live verify 阶段真实触发：
- path-traversal：构造恶意 upload 包含 `scripts/../../../etc/passwd` 引用 → `installSkill` tier-3 守卫拒
- slug collision：装两次同 slug 不同 source → 第二次拒
- cross-scope override：company 装一个 `email-triage` + 给 employee e7 装一个 `email-triage` → 给 e7 出 prompt 时只看到 employee 那份
- desktop migration：Desktop 首次启动 + 老 `config_json.runtimeSkill` 存在 → 首次装任意 skill 触发 `onVaultReadyForSkills` → migrateRuntimeSkills 跑完写 marker

这 4 条在 T2.1 spec 里已经**有** scenario，只是 T2.1 live verify 没跑到。T2.2 天然 trigger 到，archive 时把证据写进 `live-verify.md`。**不改 T2.1 canonical spec**。

## Risks / Trade-offs

- [StagingRef TTL 过短导致用户 confirm 迟到] → 默认 30 分钟 TTL，chat bubble 展示 "Valid until HH:MM"；过期后 confirm 返回结构化错误让 LLM 引导用户重来
- [Web Github tarball API 有 rate limit（60/h 未认证）] → Web install 是低频动作，单次触发一个 request，rate limit 命中时返 `{ kind: 'github-rate-limited', resetAt }` 让 LLM 转告用户等
- [LLM 幻觉 `targetEmployeeId` 填错]（填成不存在的 id 或跨 company 的 id） → 在 tool handler 用 repo 校验，返 `target-employee-not-found`；preview bubble 上最终展示 resolved employee 名字做二次人肉 sanity
- [Upload 源 staging 用 in-memory map 在 Desktop app 重启后丢失] → T2.2 只支持 session-scoped staging；重启后用户重装即可（低频+可重试场景）。未来若变高频，升级到 vault-staging 区
- [Skill 装完后 LLM 还想再次推荐同一个技能做 install] → Marketplace 已解决 idempotent（`source_kind='installed' + source_ref`）；agent 路径按 `source.kind + source.ref` 计算 dedupe key，同 URL/path 再装走"already-installed"返回，不重复开 interaction
- [Desktop 的 Tauri shell git 命令被用户 ssh-agent 拦截] → clone 失败时原样把 stderr 回给 LLM，不做"静默忽略"；用户自己决定是否切 HTTPS / 先 ssh-add
- [T2.1 confirmed deferred（desktop migration）在 T2.2 runtime 同时触发 installSkill 和 runtimeSkill migration，两个路径抢 skills 表写锁] → Migration 在 vault ready 事件里同步跑完再释放，`installSkill` 等 vault ready；SQLite WAL 下单 writer 串行化本就保证原子性。写 log 记录先后顺序，live verify 跟进观察

## Migration Plan

- 无数据迁移：`skills` 表结构不变，只新加一种 `source.kind` 字面量被接受（`'git' | 'upload' | 'claude-code' | 'codex'`）— 这些值只出现在 `skills.source_ref` 的文本内，`source_kind` 列继续是 `'authored' | 'installed' | 'forked' | 'synthesized'` 之一，agent-install 走 `'installed'`
- `installCompanyScopeSkill` 保持签名 + 返回值不变：Marketplace 调用点零改动；内部重构成 `installSkill({ scope: 'company', source: { kind: 'marketplace', ref: listingId }, ... })` 的 wrapper
- `InteractionKind` union 扩展：只加不删 / 不改名，所有现有 `switch (kind)` fallback 到 default 的分支保持兼容
- Rollback：直接 revert commit 即可；`installSkill` wrapper 撤回后 `installCompanyScopeSkill` 回到独立实现，不遗留 schema / 数据痕迹

## Open Questions

（propose 阶段冻结如下；apply 阶段若反证再回来修）
- **Staging 目录放哪？** Desktop 用 Tauri `tempDir()` 下的 `offisim-skill-staging-<ref>/`，进程退出前 GC；Web 用 in-memory（不落盘）。→ 决议落 apply 阶段 tasks.md
- **`sync_from_claude_code` filter 语义** = LLM 自己按 description 做 substring 匹配（resolver 返全量）还是 resolver 也跑一道？→ 选 LLM 过滤，resolver 返全量最多 50 条；超 50 返 `sync-too-many-candidates` 让 LLM 要求用户加 filter。这条放 apply 阶段 tasks 决议
- **SSH git URL 的 Tauri shell 白名单范围** = 让 `git` + `git-lfs` 白名单化，还是只 `git`？→ T2.2 只允 `git`，`git-lfs` 不 support（资产通常不大，LFS 是低优先）
