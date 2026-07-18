# 下一轮 Roadmap:从功能完备到日常可用(2026-07-18)

背景:harness/IDE 七波(W1-W7)已全部合入,对照 2026-07 行业线标配无缺口、
差异化(比稿/记忆/公司叙事)领先。但用户当日实机使用五分钟即遇启动 crash
(老 build 撞新库)与舞台顶栏 tab 遮挡——**能力完备 ≠ 日常可用**。本轮主题:
把 Offisim 从「演示可跑」推到「作者自己每天用它干活」。

排序原则:每一单都以「用户当天真实使用中会撞到什么」为准,不再新增大能力。

## R0 — 即时修复(本轮开工前已派单,不占排期)

- 启动 crash 根治 + 新 build 装回 /Applications(正式 Developer ID 签名)。
- 舞台顶栏信息架构梳理:tabs 区与状态簇硬分区,零遮挡。

## R1 — 全面 UI/UX 审计清算(本轮头牌)

顶栏遮挡不会是孤例:七波高速合入后必然存在布局挤压、信息密度失衡、
文案机械、视图间不一致。做一次**全 surface 的 UI/UX 审计**
(Office 全视图 / Personnel / Market / Studio / Settings / Loops),
产出 findings 清单→逐项修复,合并清算既有 9-bucket UX queue(21 项旧账)。
验收:审计报告 + 全部 confirmed findings 修复 + 全视图前后对比截图。

## R2 — 分发就绪(签名/公证/更新/崩溃可观测)

今日 crash 暴露的系统性缺口:用户装在 /Applications 的 app 会过期、
会崩、崩了无诊断。一揽子:
1. release 流程接入正式 Developer ID 签名 + notarization(凭据走环境变量/
   keychain,严禁入仓)。
2. Tauri updater 自动更新通道:发版后 /Applications 的 app 自己升级,
   根治「老 build 撞新库」这一类时间差故障。
3. 启动失败自救:任何启动期异常不得 abort——降级进入安全模式并一键导出
   诊断包(连既有「诊断可导出,用户最多复现 1 次」纪律)。
验收:旧版本 app 在线升级到新版全程无人工;人为注坏库,app 进安全模式
并导出诊断而非崩溃。

实现记录:方案与凭据边界见
`Docs/architecture/2026-07-18-distribution-readiness.md`;验收证据固定写入
`~/.dev-dispatch/evidence/offisim/r2-distribution-2026-07-18/`,以 Draft PR
中的实测事实为最终状态,不得用 localhost 或 dev webview 代替。

## R3 — Onboarding 首跑(backlog 转正)

新玩家(以及未来的真实用户)打开 app 的前 5 分钟:建公司→雇第一名员工→
配好引擎(Pi provider 或检测到的 Codex)→派第一张需求卡→看到全程演绎→
拿到第一个产出。缺一步都算失败。空状态全部有引导,不再出现「空白 + 术语」。
验收:清库冷启动,按引导 5 分钟内完成第一单(实机计时)。

实现记录(2026-07-18):`PASS`。release `.app` 清库启动后沿向导完成建公司、
雇员、选用已登录 Codex CLI、派单、舞台/时间线演绎与 `FIRST_WIN.md` 产出，
从进程启动到 6/6 收尾共 270 秒。跳过、公司/Project/Personnel/Conversation
空状态回入口均已验证；原 `~/.offisim` 在两轮 live 验收后恢复。完整报告见
`Docs/live-verify-report-2026-07-18-r3-onboarding.md`，证据固定在
`~/.dev-dispatch/evidence/offisim/r3-onboarding-2026-07-18/`。

## R4 — Chat 附件端到端(backlog 转正)

会话里拖入/粘贴文件与图片→员工真实读到→产出可溯源。跨 composer/runtime/
wire/宿主/引擎五层,#72 已带原生多模态附件地基,本单补 UI 与全链打通。
验收:拖一张设计稿截图给员工,员工按图实现;附件在时间线与产出溯源可见。

