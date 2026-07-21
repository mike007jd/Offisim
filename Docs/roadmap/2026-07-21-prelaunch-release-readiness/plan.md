# Offisim 上线前发布就绪计划（2026-07-21）

状态：`IN PROGRESS`

当前候选版本：`1.1.2`（prepared corrective candidate）。As of **2026-07-22**,
`v1.1.1` is the latest stable published release；其 tag 指向历史发布 commit 且
保持 unchanged。Version `1.1.2` is the current prepared patch candidate and is
not yet published。`1.1.2` 的 tagging、notarization、GitHub publication、
replacement installation 等待显式 `v1.1.2` authorization；本轮仅做机械版本/
文档准备，不得写成 authorized candidate 或已发布。

## 已拍板执行方向

- 顶层采用 `rapid-parallel-delivery-loop`，最终判定采用 `release-readiness-loop`。
- 低复杂度、边界清晰的机械实现交给 Cursor CLI；架构、发布契约、数据/安全边界、整合与最终判断由 Codex 负责。
- 工程与功能门禁稳定后，UI/UX 专项才交给 Kimi K3 High；Codex 负责审 diff、构建和 Computer Use 验收。
- maker/checker 分离：实现者不签发自己的 release PASS；真实旅程、承诺核真和 streak 由 fresh-context checker 取证。

## Release loop 配置

| 字段 | 当前值 |
|---|---|
| `APP_ROOT` | `/Users/haoshengli/Seafile/WebWorkSpace/Offisim` |
| `CANDIDATE_VERSION` | `1.1.2` |
| `DEFAULT_BRANCH` | `main` |
| `RELEASE_GATE_CMD` | `pnpm release:run` |
| `BUILD_CMD` | `pnpm --filter @offisim/desktop build`（由 `release:run` 在清理产物后调用） |
| `LIVE_ARTIFACT` | `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app` |
| `STREAK_N` | `3` |
| `SHOT_TOOL` | Computer Use，绑定当前 worktree 精确 release `.app` |
| `PROMISES_SOURCE` | `README.md`、`Docs/FEATURES.md`、`SECURITY.md`、`Docs/00_start_here/DEPLOYMENT.md`、当前 architecture 真源 |
| `BASELINE_DIR` | `Docs/evidence/2026-07-21-prelaunch-release-readiness/`（索引）+ `output/release-evidence/`（原始日志） |
| `PROTECTED_PATHS` | repo/env secrets、`~/.offisim`、Codex/Claude/Pi native homes、系统 keychain 与用户 Projects |

## 关键用户旅程

1. Fresh-state onboarding：建公司、绑定 Project、配置或发现引擎、雇第一名员工、完成首个真实任务并产出文件。
2. Engine-neutral execution：Pi API、Codex CLI、Claude Code CLI 各自独立完成真实 task；能力控件、Stop/approval/recovery、token/时长/成本口径符合 lane manifest。
3. Workspace 与安全边界：有效 workspace 写入、越界拒绝、Project folder 缺失后的唯一高置信恢复、重启后解释与继续。
4. Conversation 与附件：语义标题、历史恢复、图片/文本附件被真实引擎消费，输出与来源可追溯。
5. Mission / Loops / compare：自然语言生成 Loop、发送 Mission、执行/恢复、比稿、采纳与隔离 worktree 清理。
6. 全 surface 日常使用：Office、Board/Timeline/Review/Compare、Conversation、Personnel、Market、Studio、Settings、Loops 在宽/窄窗口覆盖 onboarding/empty/loading/error/success。
7. Distribution recovery：签名/公证/更新链、启动 safe mode、诊断导出与受控 reset；`1.1.2` 的远程发布、公证提交、安装替换与实机验证等待显式 `v1.1.2` authorization，授权后必须全部闭环并留证，且不得复用 `v1.1.1` evidence 证明新修复路径。

## 完成口径

- 当前组合态通过 `pnpm release:run`，证据 summary 指向同一 Git revision，所有 core gates 绿且 `.app` hash 非空。
- 所有 confirmed 工程与 UI/UX findings 已修复；不存在用文案、fallback 或 dev webview 掩盖的产品缺口。
- 当前 release `.app` 的 P0 旅程连续三轮全过；每轮有截图和文件/SQLite/日志等确定性证据。
- 对客承诺逐条判 TRUE / STALE / UNSUPPORTED；后两类已改产品或改文案，不悬空。
- baseline 含 revision、环境、lockfile、产物 hash/签名、门禁、旅程、streak、性能、平台待核项与未授权动作。
- 最终只在全部证据成立时给 `GO`；否则给 `NO-GO` 和真实 blocker，不缩小 scope。
