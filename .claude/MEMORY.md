# Offisim Claude Memory

## 2026-05-18 Tauri-only architecture decision

- Offisim 开源前的结构目标是生产级可维护拆分，执行源为 `openspec/changes/simplify-to-tauri-only-desktop-architecture/`。
- 只保留 Tauri v2 桌面产品。不要再把 standalone web、browser runtime 或 launcher 当产品路线推进。
- `apps/web` 仅是迁移期旧 React renderer 位置；Tauri 仍需要 WebView renderer，目标是迁到 `apps/desktop/renderer` 并归 desktop ownership。
- `apps/launcher` 已废弃，相关 package、脚本、端口、文档和验证路径应随 cleanup 删除。
- 最终验收只认当前 worktree 的 Tauri release `.app` + Computer Use 真实交互；localhost、dev server、dev webview、browser screenshot 只可用于排查。
- `offisim-core` harness 继续作为默认 runtime。模型调用属于 model transport / provider adapter，不存在“普通 SDK lane”产品路线。
