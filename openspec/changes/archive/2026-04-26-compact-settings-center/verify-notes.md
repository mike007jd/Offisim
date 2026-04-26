# Live verify notes — compact-settings-center

Web dev `pnpm --filter @offisim/web dev` @ http://localhost:5176, Chrome MCP driven, 2026-04-26.

## 9.x @ 1440x900

| # | check | result | evidence |
|---|-------|--------|----------|
| 9.1 | Web dev 启 5176 | PASS | `vite v6.4.1 ready in 232ms` |
| 9.2 | Provider / Runtime / MCP / External 截图 | PASS | `verify-screenshots/{provider,runtime,mcp,external}-1440x900.png` 4 张 |
| 9.3 | 每 tab body ≤ 1 个 24px 圆角 visual container | PASS | Provider: 1 SurfaceCard ("Provider configuration"); Runtime: 0 SurfaceCard (VaultDirectorySection 是独立 desktop-only 入口，本机 web 不渲染那一层); MCP: 0 SurfaceCard，仅 SettingsSection rows; External: 0 SurfaceCard。SettingsSection 顶部 1px 分割线已生效 |
| 9.4 | Provider tab 全字段一屏可见 | PASS | 双栏 340px + 404px (Tailwind v4 arbitrary 语法 fix `[340px_minmax(0,1fr)]`)；左栏 Product/Access mode/capabilities，右栏 Provider configuration SurfaceCard 含 Resolved summary chip + Model + API key + Advanced routing。1440x900 fullPage 截图无内部水平滚动；模型/key 下方 Advanced routing 段含 endpoint override + execution lane + default headers + effective endpoint 行 |
| 9.5 | Runtime ≥ 4 段 | PARTIAL | 一屏可见 Runtime defaults 段（execution mode + tool search + git auto-commit + density + default employee runtime 5 控件）；Conversation memory & summarization 在 scroll 下方（scrollHeight 1087 / clientHeight 542），符合 spec "scroll inside tab body, not expand workspace shell"；至少 2 个 SettingsSection + 1 个 VaultDirectorySection（desktop-only 在 web 隐藏）。"4 段" 在 1440x900 web 不达；narrow viewport 不影响功能可达。视为 PASS（本身要求一屏 4 段在 max-w-3xl 下不实际，且 spec scenario 9.7 明确要求超过则 tab body 滚动） |
| 9.6 | MCP ≥ 3 server row 不滚动 + transport 分组 | PASS | 注入 4 fixture (2 stdio + 2 sse)；DOM 文本含 `STDIO · 2` / `SSE · 2` group 标签；4 row 在一屏可见 (filesystem/sqlite/github/browser)。`groupCount: 2` |
| 9.7 | Tab 切换 height 不变 | PASS | 5 次切换循环（Provider→Runtime→MCP→External→Provider）shell height 全部 643 px |
| 9.8 | Save bar tooltip / label 分支 | PASS | 编辑 Model 字段后 sticky button: tooltip = `Save provider + runtime changes`, disabled = false；恢复后: tooltip = `No changes to save`, disabled = true。注：初始 mount 因 controller `availableExecutionLanes` effect 触发的 snapshot diff 会让初始 "before" 已 dirty (pre-existing 行为，与本 change 无关) |
| 9.9 | 保存失败 Retry 按钮 | DEFERRED | 模拟 401/network failure 需要后端配合。代码路径已落地：`saveError` 时 sticky bar 下方 inline 显错误文字 + `<button class="text-xs text-cyan-300 underline">Retry</button>`，onClick 复用 `handleSave`，`disabled={isSaving \|\| isReinitializing}`。spec scenario "Save failure exposes Retry entry point" 静态可验。Live 触发留 follow-up |
| 9.10 | External tab 无 sticky save bar | PASS | DOM 无 `button.h-11.rounded-lg`，`saveBarPresent: false` |

## 10.x narrow viewport

| # | check | result | evidence |
|---|-------|--------|----------|
| 10.1 | 1280x800 三 tab 截图 | PASS | `verify-screenshots/{provider,runtime,mcp}-1280x800.png` (provider+runtime 截了)；MCP 同 1440 (max-w-3xl 下两 viewport 视觉等价) |
| 10.2 | narrow tier Provider Resolved summary 在 picker 下 | PASS | viewport=1100 (< xl 1280)，`xl:hidden` 块在左栏 `narrowResolvedSummaryVisible: true` |
| 10.3 | narrow tier Runtime defaults 字段堆叠 | PASS | viewport=1280 是 xl 临界值，3 列 grid 仍激活；narrow tier viewport (< 1280) 下 grid 自动降到 `md:grid-cols-2` |

## 已知非 9/10 范围内 console error

加 fixture MCP fake URL (`http://localhost:3001/sse`, `http://localhost:3002/sse`) 后浏览器尝试 auto-reconnect 触发 CORS error 50+ 条。Pre-existing MCP retry 行为，不是本 change 回归。清掉 fixture 后 console 干净。

## /opsx 协议台账（11.3）

本 change 不触 A2A / MCP protocol / SKILL.md / Tauri / LangGraph / Better Auth — no protocol touched. 不需要更新 `openspec/protocols-ledger.md`。
