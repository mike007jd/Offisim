# Harness/IDE 下一波 — 任务分解(2026-07-17)

配套 `2026-07-17-harness-ide-wave-execution-plan.md`(排期/门禁)。产品定义以
`2026-07-16-harness-ide-next-wave.md` 为准。全部锚点按 2026-07-17 于 main
HEAD `090848b1` 实探核对(file:line 均为当日证据,开工时如有漂移以代码为准)。

---

## W1 — 改动安全网:checkpoint / rewind

### 现状锚点

- 全仓**无**通用 undo/snapshot 机制;唯一"回滚"= 整棵 worktree 丢弃:
  `DiffPanel.onDiscard` → `workspace-lease-actions.ts` →
  `releaseLease`(`packages/core/src/runtime/mission/workspace/lease-manager.ts:101`)
  → `git worktree remove --force`(`apps/desktop/src-tauri/src/git.rs:151-156`)。
- 事件契约已有占位但**零生产者**:`EngineNativeActivityKind` 含
  `'checkpoint' | 'rollback'`(`packages/shared-types/src/events/engine.ts:9-10`),
  `EngineActivityStatus` 含 `'rolled_back'`(:37)。
- 文件改动不是独立事件:体现为 `tool.started/completed` +
  `classifyToolActivity` 映射 edit/write 类
  (`packages/shared-types/src/events/agent-run.ts:261-262, 304-305`);
  写文件走 `project_write_file`(`apps/desktop/src-tauri/src/builtin_tools.rs:639`)
  与 `bash_execute`(:697)。
- 时间线 UI:`board/BoardStage.tsx`(`lens === 'timeline'`,:420-433)+
  `board/activity-data.ts`(topic-based 事件模型)。
- worktree 白名单:`git.rs` `validate_worktree`(:310)只放行
  `worktree add -b <branch> <path-under-root>`;快照所需 git 子命令需扩白名单。

### 任务

| # | 任务 | 说明 |
|---|---|---|
| W1-1 | 快照引擎(core) | lease worktree 内 git-backed 每步快照:每个文件变更类 tool 完成后自动 commit 到隐藏 ref(`refs/offisim/checkpoints/<lease_id>/<n>`),不污染分支历史;实现挂 `WorkspaceLeaseManager` 旁的纯逻辑模块,git 操作经既有 `GitWorktreeOps` 注入口径 |
| W1-2 | Rust 白名单扩展 | `git.rs` 放行快照/回滚所需的受限子命令(限定在 worktree 根之下、限定 ref 前缀);沿用 `validate_worktree` 的校验风格 |
| W1-3 | 持久化 | baseline `schema.sql` 新增 checkpoint 表(lease_id、step、ref、触发 tool、时间、涉及文件摘要)+ bump `LOCAL_SCHEMA_VERSION`;崩溃重启后从表 + ref 恢复快照链 |
| W1-4 | 事件生产者 | 补齐空契约:快照产生/回滚执行时发 `checkpoint`/`rollback` engine activity(工厂在 `packages/core/src/events/engine-events.ts`),回滚后状态 `rolled_back` |
| W1-5 | 时间线 UI | `activity-data.ts` + `BoardStage.tsx` timeline lens:改动步可见、可展开(涉及文件列表)、一键回滚到任意步;回滚是显式动作 + 二次确认 + 留痕(谁/何时/回到哪步) |
| W1-6 | Stop/失败半成品撤销 | run 中断(Stop/失败)后时间线提供「撤到本轮开始前」快捷动作,复用 W1-1 回滚 |
| W1-7 | AGENTS.md 注入(顺带项) | 员工上下文组装完全不读项目 AGENTS.md(`employee-persona.ts` `buildEmployeeSystemPrompt` :28 只拼 persona 字段,全仓 grep 无命中);经 `project_read_file` 读项目根 `AGENTS.md`,存在则注入会话上下文,超长截断有界 |

### 边界

- 只管项目工作区文件;会话文本归 Pi(session tree),不碰。
- 不引入自研版本存储,一切 git-backed。
- 回滚只影响 lease worktree,不动主工作树。

### live 验收

员工改错 3 个文件 → 时间线选中第 N 步回滚 → 文件系统与 UI 一致;
强杀 app 重启后快照链不断、仍可回滚;项目根放 AGENTS.md,员工行为遵循其中约定。

---

## W2 — 审阅工作台(等 #58 合入)

### 现状锚点

- `board/DiffPanel.tsx`:纯展示,按 `+`/`-`/`@@` 前缀着色(:56-70),
  props `files: Array<{path; diff}>`,reviewable 仅当 `pending_review`。
- diff 数据源:`data/git-workbench.ts` 经 `invokeCommand('git_exec')`(:54)跑
  `git diff --numstat -z` / `--unified=3 -- <path>`(:255-266),原始 unified 文本。
