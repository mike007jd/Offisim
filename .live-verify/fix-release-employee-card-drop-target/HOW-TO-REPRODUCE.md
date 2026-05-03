# How to reproduce the 2D drop regression + capture diagnostic

## Pre-flight

1. 等 `pnpm --filter @offisim/desktop build` 跑完（背景 task `brdmjem84`）。产物在：
   ```
   apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
   ```
2. 启动这个 worktree 的精确 `.app`（**不要** `open -b com.offisim.desktop`，会附错 worktree 的旧包）：
   ```bash
   open "/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app"
   ```
3. 加载一个公司 — 至少 2 个 zone，每个 zone `deskSlots > 0`，至少一个员工被分配到 zone。

## Repro path A — dark theme + 2D office canvas

1. Settings → Runtime → Theme = Dark
2. 切到 Office workspace；`SceneCanvas` 顶部 toggle 切到 2D（如果默认 3D 的话）
3. 在 canvas 里把员工节点从 zone A 拖到 zone B（B `deskSlots > 0`）
4. 观察：员工是否真的视觉上挪到 zone B？（按 backlog item，**不**应该挪。这是被 verify 的回归）
5. Settings → Runtime → "2D scene diagnostics" → 点 "Export 2D drop diagnostic"
6. 保存对话框 default name `offisim-2d-drop-diagnostic-<ts>.json`，**保存到**：
   ```
   /Users/haoshengli/Seafile/WebWorkSpace/Offisim/.live-verify/fix-release-employee-card-drop-target/dark-2d-attempt.json
   ```
   （直接覆盖默认 filename 即可）

## Repro path B — light theme + 2D office canvas

重复上面所有步骤，但 Theme = Light，文件存为：
```
/Users/haoshengli/Seafile/WebWorkSpace/Offisim/.live-verify/fix-release-employee-card-drop-target/light-2d-attempt.json
```

## Hand back

把两个文件路径甩给我即可（`@.live-verify/fix-release-employee-card-drop-target/dark-2d-attempt.json` / `light-2d-attempt.json`）。我会读 JSON 还原根因（Candidate A/B/C），写到 `root-cause.md`，然后进 fix 阶段。

如果 Settings 里看不到 "2D scene diagnostics" section，说明 ui-office build 没拿到新 dist；提示我重 build。

如果点 Export 报错（Tauri save dialog 没起来），说明 `dialog:allow-save` capability 没注册到 release（不太可能，已经加了），把报错截图贴回来。