实现记录(2026-07-18):composer 已具备原生拖入、图片剪贴板粘贴和文件选择器
三入口,附件经会话级受控 vault 落地;图片按引擎能力走多模态,文本/代码在有界
截断后进入员工上下文。Pi 与 Codex CLI 已完成 release `.app` 实测消费,Codex
`fileChange` 通过受 workspace sandbox 复核的相对路径落为 deliverable,Outputs 将
产出 run 关联回来源附件。超大文件与非白名单类型在发送前有界拒绝。验收证据:
`~/.dev-dispatch/evidence/offisim/r4-attachments-2026-07-18/`。Computer Use 当前
不支持跨 App 拖拽,因此图片 live 走剪贴板粘贴;原生 drop 入口由 release 代码与
附件 round-trip harness 覆盖,未用 localhost/dev webview 充当桌面验收。

## R5 — 差异化深化(小单,连叙事)

1. 比稿混编实机:Pi + Codex 员工同题比稿的 live 场景补拍(W5 观察项闭环)。
2. 记忆连人设:员工资历(完成数/比稿战绩/经验数)反映到形象与称号
   (Junior→Senior 之类),玩具化叙事闭环。
验收:混编比稿截图;老员工与新员工在场景与档案页可视差异。

实现记录(2026-07-18):`PASS`。同一需求卡已在 release `.app` 由 Pi API
员工与 Codex CLI 员工并行比稿,比较视图并排显示各自引擎、token、时长和文件
差异;采纳 Pi 方案后完成合并,Codex 落选 worktree 与分支均清理,项目根目录无
残留。Pi 混编断点已在编排根因处修复:竞争任务只写各自隔离 worktree,Pi 子任务
完成后由 Offisim 统一捕获待审方案,根运行接受已验证的真实子运行身份,不再要求
子引擎自行提交或把子运行误判成来源串线。员工资历不新增记账,只按既有统计
确定性推导:`完成任务数 + 比稿胜场 × 2 + 经验条目数`,0–2 为 `Level 1 ·
New hire`,3–7 为 `Level 2 · Team regular`,8+ 为 `Level 3 · Senior hand`。
Personnel 列表、档案/经验页与 2D/3D 场景 hover 均已接入。完整报告见
`Docs/live-verify-report-2026-07-18-r5-depth.md`,证据固定在
`~/.dev-dispatch/evidence/offisim/r5-depth-2026-07-18/`;原 `~/.offisim` 已恢复。

## 暂不做(明确出清)

- Market 技能包/培训课程(等技能生态有真实内容再议)。
- Scene V2 / 移动遥控 / cloud agent(定位未变)。
- 主 chunk 1.7MB 性能债(R1 审计顺手评估,不单开)。

## 排期与依赖

R1 与 R2 并行开工(互不相交);R3 等 R1 收尾(引导要基于梳理后的 UI);
R4 独立可随时插;R5 最后。全部延续:需求真相源文档 → Codex 派单 →
五层漏斗 → live 证据 → Draft PR → 用户批 merge。

## 收官记录(2026-07-18 当日全轮交付)

| 单 | PR | 合入 |
|---|---|---|
| R0 crash 根治 + 装公证 rc.2 | 无代码改动(部署) | — |
| R0 顶栏 tabs/状态分区 | #83 | `4926deb8` |
| R0 追加:状态簇整体驱逐出 tab 行(用户铁律) | #86 | `0cdaec4d` |
| R2 分发就绪(签名/公证/更新/安全模式) | #84 | `c7035fcd` |
| R1 全 surface 审计清算(58 findings→45 修) | #85 | `875bf29e` |
| R3 Onboarding 首跑(270s 到首产出) | #87 | `dbe78dbc` |
| R4 Chat 附件端到端 | #88 | `553946cc` |
| R5 混编比稿闭环 + 资历称号 | #89 | `d9eee260` |

**本轮关闭。** 出清项(Market 课程/Scene V2/chunk 债)与后续候选留待下轮规划。
