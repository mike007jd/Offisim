# Bucket 2b release app rotation evidence

Date: 2026-05-04
Commit: `b41a55b0`
Release app: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
Bundle binary timestamp: `May 4 23:17:12 2026`
Captured window id: `71319`
Surface: release Tauri `.app`, Office workspace, 3D mode, `Empty Verify Company`

## Build gate

- `pnpm --filter @offisim/ui-office build` passed.
- `pnpm --filter @offisim/desktop build` passed and produced:
  - `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
  - `apps/desktop/src-tauri/target/release/bundle/dmg/Offisim_0.0.1_aarch64.dmg`
- Computer Use attached to `com.offisim.desktop` pid `17201`, running from the exact release app path.

## Usable handoff videos

Use only these two files for bucket 2b:

- `release-app-slow-rotation-window.mp4`
  - Window-level capture via `screencapture -v -l 71319`.
  - Duration `9.03s`, `2784x1824`, average `~50.05 fps`.
  - Interaction: three short segmented drags across the Office 3D canvas.

- `release-app-fast-rotation-window.mp4`
  - Window-level capture via `screencapture -v -l 71319`.
  - Duration `7.04s`, `2784x1824`, average `~54.70 fps`.
  - Interaction: long fast drag followed by a reverse long drag across the Office 3D canvas.

Reference frames:

- `release-app-slow-rotation-window-frame.png`
- `release-app-fast-rotation-window-frame.png`

## Claude triage note

These videos are intended to close the remaining bucket 2b acceptance input: compare slow vs fast rotation on the release `.app` to determine whether the visible behavior points to tier downgrade, lighting intensity recomputation, or hemisphere/environment swap.

The directory also contains earlier exploratory full-display recordings (`release-app-*-front.*`, `release-app-slow-rotation.mp4`, `release-app-fast-rotation.mp4`, and `.mov` counterparts). Do not use those as acceptance evidence; they were full-display attempts and may include unrelated foreground windows.
