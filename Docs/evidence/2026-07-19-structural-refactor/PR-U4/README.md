# PR-U4 scene layer evidence

- Branch: `refactor/U4-office-scene-layer`
- Base: `origin/main@f105efc28bcfc171adb21dd62c40fcd4a532c434`
- Scope: roadmap PR-U4 only; no merge performed.

## Plan conformance

- `OfficeScene2D` now schedules the animation frame and invokes six ordered pure render passes: background, zones, flows, shelf, companion, and employees. Hit collection remains a once-per-frame assignment after the passes.
- `OfficeScene3D` delegates employee drag state to `useEmployeeDrag` and imports the flow-packet components from their own file.
- The shared projection module owns chip-tone ink, active flow target derivation, and 2D/3D flow-lane geometry. Renderer-specific colors remain local.
- The moved `FlowPacket` body has the same normalized SHA-256 before and after: `75e659546f5cde6d1d842a7cd07e1a84deeb8f6f0300a913b52f47f4f86`.
- The moved drag-listener inventory has the same normalized SHA-256 before and after: `12f972de1707eed0f011170b6e352477125668efa4198e5f60201a52f47f4f86`.

## §0 mechanical-equivalence audit

- Declared behavior deviation: **zero**.
- The final head preserves the exact base scheduling order: the draw closure is assigned inside the original no-dependency `useEffect`, the resize observer watches only the canvas parent, and the 2D backing store/projection uses that parent's `clientWidth` and `clientHeight`.
- The final head contains no `.off-office-center` viewport lookup, no second resize-observer target, and no viewport oracle/assertion. Those out-of-scope changes were removed before this evidence was finalized.
- The source baseline already clips the 2D canvas when the overflowed scene host is wider than the visible center panel. `after-02-office-2d.png` records the same known clipping in the final head; it is not claimed as fixed or as a regression introduced by this PR.
- No product contract, copy, projection coordinate, assertion quantity, release-gate semantic, fallback, or compatibility path changed.

## Automated verification

- `pnpm exec biome check <15 changed TypeScript files>`: pass.
- `git diff --check`: pass.
- `pnpm --filter @offisim/desktop-renderer typecheck`: pass.
- `pnpm --filter @offisim/desktop-renderer build`: pass.
- `pnpm harness:native-stage-sessions`: pass; `native-stage-sessions: PASS (targets, lifecycle, ACL, 16 typed commands)`.
- `node scripts/release-gates.mjs --lane=node`: pass; `[release-gates] 4 gate(s) green (lane: node)` and `No known vulnerabilities found`.
- `pnpm --filter @offisim/desktop build`: pass. Final bundle:
  `/Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- `codesign --verify --deep --strict --verbose=2 <app>`: valid on disk and satisfies its Designated Requirement. Developer ID timestamp: `19 Jul 2026 at 5:51:32 AM`, team `9MP925J67C`. Notarization was not attempted because the required Apple notarization credentials are not present.

## Release-app live verification

Computer Use was attached to the exact worktree release `.app` path above after resolving the final live-flow process as PID `97585`, `CGWindowNumber=33719`, title `Offisim`, and bounds `x=36,y=33,width=1440,height=884`. The executable path matched this worktree. The app was closed through Computer Use after verification and observed absent for 10 seconds.

- 3D/2D switching: pass. `after-01-office-3d.png` shows the 3D release scene. `after-02-office-2d.png` shows the final-head 2D scene with the source-baseline clipping explicitly retained.
- Drag/drop: pass. Alex Chen moved from the lower workstation to the Library edge and remained at the new placement. Evidence: `drag-before.png`, `after-03-drag-drop.png`.
- Project flow: pass. `after-04-project-flow-3d.png` captures a real 3D run with the `bash` tool live. A second real task executed `bash` → `sleep 30`; `after-05-project-flow-2d.png` captures that run while the `2D` control is active, stage status is `Working 1 / 4`, Stop is available, and the 2D employee work rings are visible. The run then reached `4 / 4 Done` and replied exactly `U4_STRICT_2D_FLOW_OK`.
- The earlier 11-second toggle recording was deleted because it represented the withdrawn viewport behavior, not this final head. It is not cited as evidence.

## Test-data cleanup

- The test Conversation containing `U4_STRICT_FLOW_OK` and `U4_STRICT_2D_FLOW_OK` was deleted through the release app. The project-conversation count changed from 14 to 13 and the app confirmed that messages, tool logs, approvals, deliverables, and run history were cleared.
- Post-delete SQLite checks found zero `U4_STRICT` rows in `agent_runs`, `pi_messages`, and `agent_events`.
- `git worktree list` showed no task worktree from either flow run; only this PR's development worktree remained. The temporary U4 build/log/screenshot files under `/private/tmp` were removed and a reverse scan returned no U4 temp artifact.

## Current-head screenshot hashes

- `after-01-office-3d.png`: `5452e396ea4e8e961a417170382066e1237a1e74ba1c1bf6a102a68a093c21e2`
- `after-02-office-2d.png`: `ad6adce2e45e2665dd04e099bdd0454d114ddcce4b89807556cadc7b8540e3e6`
- `after-03-drag-drop.png`: `178d09c7baa08ca2f4d8115d36c3d31179696b1e26d8103af1b3d0da4692b00f`
- `after-04-project-flow-3d.png`: `703e40bff14197c129fc5bc79547272b0839741a18f7e8e3a52d831ed18cb652`
- `after-05-project-flow-2d.png`: `4403d6266af443a2774dce386051e97903db72a428c01a69117985e6abbf7994`
