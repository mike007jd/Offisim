## 1. Scope and spec

- [x] 1.1 Create `polish-3d-art-direction-production` OpenSpec change
- [x] 1.2 Add `scene-3d-art-direction` capability spec
- [x] 1.3 Confirm project updates do not change the plan; preserve updated material preset tuning

## 2. Art direction foundation

- [x] 2.1 Add production 3D art tokens to `Scene3DColors`
- [x] 2.2 Add `scene-art-direction.ts` with room constants, camera preset, layer heights, and zone opacity policy
- [x] 2.3 Add production `scene-room-shell.tsx`

## 3. Office scene polish

- [x] 3.1 Wire `Office3DView` to production `RoomShell`
- [x] 3.2 Use stable `THREE.PCFShadowMap` in Office 3D Canvas
- [x] 3.3 Replace debug-style zone plane treatment with zone rug + subtle backing plane
- [x] 3.4 Improve zone label visual hierarchy
- [x] 3.5 Add compact mobile zone labels to prevent narrow-screen overlap

## 4. Prefab production pass

- [x] 4.1 Add workstation desk mats, cable accents, and glass caps
- [x] 4.2 Add meeting table center mat and display detail
- [x] 4.3 Add library table mats and reading light detail
- [x] 4.4 Add rest-area cushions and correct vending body material
- [x] 4.5 Add small/large plant visual variants
- [x] 4.6 Add visible template differentiation in `Prefab3D`

## 5. Character and preview polish

- [x] 5.1 Move internal employee visible surfaces to `SceneMaterial`
- [x] 5.2 Add shoes and hands to internal employees without changing appearance schema
- [x] 5.3 Move external brand visible surfaces to `SceneMaterial`
- [x] 5.4 Use stable PCF shadows and art tokens in Appearance preview
- [x] 5.5 Stop forwarding `SceneMaterial` internal control props to Three.js material nodes

## 6. Verification

- [x] 6.1 Run workspace dependency setup in isolated worktree
- [x] 6.2 Run `pnpm --filter @offisim/ui-core build`
- [x] 6.3 Run `pnpm --filter @offisim/ui-office build`
- [x] 6.4 Run `pnpm --filter @offisim/ui-office typecheck`
- [x] 6.5 Run `pnpm --filter @offisim/web typecheck`
- [x] 6.6 Run `pnpm --filter @offisim/web build`
- [x] 6.7 Run `pnpm tokens:lint-hex`
- [x] 6.8 Run browser live screenshot verification
- [x] 6.9 Build and launch release desktop `.app` for final 3D verification
- [x] 6.10 Attach release `.app` with Computer Use and capture final desktop evidence

## 7. Evidence

- Browser label layout: `.live-verify/3d-polish-office-desktop-fixed.png`, `.live-verify/3d-polish-office-mobile-fixed.png`, `.live-verify/3d-polish-label-overlap-report.json` (`desktop.overlapCount = 0`, `mobile.overlapCount = 0`).
- Browser prefab semantics: `.live-verify/3d-polish-prefab-variants-browser.png`, `.live-verify/3d-polish-prefab-variants-report.json` covering `workstation-dual`, `server-rack-4u`, `gpu-cluster`, `meeting-table-4`, `plant-small`, and `plant-large`.
- Release desktop: `pnpm --filter @offisim/desktop build` produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; launched the release app and attached `com.offisim.desktop` through Computer Use.
- Release screenshot artifact after Computer Use attach: `.live-verify/3d-polish-release-app-computer-use.png`.
- Production audit: `.live-verify/3d-polish-production-audit.md`.
