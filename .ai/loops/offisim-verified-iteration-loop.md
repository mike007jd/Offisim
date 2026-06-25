# Offisim Verified Iteration Loop（通用迭代 loop）

> **怎么用**：把这份 loop + 一份「需求切片」一起丢进 `/goal`。
> 需求切片 = 你想这一轮完成的**一个** Milestone / Epic（例如 PRD 的 `VM-001`、或整个 `Milestone M0`、或任意一段自然语言需求）。
> Loop 是固定的方法；需求每轮替换。Loop 自己负责把切片落到可交付 + 验证 + 集成 + 收尾。
>
> **这一轮的需求切片**：见随附的需求文档 / 本次 `/goal` 提示里粘贴的需求。如果没附，先停下问「这一轮要做哪个 Milestone/Epic」。

---

## 0. 不可协商的运行约束（先读，违反即停）

1. **原生编排，禁止造控制器**。只用当前 harness 的 subagent / agent team / 后台会话 / worktree / 任务列表 / Git 集成。**绝不**创建 `fleetctl`、调度器、worker daemon、lease/heartbeat 系统或任何模拟 harness 的脚本。正常的 build/test/git 命令允许。
2. **证据高于自报**。`run.completed` ≠ 完成。每条验收标准必须有**确定性 oracle**（命令 exit code / 文件存在 / hash / test 结果 / schema 校验）或独立 fresh-context reviewer 判定。Agent 说"我做完了"不算数。
3. **每个 phase 之间强制 `/simplify xhigh`**（见 §2 的 SIMPLIFY GATE）。这是本 loop 的硬约束。
4. **一个 ownership boundary 一个并发写手**。同一 wave 内并行写手不得编辑同一文件/不稳定接口。
5. **先冻结契约再扇出**。接口、数据形状、事件类型、验收 oracle 先定稳。
6. **可逆决策自己拍板**（布局/命名/取舍/等价方案），不把决定踢回用户。仅在真正不可逆/破坏性/花钱/改共享状态/产品意图真分叉时一行预告。
7. **合并权限**：默认可在本地 commit 到当前默认分支（`main`）。**未经显式同意不 push、不开 PR、不部署、不动远程**。
8. **范围纪律**：只做本轮切片。发现的相邻问题记录为「下一轮候选」，不顺手扩张（除非是完成本切片的必要前置）。

### Offisim 项目硬规则（叠加在上面之上）

- **门禁命令**：`pnpm validate`（含 typecheck 21 包 + ~18 个 harness + wire-contract + pi-permission + src-imports + deadcode）。安全：`pnpm security:harness`。Rust：`cd apps/desktop/src-tauri && cargo test --locked`。完整发布门禁：`pnpm release:run`。
- **Live 验证只认确切 release `.app`**：`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。dev webview / localhost / bundle-id 启动**不算**发布验证。
- **GitNexus 纪律**：改任何 symbol 前先 `impact({target, direction:"upstream"})` 报 blast radius；commit 前 `detect_changes({scope:"compare", base_ref:"main"})`；HIGH/CRITICAL 风险先警告；重命名用 `rename` 不用 find-replace。
- **运行时边界**：核心 runtime / 模型 transport / 本地工具 / SQLite / install 契约 / 平台 API 不在 UI 清理范围。文件浏览必须走沙箱 `project_list_dir`/`project_read_file`/`project_read_file_preview`。模型/工具执行必须走 Offisim harness/gateway。
- **Provider 政策**：禁 OpenRouter 自动 profile；测 OpenAI/Anthropic lane 一律走 z.ai / MiniMax 兼容端点；Settings 展示 OpenAI-first 但路由按 credential。
- **Renderer 壳层**：不加 renderer-root 外边距/padding/假黑框/`calc(100%-16px)`；间距进 panel/rail/toolbar。
- **Pi 是唯一首发 runtime**，pin `0.79.8`。Mission/抽象层工作不得顺带做 Pi 0.80.x 大迁移（那是独立 Epic）。

---

## 1. Loop 主循环

```
切片接入 → 现实同步 → 冻结契约 → 波次实现 → 独立验证 → 集成+live证据 → 收尾
   每个箭头之间： /simplify xhigh + 独立 reviewer 守门
