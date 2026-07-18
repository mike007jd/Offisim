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

## Declared deviation

The first release-app 3D to 2D switch exposed an existing layout-owner mismatch: the canvas host was `1576x663` at `x=-741`, while the visible center panel was `503x798` at `x=332`. The refactor made that latent mismatch visible because the extracted background pass initially centered the floor in the overflowed host. The scoped correction keeps the backing-store height owned by the scene host and derives the visible horizontal viewport from `.off-office-center`; the pure oracle is locked by `harness-native-stage-sessions`:

`projectOfficeCanvasViewport({ left: -741, height: 663 }, { left: 332, width: 503 }) -> { x: 1073, width: 503, height: 663 }`

No product contract, copy, projection coordinates, assertion quantity, or release-gate semantics changed. No fallback or compatibility path was added.

## Automated verification

- `pnpm exec biome check <changed TypeScript files>`: pass.
- `pnpm --filter @offisim/desktop-renderer typecheck`: pass.
- `pnpm --filter @offisim/desktop-renderer build`: pass.
- `pnpm harness:native-stage-sessions`: pass, including the real release-dimension oracle above.
- `node scripts/release-gates.mjs --lane=node`: pass; `[release-gates] 4 gate(s) green (lane: node)` and `No known vulnerabilities found`.
- `pnpm --filter @offisim/desktop build`: pass. Final bundle:
  `/Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- `codesign --verify --deep --strict --verbose=2 <app>`: valid on disk and satisfies its Designated Requirement. Developer ID timestamp: `19 Jul 2026 at 4:52:09 AM`, team `9MP925J67C`. Notarization was not attempted because the required Apple notarization credentials are not present.

## Release-app live verification

Computer Use was attached to the exact worktree release `.app` path above.

- 3D to 2D first switch: pass without resizing or maximizing. Within one second the full floor, seven zones, employees, and companion were visible. Evidence: `after-01-office-3d.png`, `after-02-office-2d.png`.
- 3D to 2D recording: pass. The resolver matched exact executable PID `64700` to `CGWindowNumber=33428`, title `Offisim`, bounds `x=36,y=33,width=1440,height=884`; `/usr/sbin/screencapture -v -V11 -R36,33,1440,884` then recorded the Computer Use interaction. `after-06-3d-2d-toggle.mov` is H.264, `2880x1768`, and `11.000000s` by `ffprobe`.
- Drag/drop: pass. Sophie Park moved from the Product seat to the Rest/Server vicinity and remained there in the running scene. Evidence: `drag-before.png`, `after-03-drag-drop.png`.
- Project flow: pass. One `sleep 30` run was captured while Alex was working in both views; 3D showed the line/packet and 2D showed the working ring/label. The run then reached `4 / 4 Done` and replied `done`. Evidence: `after-04-project-flow-3d.png`, `after-05-project-flow-2d.png`.
- Baseline comparison frames are retained as `before-01-office-3d.png`, `before-02-office-2d.png`, `before-03-project-flow-2d-tool.png`, `before-04-project-flow-3d.png`, and `before-04-project-flow-3d-tool.png`.
