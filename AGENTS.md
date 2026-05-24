# 对话
- 中文回答。

# 完整交付硬规则
- 禁止把“最小化交付 / MVP / 先做核心 / 先过编译”当作用户要求任务的完成口径。用户交给 Codex 执行时，默认目标是完整交付整个 scope。
- 完整交付包含：实现真实修复、同步 spec / docs / task 状态、跑要求的构建与门禁、完成必要的 release / live runtime 验收、记录证据与未完成项。
- 不允许在“部分实现 / 大部分 task 勾选 / 编译通过 / harness 通过 / 找到 blocker 但未闭环”时声称完成。
- 如果遇到凭证、外部服务、设备不可达、破坏性风险或产品决策无法合理推断等真实阻塞，必须明确标成“未完整交付”，保留未勾 task / tag gate / archive gate，不得用 known limitation 或口头解释替代验收。
- 发现额外真实 blocker 时，先修能修的部分并记录证据；不能修的要直接 surface 根因和下一步所需条件，不要缩小 scope 后交付。
- 模型调用不是 SDK lane：默认 `offisim-core` harness 可以直接通过自己的 model transport / provider adapter 调模型；SDK 只允许作为底层 transport 实现细节，或作为完整 SDK-native employee runtime profile，不存在“普通 SDK lane”产品路线。
- 当前已验证的本地文件 / shell / workspace 任务必须走默认 Offisim harness / gateway 工具路径；未来 tool-capable employee profile 或主 harness driver/replacement 必须先有独立 capability profile、审计、checkpoint/rollback 和 release `.app` 证据。external A2A 和未验证的 model transport 不能冒充本机工具执行者。

# 当前架构决策（2026-05-18）
- 开源前结构目标是生产级可维护拆分，执行源为 `openspec/changes/simplify-to-tauri-only-desktop-architecture/`。
- Offisim 只保留 Tauri v2 桌面产品；不要新增独立 web、browser runtime 或 launcher 产品工作。
- React renderer 位于 `apps/desktop/renderer`，归 desktop ownership；仓库不再保留 standalone web package。
- launcher 已删除；相关端口、脚本、docs、验证路径不得恢复。
- Tauri 仍需要 WebView renderer，所以删除 web 产品不等于删除 React UI；正确方向是把 renderer 收到 desktop ownership 下。
- 最终验收只认当前 worktree 的 release `.app` + Computer Use 真实交互；localhost、dev server、dev webview、browser screenshot 只能作为排查证据。

# 验证 / 测试准则
- 不在 `packages/core/src/**/*.test.mjs` 新增或保留 runtime / graph / product 行为测试。
- 新的 graph、runtime、permission、planner、kanban、LLM replay 不变量必须走 deterministic harness：`packages/core/harness/scenarios/*.json` + `packages/core/src/testing/invariant-assertions.ts`，并按需加入 `manifest.json` / replay 或 soak 列表。
- 临时 `node --test` 只允许作为本地探索，不进 git；不要通过给 `packages/core/package.json` 加 `test` script 或 CI gate 来恢复普通 product 自动测试。
- 如果 review 发现源内 `.test.mjs` 和 harness 重复，优先删除源内测试，把仍有价值的不变量迁到 harness。

# Desktop / Computer Use 验收
- 本项目不允许把 dev webview、dev server、dev SPA、localhost 浏览器结果当作桌面端或端到端验收；这些只允许作为本地排查手段，不能写入 live verify / release verify 证据，也不能据此勾验收 task。
- 所有桌面端 live verify / release verify 必须测 release `.app` 本体，并优先用 Computer Use 附着 release app 完成真实交互截图。
- 用 Computer Use 测 Tauri 桌面端时，默认测 release `.app`，不要把 dev webview 结果当作最终桌面验收。
- 验收前先执行桌面 release build，再启动 `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。
- 若 dev 能跑但 release `.app` 不可交互、黑屏、或 Computer Use 无法附着，按 release 桌面阻塞处理，先查清原因再继续依赖桌面验收结论。
- 旧 `packages/ui-office` / `packages/ui-core` UI 框架已移除；桌面 renderer 现在是新设计接入用的空 React 壳。桌面验收直接构建当前 renderer 和 `@offisim/desktop`，不能恢复旧 UI 包或旧 dist 路径。
- release `.app` 启动必须用当前 worktree 的精确 `.app` 路径，不能用 `open -b com.offisim.desktop` 这类 bundle id 方式；多个 worktree 共享 bundle id 时会误附着旧包。
- release `.app` 的窗口附着、截图、点击、关闭、前台切换必须用 Computer Use；不要用 `osascript` / AppleScript 充当桌面验收或窗口控制工具。
- Project workspace 文件浏览必须走 `project_list_dir` / `project_read_file` 这组受 `workspace_root` sandbox 约束的 Tauri command；不要在 webview 里直接用 `tauri-plugin-fs` 读项目目录。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Offisim** (33319 symbols, 48819 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Offisim/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Offisim/clusters` | All functional areas |
| `gitnexus://repo/Offisim/processes` | All execution flows |
| `gitnexus://repo/Offisim/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