```

**一轮完成的定义**（全部满足才算 done）：
1. 本切片的每条验收标准都被其 oracle 判 PASS；
2. 接受的改动已集成进目标分支（默认 `main` 本地）；
3. 验证在**真正集成后的 revision** 上通过（含 `pnpm validate` + 相关 cargo/security + 必要时 release `.app` live 证据）；
4. 临时 agent / 会话 / worktree / 分支已关闭/归档/有意保留；
5. 仓库处于干净可理解状态，memory 与 gitnexus index 已更新。

---

## 2. SIMPLIFY GATE（每个 phase 之间执行一次）

> 这是用户的硬要求：**每个 phase 之间 simplify xhigh**。

每完成一个 Phase（产生了 diff）后、进入下一个 Phase 前，执行：

1. **`/simplify xhigh`** —— 对本 phase 产生的改动做 reuse/简化/效率/altitude 清理并应用（质量向，不找 bug）。
2. **独立 reviewer 守门** —— 派一个 fresh-context `feature-dev:code-reviewer`（或 `Explore` 做只读审查）审本 phase 的 diff：找真 bug、回归、范围溢出、契约违背。
3. **裁决** —— reviewer 报的每条标 severity；真 blocker 当场修；low/by-design 写明驳回理由。simplify 引入的任何行为变化必须被 oracle/门禁重新证明。
4. **门禁复绿** —— simplify + 修复后重跑本 phase 相关的最小门禁子集（至少 `pnpm typecheck`；碰 Rust 则 `cargo test`），确认仍绿再进下一 phase。

simplify 的对象始终是「**本 phase 的增量 diff**」，不是全库重构。若某 phase 没产生代码改动（如纯调研），simplify gate 退化为「reviewer 复核结论 + 跳过 simplify」。

---

## 3. 各 Phase 详规

### Phase A — 切片接入 & 现实同步（调研，通常不改码）

**目标**：把附带的需求切片 + 仓库当前现实对齐，产出本轮**可执行的 work list**，并消除 stale 前提。

> ⚠️ Offisim 经验：历史 loop 多次因「前提已 stale」翻车（协议版本号、schema 版本、表是否 live）。**切片里写的现状一律重新核实，不照单全收。**

做：
- 读需求切片，列出它声明的**验收标准 / 期望产物 / 边界**。
- 并行派 2–5 个只读 agent（`Explore` / `feature-dev:code-explorer`），分别核实切片里每条「现状断言」是否仍真（用 gitnexus `query`/`context`/`impact` + 读源码，给文件:行号证据）。
- 对每条断言标 TRUE/FALSE/PARTIAL；FALSE/PARTIAL 的更新 work list。
- 用 `impact()` 对将要碰的 symbol 报 blast radius；HIGH/CRITICAL 一行预告。
- 确认本轮门禁基线当前是绿的（跑一次 `pnpm validate` 存基线；预存红记录下来，区分「我引入的」vs「预存的」）。

产出：本轮 work list（带证据）+ 受影响 symbol 清单 + 门禁基线状态。
**消费完调研 agent 即关闭。**

→ **SIMPLIFY GATE**（本 phase 通常无 diff → 退化为 reviewer 复核 work list 是否漏项/越界）

---

### Phase B — 冻结契约 & 验收 Oracle

**目标**：在扇出写之前定稳所有共享面，并为每条验收标准锁定确定性 oracle。

做：
- 定义本切片要新增/改动的：接口签名、数据形状、SQLite schema、wire 协议字段、中性事件类型。**先定字段名和形状，不写实现。**
  - 改 wire 协议 / 跨语言 fixture：明确是否 bump（Offisim 规则：仅 required field 变化才 bump major；request 方向契约能不变就不变）。
  - 改 schema：写迁移；注意 better-sqlite3 改 ABI 须 rebuild。
- 划 **ownership boundary**：把 work list 切成互不重叠的文件/接口归属块，每块一个未来写手。标出任何共享文件（同 wave 不能两个写手碰）。
- 为每条验收标准选 **oracle**（优先确定性）：
  - `command_exit_zero`（`pnpm test` / 某 harness）/ `file_exists` / `file_hash` / `text_contains` / `json_schema` / `git_diff_policy` / `detect_changes 范围` / fresh-context reviewer rubric（仅在无法编程断言时，标 non-deterministic）。
  - 确定性 FAIL 不得被 LLM PASS 覆盖。
- 记录每个状态的期望行为（成功/错误/loading/空/取消/重试/兼容），凡 UI 相关。

产出：冻结的契约清单 + ownership 切分 + 每条标准的 oracle 命令/判据。

→ **SIMPLIFY GATE**（若 Phase B 写了类型/schema/契约骨架，simplify 它 + reviewer 审契约一致性、命名、是否过度抽象）

---

### Phase C — 波次实现（并行写）

**目标**：按依赖波次扇出原生写手，maker/checker 分离。

每个 wave：
1. 对本 wave 的每个 ownership boundary 派一个原生写手 subagent（一块一个，**绝不两个写手碰同一文件**）。若需要并行写同一 Git 仓不同部分且会冲突 → 用 `isolation:"worktree"`。
2. 给每个写手：单一明确产出 + 冻结契约 + 拥有的文件边界 + 禁止重叠 + 必须返回的证据（改了哪些文件 / task-local 验证结果 / 风险 / 集成注记）。写手返回结果即停，不空转。
3. 每个写手做完跑 task-local 验证（至少 typecheck 自己的包）。
4. 写手的 diff 交给 **fresh 独立 reviewer**（`feature-dev:code-reviewer`）—— maker 绝不自审。
5. 按证据 accept / repair / reject / supersede / split。
6. accept 的通过 harness 原生 Git/worktree 流集成。
7. 集成后跑 integration 级检查。
8. 契约或集成头变了 → 通知下游写手。
9. 关闭完成/驳回的 agent，释放其 worktree。

> Offisim 经验：对抗审查常抓出 maker 漏的真 bug（RCE bypass / anchor 跳过 / 凭证泄漏进工件 / 漏对象字段）。**reviewer 要对抗性地试图证伪，不是走过场。**

产出：本切片全部 ownership block 实现并各自集成。

→ **SIMPLIFY GATE**（simplify 全 wave 增量 diff + 独立 reviewer 守门 —— 这是 Offisim epic 的标准节奏：每 wave /simplify xhigh + 独立 reviewer）

---

### Phase D — 独立系统验证 & 对抗审查

**目标**：在集成后的 revision 上，用确定性门禁 + fresh agent 证明整体正确，无回归。

做：
- 跑完整相关门禁矩阵：`pnpm validate`（全绿，区分预存红）+ `pnpm security:harness` + `cd apps/desktop/src-tauri && cargo test --locked`（碰 Rust 时）。把失败原样贴出来，不掩盖。
- 逐条跑 Phase B 定的验收 oracle，记录 PASS/FAIL + 证据。
- 派 fresh agent 审：业务正确性、回归、架构一致性、UX、可维护性、范围纪律。
- reviewer 分歧用确定性证据裁决。blocker 开 bounded 修复 wave。
- 只有当剩余决策**确属用户所有**或超出授权时才停下问。

> 不得把「所有 agent 完成」等同于「功能完成」。

产出：门禁全绿（或诚实列出无法绿的项及原因）+ 每条标准的 oracle 证据。

→ **SIMPLIFY GATE**（修复 wave 若产生 diff，simplify + reviewer 复核修复未引入新问题）

---

### Phase E — 集成 & Live 证据

**目标**：把接受的工作落到目标分支，并在真实 revision 上验证。

做：
- `detect_changes({scope:"compare", base_ref:"main"})` 确认改动只影响预期 symbol/flow；意外范围先查清。
- 若已获授权：在本地 `main` commit（小而连贯的 commit；commit message 结尾按全局规范带 Co-Authored-By；**不 push**）。未授权则停在 working tree 并说明。
- 若本切片触及 **user-visible surface / 运行时 / Rust / 数据写入路径**：重建 release `.app` 并采 **live 证据**（PRD gate 风格：磁盘/DB 双取证，例如产物真落库、token 非零、审批栏真弹）。截图被 macOS 权限挡时如实说明「视觉校验未完成」，不假称已验。
- 纯文档/纯内部重构切片可跳过 live `.app`，但要说明为何安全跳过。

产出：集成后的 revision ref + live 证据（或明确的「无需 live」理由）。

→ **SIMPLIFY GATE**（集成期 lead 做的小修也要 simplify + 复验；通常此处 diff 很小）

---

### Phase F — 收尾 & 报告

**目标**：清理原生资源，沉淀知识，诚实汇报，定下一轮。

做：
- **Agent/会话清理**：消费完每个结果，关闭/归档所有完成的 subagent、teammate、后台会话。没有 agent 因为「曾被 spawn」而残留 active。
- **Worktree/分支清理**：先用 harness 原生 managed-worktree 清理；接受的工作已安全在目标分支后再删临时分支；被拒实验只在有明确未来价值时保留（否则归档一句结论即释放）。检查最终 Git/worktree 状态，处理本轮遗留。绝不强删未知用户工作。
- **Runtime 清理**：停掉本轮起的临时 server/容器/DB/端口/测试账号/生成物。
- **代码园艺**：只删本轮引入的 debug 日志/临时 flag/废脚手架/重复 helper/陈旧注释/未用依赖；不借机做无关重构。
- **沉淀**：更新 `MEMORY.md` 索引一行 + 写 topic 文件（本轮做了什么、地雷、被驳回项、live 证据状态、下一轮切片）。若改了代码结构，刷新 gitnexus index（`node .gitnexus/run.cjs analyze`）。
- **报告**（简洁工程报告）：
  - 本轮切片 outcome + 目标 revision；
  - 主要改动 + 架构决策；
  - 用到的 agent/lane（高层，不贴 transcript）；
  - 验证证据（门禁 + oracle 结果，含 live `.app` 状态）；
  - 被驳回的变体 / 失败的假设；
  - 剩余风险 / 待人工核查项；
  - 清理确认（agent 关闭、worktree 处理、临时资源处理）；
  - **下一轮推荐切片**（按 PRD §35 顺序或需求自身依赖）。

→ **SIMPLIFY GATE（收尾后最终一道）**：对整轮累计 diff 做最后一次 `/simplify xhigh` + reviewer 终审，确保交付物干净。

---

## 4. 停止 / 升级规则

**bounded 停止**（借 Offisim canonical QA loop 默认值，可被切片覆盖但 Playbook 不得无限放大）：
- 每条验收标准最多 3 次修复尝试；
- 一轮切片最多 6 个 full attempt；
- 连续两次 attempt 产生相同失败集合 + 相同 failure signature → `STUCK`，停下报告；
- token/时间/成本任一预算耗尽 → 停；
- evaluator 基础设施错误 与 产品 FAIL 分开记录，不混淆。

**暂停问用户**（仅这几种，一行告知不阻塞式）：
- 验收标准互相冲突；
- 出现无法从上下文推断、且选错代价大的真正产品/架构分叉；
- 破坏性数据迁移 / 生产影响 / push / 远程合并 超出授权；
- 分支保护或远程策略挡住约定的合并路径；
- 反复证据表明选定架构无效；
- harness 无法安全隔离并发写手。

其余一律自己拍板继续。

---

## 5. 把本 loop 用在「这份 PRD」上（推荐切片顺序）

PRD 是多月路线图，**逐切片喂**。按 PRD §35 强制顺序，每次 `/goal` 跑一个：

```
1. VM-001 Truth Closure ADR（先清 canonical QA × inert-ledger 冲突，如 M6 仍要 mcp_audit_log 出行）
2. VM-002 Artifact writer + VM-003 Cost projection（闭合 deliverables / llm_calls 的 reader-no-writer 死链）
3. VM-005 可执行 QA runner（让 S1–S12 / M1–M6 真正跑出 evidence）
4. VM-004 Pi 0.80.2 兼容 spike（独立 Epic，不与产品功能混合）
5. RD-001..006 Runtime Driver facade（无行为变化：generic gateway / PiRuntimeDriverV1 / DeterministicTestDriver / Conformance harness）
6. MS-001..006 Mission core + 同 session repair loop
7. UX-001..007 Mission UX
8. DR-001..006 Durable recovery
9. WI-001..006 Worktree 写隔离
10. PB-001..006 Playbook marketplace
11. RT2-001..006 第二 runtime pilot
```

> PRD 硬约束：第 8–11 项不得提前成为 Mission MVP 依赖。M0（1–3 项）的 reader-no-writer 死链必须先闭合，否则 Verified Missions 建在「有 schema 无人写」的表上。

**每次 `/goal` 调用**：把这份 loop + 上面某一行对应的 PRD 章节（如 `§31 VM-001` 或整个 `Milestone M0`）一起贴进去即可。
