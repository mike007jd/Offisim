# 外壳 + 形象 Lane(与 P3 任务板编排并行)

日期:2026-07-12。状态:已拍板,与 `feat/p3-task-board-orchestration` 并行推进,零文件冲突。
上位文档:`2026-07-11-vibe-coding-company-roadmap.md`(行业基线 2026-07-11 已核对,本文不重查)。

## 0. 为什么开这条 lane

P3 session 占用任务板/git/lease/pi_host 全链路(P4 要动 `pi-child-supervisor.mjs`、P5 要动 `git.rs`,均与其未提交改动冲突)。为提速,本 lane 只做导航层级、页面交互、3D 形象品质——恰好是 roadmap 未覆盖的产品外壳债,且全部文件与 P3 不相交。

## 1. IA 拍板(9 surface 深读后的结论)

重复感的三处真凶:

1. Connect 里的 KanbanApp 与 Tasks 任务板概念撞车;
2. Office 左栏 Git/Diff/lease review 本来就 import 自 `tasks/`,两边天然一体;
3. Activity(`agent_events` 事件流)与 Tasks(`agent_runs` run 卡)同源不同粒度,不值得两个顶级入口。

层级方案(board-first,与 P3 拍板一致):

- **Office** = 工作台与指挥中心。舞台 OPEN VIEW 视图槽是核心扩展点(已有 Output/Browser/Preview/Review/Terminal/Files)。
- **Tasks 归 Office**(用户拍板 2026-07-12,推翻此前"独立指挥中心升 primary"方案):Board 作为舞台视图进 Office——项目/全部范围切换、任务卡带「来源会话」回链、事件驱动自动开窗(lease 待审自动弹 Review、出交付物自动亮 Preview)。理由:Office 左栏本就 import tasks/ 的 diff/lease 组件;日常 1-2 个项目撑不起独立顶级 tab;"看公司干活"的心智里任务就发生在办公室。顶级 Tasks tab 过渡期留 utility,Board 视图落地后退场。
- **Activity** 并入同一 Board 区域做时间线视图,顶级位取消(Phase B)。
- **Board 以看板列呈现**(用户拍板 2026-07-12):列 = 状态(排队/运行中/待审查/已合并/失败),卡片上直接暂停/改派/看 diff,拖拽用于插单调序;取代原 Tasks 状态分组长列表。
- **Connect 保持 primary 到 Phase B**:Phase A 只下线与 Tasks 撞车的 KanbanApp,Connect 暂时收敛为 Messenger / Calendar / Contacts。Messenger 并入 Office、议程并入 Board 时间线、Contacts 去重和 Connect 域退场都属于 Phase B/C 的信息模型重构,本 lane 不提前改结构。
- **Market** 降 utility(低频商店)。

最终(Phase A 落地后):primary = Office / Connect / Loops / Personnel;utility = Market / Activity(过渡) / Tasks(过渡) / Studio / Settings。
内部 surface key 不改(`workspace`/`mission` 历史名保留),只动 tier 与呈现。

## 1.5 信息模型(2026-07-12 与用户对齐,待确认「卡 = 需求」)

数据真实层级:会话 → 需求(一条指令 = 一次 root run)→ 子任务(planner 拆分,各有 worktree/diff)。

三个粒度各归其位:

- **看板管需求**:舞台 Board 视图,列 = 状态(排队/进行中/待审查/已合并/失败),**卡 = 需求(root run)**;卡面 = 目标一句话 + 子任务进度(3/5)+ 在岗员工头像 + 来源会话回链。暂停/插单/验收都是需求粒度决策。
- **卡内管任务**:卡片展开 = 需求详情——子任务树(谁在做/状态/diff 入口)、验证结果、Merge/Discard。子任务粒度只在这层出现(Linear sub-issue 式),独立 Tasks 平铺列表页退场。
- **场景管执行**:3D 员工干活 = 子任务活体呈现,双向跳转(卡 ↔ 场景员工)。场景与看板是同一事实的两种镜头;工作视图打开时场景缩驻侧窗/画中画,不消失(硬设计约束)。
- 无委派的单聊小改 = 0/0 子任务的卡,同走待审查→合并。Loops 产生的 run 落同一看板。

**Connect 拆散溶解(取代上一节的"降级观察")**:Connect 实为"聊天 OS + 应用架",产品里套产品是违和感根源。归宿:① Messenger/圆桌 → Office 右栏会话列表加「公司频道」分组(圆桌接 3D 会议室演绎);② Calendar 议程 → 看板时间线视图(与 Activity 合并);③ Contacts → 删(Personnel + TeamDock 已覆盖)。Connect 域整体退场,不设观察期。工程注意:需合并 project chat_threads 与 collaboration_* 两套 thread 存储,真工程,归 Phase B/C。

**修正终局**:primary = Office / Loops / Personnel;utility = Market / Studio / Settings;Tasks/Activity/Connect 三 surface 溶解退场。

## 2. 3D 形象拍板

事实基线:发型已是 8 枚举 → 6 GLB(ponytail/braids 共用 hair_03),Personnel AppearanceTab 已可改但不可见性差;默认按员工 id 哈希确定性随机;2D DiceBear 与 3D GLB 是两套映射。

拍板:**扩库 + 可见可改**。

- 发型 GLB 扩到 12+ 款玩具风低模:8 个枚举各自独立资产,消除共用;新增款式进枚举与两套映射。
- AppearanceTab 加 3D 实时预览;创建向导里外观可见可换(默认仍随机,但用户知道能改)。
- 2D DiceBear `HAIR_STYLE_TO_TOP` 与 3D 映射逐款对齐,头像和场景角色不再对不上脸。

## 3. 分期与分工边界

| Phase | 内容 | 依赖 |
|---|---|---|
| A(本分支 `feat/shell-ia-and-character`) | Market 降 utility;Connect 保持 primary 并下线 Kanban;发型扩库 + 映射对齐;AppearanceTab 预览 + 向导外观 | 无,基于 P2 HEAD |
| B(P3 合入后) | Board 以看板列进 Office 舞台视图(范围切换/来源回链/自动开窗);顶级 Tasks tab 退场;Activity 并入 Board 时间线;Connect 去留按 dogfood 频率定(Messenger 并入 Office 或退场) | P3 merge |

禁区(P3 session 属地,本 lane 不碰):`tasks/` 内部逻辑、`git-workbench`、`lease-manager`、`pi_agent_host/*`、`git.rs`、`WorkspacePanel`、`StageViewer`、`pi-child-supervisor.mjs`。

验收:release-gates node lane 绿 + desktop release build 绿 + release `.app` 截图取证(全款发型、tab 结构、Connect 无 Kanban),美术品质由 lead 看图验收。
