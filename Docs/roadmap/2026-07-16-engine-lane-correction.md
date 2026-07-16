# 引擎 Lane 方向纠偏(2026-07-16,用户拍板)

## 背景

T 系列在飞分支(T05 gateway / T06 Codex subscription engine / T08 AI accounts)把引擎接入做成了「订阅账户管理」形态,并在 T08 中删除了 `PiAgentPane.tsx`(1231 行,含自定义 provider / model id / endpoint / API key 编辑)。用户 2026-07-16 实机确认两点:

1. **自定义 provider UI 必须保留**。Pi 引擎的核心价值就是自配 provider/model/endpoint(写入 Pi 自管的 `~/.pi/agent/models.json`);删掉它等于砍掉产品的开放性。
2. **外部引擎走 t3code 式编排接入,取代 subscription 形态**。Codex / Claude Code 这类外部 CLI:认证归它们自己(`codex login` / `claude login`),模型归它们自己,用量归它们自己;Offisim 只做三件事——检测(装了没、登了没、版本)、编排(起会话、绑 worktree、收事件)、呈现(产出进舞台/看板)。不在 Offisim 里重建订阅用量核算、模型清单校验、账户健康页。截图证据:订阅形态的 Codex 卡片只能显示「用量不可用、0 个模型」,本身就证明这条路是死的。

## 意图共识(2026-07-16 grill 确认,8 项拍板)

1. **引擎身份 = 员工的大脑**:雇/编辑员工时选引擎(Pi 引擎继续选 provider+model;Codex/Claude Code 整机接入)。不新增「外包商」实体,信息模型沿用 P1 员工-模型绑定的延伸。
2. **绑定粒度 = 跟人走**:引擎是员工属性,改绑去人事页;不做 per-任务换引擎。同题比稿 = 派给多个不同引擎的员工,隐喻自洽。
3. **编排深度 = 能力声明式统一**:硬底线是过程事件流(思考/工具调用/文件改动)进舞台和时间线 + 随时 Stop;steer/权限档/resume 按引擎能力声明渐进点亮,不支持的控件不显示、不伪装。
4. **成本口径 = 记 token 不记钱**:外部引擎任务记 token 数与时长,标「订阅内 · 无 API 成本」;金额账单只算 API 引擎。不做 API 价折算的伪造等效成本。
5. **安装边界 = 只检测 + 指引**:状态卡给未安装/未登录/就绪 + 版本 + 一键复制命令与官方指引,就绪后自动刷新;不代装不代登,凭据始终归外部工具自管(凭据隔离硬规则)。
6. **纠偏节奏 = 原地改造**:#57/#59/claude-engine 在原分支按本决策改,保留 gateway 等已有投入;T12-T15 等无关 PR 照跑不受影响。
7. **Provider UI 归宿 = 并进 AI Accounts 壳**:一页两区——「API 引擎」区恢复原 PiAgentPane 全部编辑能力,「编排引擎」区放外部 CLI 状态卡。
8. **排期**:引擎纠偏在 train 内完成;train 收尾后新波次从 W1(checkpoint/rewind)开工,W3/W4 无依赖可并行小包。

## 目标架构(两层引擎模型)

- **API 引擎(Pi)**:玩家自配 provider——恢复完整的 provider 编辑能力(模板 + 自定义 endpoint + API key,summary-first 展示),配置真相仍在 Pi 自管文件,Offisim 只做安全摘要与编辑入口。这是「AI Accounts」页里 API 一侧的唯一内容。
- **编排引擎(外部 CLI)**:Codex CLI、Claude Code 等,每个引擎一张状态卡:检测状态(未安装 / 未登录 / 就绪)+ 版本 + 打开各自登录指引;就绪后可被派工(经 T05 gateway 缝)。没有用量页、没有模型清单、没有账户核算。
- **成本口径**:API 引擎按 usage 计成本(既有 T13 分账);编排引擎标「订阅额度,成本由外部工具自计」,不伪造数字。

## 在飞 PR 处置(已在 PR 上留纠偏意见)

| PR/分支 | 处置 |
|---|---|
| #55 T05 engine gateway | **保留**。gateway 缝正是编排接入需要的,不动。 |
| #57 T06 Codex subscription engine | **重定向**:剥离订阅用量/模型校验/账户健康核算,收敛为编排适配器(检测 + spawn + 事件流)。 |
| #59 T08 AI accounts | **打回改造**:恢复 PiAgentPane 的自定义 provider 编辑能力(可以放进新 AI Accounts 壳的 API 区),外部引擎区只留状态卡。禁止净删 provider 编辑功能。 |
| `codex/offisim-claude-engine`(未开 PR) | 按编排引擎口径重做,不再复制 subscription 模式。 |

## 文档与政策跟进

- 根 CLAUDE.md「Pi Agent is the only active runtime / 任何 Claude/Codex 回归必须互斥替换」条款已被本决策取代:终态是 **Pi(API 引擎)+ 外部 CLI(编排引擎)并存**,编排引擎不是 provider lane、不走 Pi 内核,与原条款防的「provider catalog 复辟」不冲突,但「互斥替换」表述需改为「编排接入」。随 T15(docs truth)或本 lane 的收尾 PR 一并修正。
- 与 `Docs/roadmap/2026-07-16-harness-ide-next-wave.md` 的关系:W5 best-of-N 的「跨引擎比稿」依赖本纠偏后的编排引擎形态,依赖关系不变。