- 三处父组件:`WorkspacePanel.tsx:883`(lease 审阅,带 Merge/Discard/
  RequestChanges)、`StageViewer.tsx:1108/:1147`(只读预览)。
- PR 闭环:`gh.rs` `gh_exec`(:87)白名单仅 `pr create`(:32)。

### 任务

| # | 任务 | 说明 |
|---|---|---|
| W2-1 | diff 结构化解析 | unified 文本 → 结构化模型(文件/hunk/行,增删统计);解析放 renderer 数据层(git-workbench 旁),DiffPanel 消费结构化模型 |
| W2-2 | 审阅台布局 | 文件树分组侧栏 + unified/split 双模式切换 + hunk 级展开折叠;大 diff 用 TanStack Virtual;替换三处调用点,只读场景降级只读态 |
| W2-3 | 批注即 steer | hunk/行上写批注 → 汇总为对该员工的 steer 修改指令(走 #58 合入的 steer 语义);员工修完回来 diff 刷新、批注标记已处理 |
| W2-4 | 逐文件/逐 hunk 采纳打回 | 采纳 = 该部分进入合并集,打回 = 转批注;部分采纳的落地机制(git apply 级操作)需扩 `git.rs` 白名单,限定 lease worktree 内 |
| W2-5 | PR 闭环衔接 | 审阅完成 → 既有 `gh_exec pr create` 通道,PR 描述预填自审阅摘要 |

### 边界

不做完整代码编辑器——人只审阅和批注,修改永远由员工执行(agent-agnostic GUI 准则)。

### live 验收

一张需求卡产出 10+ 文件变更:split 视图审阅、两处批注打回、员工修完回来、
逐文件采纳、建 PR 成功。

---

## W3 — LSP 诊断回喂(无前置,可并行)

### 现状锚点

- 验证回路 = Mission 评估器 + attempt 重试:`command_exit_zero`
  (`packages/core/src/runtime/mission/evaluators/builtin.ts:65`)、
  重试驱动 `mission-run-manager.ts`(:73/:122-126)、`attempt_cap`(:255-256)。
- **无任何 LSP**;当前诊断 = 全量跑命令。
- Pi extension 缝:`apps/desktop/src-tauri/src/pi_agent_host/`
  (`mod.rs:82` 构造路径注释;`payload.rs:65` skillPaths 注入先例)。
- 中性事件构造:`desktop-agent-runtime.ts`(:436, :708)。

### 任务

| # | 任务 | 说明 |
|---|---|---|
| W3-1 | language server 管理器 | 按语言自动检测/启动(opencode 模式:优先项目自带,如 node_modules 里的 typescript-language-server);生命周期随会话,失败静默 |
| W3-2 | 改动→诊断触发 | 员工文件变更类 tool 完成后对该文件拉取诊断(增量,不等整仓 build) |
| W3-3 | 回喂员工 | 诊断经中性事件进下一轮上下文,员工自动修复;放 Pi extension 缝,不动 Pi agent loop |
| W3-4 | 审阅台标记 | 诊断标记进 W2 审阅台(W2 未合入时先进现有 DiffPanel/时间线的轻量展示) |
| W3-5 | 静默降级 | LSP 不可用回退现有 loop-until-green 全量检查;**不加任何配置项**,不出错误弹窗 |

### live 验收

员工引入一个类型错误,不跑 build 即在下一轮自动修复;删掉 language server
后同场景仍经全量检查兜住,全程无报错打扰。

---

## W4 — 全局搜索(无前置,可并行)

> **当前纠正(2026-07-23):** W4 最终索引的是 `agent_runs`,不是下文早期规划里的
> `task_runs`。`task_runs` 已从 fresh prelaunch baseline 删除；下文保留为规划历史。

### 现状锚点

- cmdk 已就位:`design-system/primitives/command.tsx:2` +
  `app/CommandPalette.tsx`(消费者含 App.tsx、ComposerTriggers 等)。
- 本地库 `packages/db-local/src/schema.sql`(v6),Rust `local_db.rs`
  `include_str!`(:12)+ `apply_schema`(:266)。
- 数据落表:会话 `chat_threads`(:369)/`pi_messages`(:740)/
  `agent_events`(:388)/`collaboration_messages`(:892);需求卡
  `task_runs`(:154)/`agent_runs`(:169);产出 `deliverables`(:528)。
- **FTS 全仓为零**,现有搜索是 JS 侧字符串匹配。

### 任务

| # | 任务 | 说明 |
|---|---|---|
| W4-1 | FTS5 虚表 | baseline `schema.sql` 加 FTS5 虚表 + 同步 trigger(索引:pi_messages 内容、chat_threads 标题、task_runs objective、deliverables 名称/路径)+ bump `LOCAL_SCHEMA_VERSION`(prelaunch:旧库直接弃,无迁移) |
| W4-2 | 查询命令 | Rust 侧新增窄查询命令(输入 query,输出分类结果+定位信息),沿用 sandboxed 命令风格 |
| W4-3 | 全局搜索 UI | CommandPalette 扩搜索模式:分组结果(会话/需求卡/产出),键盘导航 |
| W4-4 | 直达定位 | 点结果直达对应会话位置/需求卡/产出预览(会话内定位到消息) |

### 边界

本地索引,不出网;diff 正文索引体量大,首版只索引文件名与摘要,diff 全文列为
后续观察项。

### live 验收

搜三天前某次会话里的函数名,3 秒内直达该会话对应位置。

---

## W5 — best-of-N 比稿(等 W2 + 引擎返工合入)

### 现状锚点

- 数据模型是**一卡一员工一 lease**:`task_runs.employee_id`(`schema.sql:156`)、
  `agent_runs.employee_id`(:184)单值;返工复用同 worktree 同 assignee
  (`WorkspacePanel.tsx:892, 908`)。
- 已有地基:父子并行 delegation(`maxParallelPerDelegation`,
  `mission-run-controller.ts:97`)、run 树(`parent_run_id`/`root_run_id`,
  `schema.sql:172-176`)、worktree 隔离(lease-manager)、
  `mission_attempt` 串行重试(:789)。
- gateway 缝已合入:`RuntimeEngineCapabilityMatrix`
  (`packages/shared-types/src/models.ts:74`)+ engine 事件契约。

### 任务

| # | 任务 | 说明 |
|---|---|---|
| W5-1 | 数据模型扩展 | 需求卡支持比稿组:一卡 → N 个平行 attempt(各绑独立员工 + 独立 lease/worktree);baseline schema 加比稿组关联 + bump 版本 |
| W5-2 | 派单 UI | 卡上「比稿」动作:选 2-4 名员工(可跨引擎,Pi vs Codex 同题),并行开工;复用 delegation 并发预算 |
| W5-3 | 并排比较视图 | W2 审阅台扩比较模式:各方案 diff 摘要 + 验证结果 + token 规模并排;逐方案深入审阅 |
| W5-4 | 择优合入 + 清理 | 选中方案走既有 merge/PR 闭环;落选 lease 自动 release、worktree 清理无残留(复用 `releaseLease`) |

### live 验收

一张卡派 3 名员工(至少一名外部引擎),并排审阅三方案,采纳其一建 PR,
其余清理后 `git worktree list` 与磁盘均无残留。

---

## W6 — 员工记忆成长(后置)

**开工前先出需求细化包给用户过目,不直接写码。** 细化时需回答:记什么
(踩坑/仓库偏好/惯用约定)、何时写入(run 收尾提炼?)、存哪
(员工档案表 vs vault 文件)、如何注入(persona 组装缝,锚点
`employee-persona.ts:28`)、档案页「资历」如何呈现与编辑删除。W5 落地后启动。

---

## W7 — Skills 互通

### 现状锚点

- 注入链完整:`skillPathsForEmployee`(`employee-persona.ts:215`)→
  `absoluteVaultSkillPath`(:150,强制 `/SKILL.md` 结尾)→
  `desktop-agent-runtime.ts` → Rust `pi_agent_host/types.rs:44`
  (`skill_paths`)→ `payload.rs:65`(`skillPaths` 进 Pi payload)。
- skills 表:`schema.sql:579`(`vault_path` 列,vault 根来自
  `runtime_vault_status`)。
- 项目目录读取:sandboxed `project_list_dir`(`builtin_tools.rs:584`)等。

### 任务(进口侧无前置;出口侧等引擎返工合入)

| # | 任务 | 说明 |
|---|---|---|
| W7-1 | 进口:项目技能发现 | 打开项目工作区自动扫 `.claude/skills/`、`.agents/skills/`、`.opencode/skills/`(经 sandboxed `project_list_dir`,不新开任意路径通道);发现的 SKILL.md 作为「项目技能」进技能清单,与公司/员工技能并列 |
| W7-2 | 进口:注入生效 | 项目技能路径并入 skillPaths 注入链;`absoluteVaultSkillPath` 只服务 vault 路径,项目技能走平行的项目根解析(同样强制 `/SKILL.md` 结尾校验) |
| W7-3 | 出口:外部引擎带技能 | 员工技能对编排引擎生效:按各引擎标准技能目录/参数带进会话(引擎 adapter 内实现,依赖 #57/#69 返工后的 adapter 形态);frontmatter 与开放标准无损对齐 |
| W7-4 | 呈现 | 技能清单区分来源(公司/员工/项目),项目技能只读(真相在项目仓库里) |

### 边界

不读全局 `~/.claude/skills/`(来源混淆);技能进 Market 留远期。

### live 验收

项目里放一个 Claude Code 格式技能:Pi 员工与 Codex 引擎员工各派一单,
双方都按该技能行事。
