# Handoff prompt — UX / edge-case audit

Paste everything below as the **first message** of a fresh session.

---

## Task

你在审计 Offisim（`/Users/haoshengli/Seafile/WebWorkSpace/Offisim`）的**用户体验和边界场景**。不是代码审计（Phase 1-5 已完成），而是站在玩家角度回答：**"这个产品好不好用？哪里会卡住/困惑/丢数据？"**

**先读这个文件再做任何事**：

1. `Docs/business-logic-map.md` — 完整业务逻辑图（17 节，含 6 条 boss 路由、记忆系统、Meeting、Project、权限门控、制作人 7 个疑问）。这是你的 ground truth。
2. `CLAUDE.md` — 仓库约定 + gotchas

---

## 上一个 session 的状态

- **Ship-grade audit Phase 1-6 全部完成**，37+ 个 Phase 5 code commits 落地
- **Typecheck 13/13 / core 920 / ui-office 328 / apps/web 152 / parity 37 全绿**
- **Codex adversarial review 过了 2 轮**，所有 HIGH + MEDIUM 修完
- **R1**（transact rollback）、**FS3**（abort ceremony reset）、**M4**（deep-link intent 持久化）全部关闭
- **E2E 有 14 个 stale tests**，有 subagent 在修（可能已 commit，`git log` 确认）
- `business-logic-map.md` v2 刚写完，包含制作人审核的 7 个产品疑问（Q1-Q7）

---

## 你的审计范围

### A. 制作人 7 个疑问的源码验证（Q1-Q7）

`business-logic-map.md` 第 17 节列了 7 个产品疑问。逐个用源码回答：

| Q | 核心问题 | 你要验证的 |
|---|---|---|
| Q1 | HR 说"建议招人"但不执行 | hr-node.ts 有没有调用任何 repo.create？回复文案是否让玩家明白这只是建议？ |
| Q2 | Meeting 无产出 | meeting-subgraph.ts 结束后发了什么事件？有没有 action-item 提取？有没有后续 delegate 触发？ |
| Q3 | Project 前端入口 | grep "project" in ui-office components — 有没有 create project UI？还是只有 /project 命令？ |
| Q4 | 路由对玩家透明度 | ChatPanel / PipelineProgress 在 boss 做出路由决策时给玩家看到了什么？ |
| Q5 | 员工记忆可见性 | Employee 详情面板有没有展示 MemoryEntry？ |
| Q6 | 卸载缺失 | 有没有 "解雇" / "卸载" 按钮？MarketPage InstalledList 有什么操作？ |
| Q7 | 切公司时 thread 命运 | App.tsx handleCompanySwitch 做了什么？正在跑的 graph 会 abort 吗？ |

### B. 8 个核心用户流的 edge-case 走查

对每个流程，问 5 个问题：
1. **空状态** — 没有任何数据时看到什么？
2. **错误态** — LLM 500 / DB 满 / 网断时看到什么？
3. **中途退出** — 流程进行到一半，用户切走/关 tab/按 Escape 会怎样？
4. **重复操作** — 快速双击/重复提交会怎样？
5. **极端输入** — 空字符串 / 超长文本 / 特殊字符 / emoji / RTL 文字

8 个流：
1. 首次启动 → 配 provider → 建公司 → 进办公室
2. 发消息 → 6 路路由 → 任务执行 → 交付物
3. @mention 直派 → employee 执行
4. 开会（meeting mode）→ 讨论 → summary
5. 创建 SOP → DAG 编辑 → 执行工作流
6. 市集浏览 → 安装员工 → 出现在场景
7. Settings 改 provider → 保存 → runtime reinit
8. Studio 编辑 zone → 放 prefab → 保存

### C. 跨系统交互的 edge case

- 正在执行任务时切公司
- 正在安装员工时 provider 过期
- SOP 引用的角色在公司里不存在
- Meeting 参与者中途被"解雇"（如果有卸载功能的话）
- 记忆池满了（50 条上限）时新记忆怎么处理
- 两个 thread 同时跑（多 tab？）

---

## 输出

1. `Docs/audit/ux_edge_case_audit_2026-04-12.md` — 每个流程一节，每个 edge case 标注 severity（CRITICAL / HIGH / MEDIUM / LOW）+ 是否 NEEDS-SMOKE
2. 对 Q1-Q7 给出明确的 **"是/否 + 建议"** 回答
3. 如果发现代码 bug（不只是 UX gap），标注并给修复方向

---

## 约束

- 用中文
- 不要复述你读了什么代码，只输出结论
- 每个 finding 必须有源码验证（file:line），不接受猜测
- 已知 non-goal 不要重新提（A2A / OpenClaw / bundle size / Scene V2 / CI）
- Phase 5 已修的 bug 不要重新发现（R1-R4 / FS1-FS7 / C1-C2 / H1-H3 / M1-M4 / L1-L4）
- `business-logic-map.md` 是 ground truth，如果你发现代码跟 map 不一致，以代码为准并标注 map 需要更新
