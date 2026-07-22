# Harness/IDE 下一波 — 执行计划(2026-07-17)

需求真相源:`2026-07-16-harness-ide-next-wave.md`(W1–W7 产品定义)+
`2026-07-16-engine-lane-correction.md`(引擎两层模型 8 项共识)。
任务分解见配套 `2026-07-17-harness-ide-wave-tasks.md`。
本文只管**排期、依赖门、派单方式、质量纪律**。

## 0. 开工前置(当前 train 收尾,由合入线程负责,本计划不重复做)

按 2026-07-17 合入计划,剩余顺序:引擎返工(#57 重定向 / #59 打回改造 /
#69 重做)→ 段 B(#60/#61/#63/#64/#65/#66)→ 尾段(#67/#70)→ #58。
新波次一律**等 train 收尾后**从干净 main 开工,避免与在飞分支冲突。

依赖事实(checked 2026-07-17):#50–#56、#68 已合入 main——W1 的前置
#53/#54 已满足;W5/W7 出口依赖的 gateway 缝(#55/T05)已在 main。

## 1. 波次排期(依赖驱动的三个批次)

### 批次 1 — train 收尾后立即开工(三单可并行,互不相交)

| 单 | 内容 | 前置 | 大小 |
|---|---|---|---|
| **W1** 改动安全网 checkpoint/rewind(+AGENTS.md 注入) | #53/#54 ✅ 已合入 | 大 |
| **W3** LSP 诊断回喂 | 无 | 中 |
| **W4** 全局搜索(FTS5 + cmdk) | 无 | 中 |

W7 进口侧(项目技能自动发现)也无前置,体量小,归入批次 1 第四单或
挂在 W1 单里(两者都动项目工作区读取通道,由派单时定,不合进同一 PR)。

### 批次 2 — 等 #58 合入

| 单 | 内容 | 前置 |
|---|---|---|
| **W2** 审阅工作台(DiffPanel → 一等审阅面 + 批注即 steer) | #58(steer 语义)合入 |
| **W7 出口侧** 员工技能对外部引擎生效 | 引擎返工(#57/#69 新口径)合入 |

### 批次 3 — 等批次 2

| 单 | 内容 | 前置 |
|---|---|---|
| **W5** best-of-N 比稿 | W2 审阅台比较视图 + 引擎返工合入 |
| **W6** 员工记忆成长 | **先出需求细化包给用户过目,不直接写码**;W5 落地后启动 |

## 2. 派单方式

- 每个 W 一条独立分支 + **Draft PR**,PR body 写事实与证据,不写营销话术;
  merge/close/删分支一律归用户。
- 执行按 dev-dispatch 路由:Codex CLI(gpt-5.6-sol,effort high;computer use
  medium),长任务经 codex-dispatch.sh 托管(setsid 脱会话 + resume 续跑)。
- 每单开工先读需求真相源两文档 + 任务分解文档对应节;与文档冲突时以文档为准,
  文档自身有误则先回报再动。

## 3. 每单质量漏斗(五层,延续现行纪律)

1. 实现(完整产品行为,prelaunch ≠ MVP 偷工)。
2. `/simplify` 收敛该单 diff(lead 亲自)。
3. `codex:review`(禁 token 巨贵的 code-review workflow)。
4. findings 逐条核实:确认的修掉,by-design 的写明理由拒掉。
5. gate 重绿 + live 证据:
   - `pnpm --filter @offisim/desktop-renderer typecheck && build`
   - `node scripts/release-gates.mjs --lane=node`(validate 超集;
     日志 `>log 2>&1` 且显式查退出码)
   - live 验证只认当前 worktree 的
     `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`,
     dev webview 不算;截图/日志证据路径写进 PR body。

## 4. 硬规则(每单都适用)

- **Prelaunch**:不写迁移、不留兼容层;改 schema = 改 baseline `schema.sql` +
  bump `LOCAL_SCHEMA_VERSION`,旧本地库直接弃。
- **GUI agent-agnostic**:通用能力走 `DesktopAgentRuntime` 缝 + 中性事件;
  引擎特有逻辑放各引擎 adapter,不堆 GUI。
- **凭据隔离**:外部 CLI 凭据归其自管;渲染层/日志/诊断不得接触或持久化;
  Pi 凭据在 `~/.pi/agent/`,Offisim 只做安全摘要。
- **Pi wire 双侧**:Pi host wire 加字段必须 Rust `sidecar_payload` 转发 +
  Node `payload.*` 读取双侧齐全,并重建 `pi-agent-host.mjs` bundle。
- **项目文件访问**只走 sandboxed Tauri 命令(`project_list_dir` /
  `project_read_file` / `project_preview_meta` / `project_read_file_bytes`),W7 进口侧不得新开
  任意路径读取通道。
- **每单动手前** GitNexus `impact` 查改动符号的爆炸半径,提交前
  `detect_changes` 核对影响范围。

## 5. 交付记录(2026-07-17 批次 1+2 收官)

| 单 | PR | 合入 | 说明 |
|---|---|---|---|
| W3 LSP 诊断回喂 | #79 | `10456a44` | 三 live 场景全过(增量诊断/静默降级/时间线标记) |
| W4 全局搜索 | #76 | `ad0e1e70` | FTS5+cmdk,直达 <1.5s;schema v15 |
| W1 checkpoint/rewind + AGENTS.md | #77 | `54b793fe` | 审计返工:时间线人话化;merge-main 时 schema 抬 **v16**(与 W4 的 v15 撞版本,重置检测只比版本号) |
| W2 审阅工作台 | #80 | `36984107` | 审计返工:审阅台从左栏窄版改入驻中央 Stage(三面板);批注即 steer/逐 hunk 采纳全链 live 过 |
| W7 Skills 互通 | #78 | `4274deda` | 进口+出口一单交付;wire v12(projectSkillPaths);Pi 与 Codex 员工同技能 live 双过 |

| W5 best-of-N 比稿 | #81 | `bc8168c9` | 比稿组 schema v17 + 2-4 人派单 + 并排比较 + 择优合入/落选清理;wire v13;live 三 Codex 员工全链过 |
| W6 员工记忆成长 | #82 | `7c923aa7` | 需求包(同目录 2026-07-18-w6 文档)用户过目后实现;员工×项目经验 schema v18、自动提炼+脱敏、persona+overlay 双路注入(wire v14)、档案页 Experience 区;五 live 场景全过 |

运维教训:①Offisim 是 Tauri 单实例,GUI 验收必须整机串行;②共享 `~/.offisim` 在多分支验收间要清库重建;③并行分支同时 bump schema 时后合者必须再抬版本;④外部模型容量瞬断用显式 session resume 无损恢复。

**W1-W7 七波全部交付合入(2026-07-18 收官),本 roadmap 关闭。**

## 6. 验收总闸(全波次收官后)

- 逐 W 核对 roadmap 文档里的 live 验收场景全部有实机证据。
- `dead-code-and-docs-cleanup-loop` + `ui-ux-audit-loop` 各跑一轮。
- 更新 `Docs/FEATURES.md` 与本文档的交付表。
