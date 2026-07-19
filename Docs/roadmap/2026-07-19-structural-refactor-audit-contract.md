# 结构性 Refactor 独立审计合同（2026-07-19）

本文档只定义审计、证据与合并门禁，不修改实现范围。实施规格仍以
`2026-07-18-structural-refactor-plan.md` 为准；两者冲突时，先记录偏差并
停止对应 PR，不把偏差扩散到其他分支。

## 1. 覆盖范围与结论边界

- Fable 的既有结论只覆盖其实际审过且审后未变化的 commit。
- #94、#95、#96、#102 的审后修订必须按修订 diff 独立复核。
- #99、#104、#105、#106、#107、#108 必须从真实 base 到当前 head
  完整审计，不继承旧结论。
- D1/D2/D3 属安全边界机械拆分。GitNexus 的单符号/单 hunk 风险显示不能
  代替整模块聚合风险；按 CRITICAL 口径验收。
- 发现缺陷直接在所属分支修复、重新取 impact/detect_changes、重跑门禁，
  不把修复塞进 main 脏文件或其他 PR。

## 2. 分支与 PR 拓扑

- A1 #94 → A2 #99。
- A3 #104 → D1 #107 → D2 #108。
- A3 #104 → D3 #106。
- A4 #105 独立基于 main。
- D1/D2 通过普通 merge commit 组合，不重写远端历史；组合时同时保留
  `git/*` 与 `binding/*` 的 harness 路径。
- 本合同为独立 docs PR；不得夹带 main 的 `AGENTS.md`、`CLAUDE.md`、
  roadmap 草稿或 `scripts/lib/harness-runner.mjs` 脏改。
- Codex Stop 孤儿进程修复必须另开基于 A3 的 bug PR，不污染机械重构。

## 3. 机械移动证明

对 D1/D2/D3，逐项核对原函数、方法、类型、常量、测试、注释和错误文案：

1. 每个原项恰好迁移一次，不能缺失或重复。
2. 只允许模块声明、导入/re-export、最小可见性、rustfmt 与 harness
   源码路径发生变化。
3. Tauri command 名称/参数、数据库/schema、Pi wire、engine lane、
   allowlist 判定、sandbox 上限和错误文案不得变化。
4. `git`、`binding`、`builtin_tools` 的原外部入口与 Tauri 生成 command
   符号必须继续由父模块导出。
5. A3 的 shell `SSH_AUTH_SOCK` 白名单并集是唯一已批准的行为差异。

证据必须同时记录：基线/head SHA、项数和缺失/重复数、允许的归一化规则、
最新 GitNexus 聚合风险、`detect_changes` 命中流程，以及所有偏差。

## 4. 静态与构建门禁

每个发生变化的相关分支必须在当前 head 执行：

- `node scripts/release-gates.mjs --lane=node`
- `node scripts/prepare-desktop-cargo-test.mjs`
- `cargo fmt --check && cargo test --locked`（Rust 分支，当前完整集 458 项）
- `git diff --check`
- GitNexus `detect_changes(scope=compare, base_ref=<真实 PR base>)`

任何修改后必须等待 GitHub 的 `Types / harness / security gates` 与
`Desktop Rust tests` 在新 head 上重新全绿。旧 head 的绿灯不算证据。

## 5. Release `.app` live 矩阵

只接受各 worktree 当前提交构建出的精确 release `.app`。启动和交互前记录
app SHA、精确 executable path、PID、CGWindowNumber、标题、bounds 与
`tauri://localhost`。全程使用 Computer Use；不得用 bundle id、AppleScript、
localhost 或 dev WebView 代替。

- A3：git、shell、Pi、Codex 四条 Stop 路径与残留进程。
- A4：fresh profile 下 AI Accounts 空态、Loop Runs 时间、Recovery 时间。
- D1：临时 Git 项目 + 本地 bare remote，验证 status/commit/push、checkpoint
  创建与回滚。
- D2：Pi/Codex/Claude 的授权目录读写、越界拒绝与重启后 Resume。
- D3：项目内读写和 bash 成功；父目录、软链接和越界路径拒绝。

证据不得包含凭据。临时 profile、项目、remote、截图辅助文件和进程必须按
精确路径/PID 清理，并记录清理结果。

## 6. 外部阻塞与完成定义

- 未获得用户明确 merge 授权前，所有 PR 停在可审/全绿状态，不 merge。
- 暴露过的 OpenRouter key 必须先轮换；轮换前不执行 Pi live。
- Pi live 只使用已核对的具体叶子型号 `cohere/north-mini-code:free`，并在
  证据中记录 source URL 与 checkedAt，不使用系列名或路由别名。
- Claude live 必须有真实可用额度；额度未恢复时 D2 保持“未完整验收”。
- blocker 不能用 known limitation 或口头说明关闭；对应 task、live gate 与
  merge gate 保持未完成。

获得 merge 授权后按依赖逐链合入；父 PR 落 main 后才把子 PR retarget 到
main。最终对集成 main 再跑全量门禁、精确 release `.app` 冒烟和合并证明，
完成后才清理分支/worktree。
