# 对话
- 中文回答。

# 完整交付硬规则
- 禁止把“最小化交付 / MVP / 先做核心 / 先过编译”当作用户要求任务的完成口径。用户交给 Codex 执行时，默认目标是完整交付整个 scope。
- 完整交付包含：实现真实修复、同步 spec / docs / task 状态、跑要求的构建与门禁、完成必要的 release / live runtime 验收、记录证据与未完成项。
- 不允许在“部分实现 / 大部分 task 勾选 / 编译通过 / harness 通过 / 找到 blocker 但未闭环”时声称完成。
- 如果遇到凭证、外部服务、设备不可达、破坏性风险或产品决策无法合理推断等真实阻塞，必须明确标成“未完整交付”，保留未勾 task / tag gate / archive gate，不得用 known limitation 或口头解释替代验收。
- 发现额外真实 blocker 时，先修能修的部分并记录证据；不能修的要直接 surface 根因和下一步所需条件，不要缩小 scope 后交付。
- SDK lane 不是工具 lane：`claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk` 在 Offisim 1.0 口径下只允许文本/推理，不得暴露或声称已执行文件、命令、memory、todo、skill 等 Offisim tool。需要文件/命令证据时必须走 `gateway` lane 并做 live verify。
- 本地文件 / shell / workspace 任务必须路由到 internal + gateway 工具员工；external A2A 和 SDK lane 不能当成本机工具执行者。若用户直指 external A2A 做本地文件/命令任务，必须 fail fast 并提示切回 internal gateway lane。

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
- 修改 `packages/ui-office` 后，先跑 `pnpm --filter @offisim/ui-office build`，再跑 `pnpm --filter @offisim/desktop build`；桌面 release 读取的是已构建 UI 产物，不能用旧 dist 做验收。
- release `.app` 启动必须用当前 worktree 的精确 `.app` 路径，不能用 `open -b com.offisim.desktop` 这类 bundle id 方式；多个 worktree 共享 bundle id 时会误附着旧包。
- release `.app` 的窗口附着、截图、点击、关闭、前台切换必须用 Computer Use；不要用 `osascript` / AppleScript 充当桌面验收或窗口控制工具。
- Project workspace 文件浏览必须走 `project_list_dir` / `project_read_file` 这组受 `workspace_root` sandbox 约束的 Tauri command；不要在 webview 里直接用 `tauri-plugin-fs` 读项目目录。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Offisim** (28857 symbols, 42136 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
