# 桶 6 + 7 + 8 — live verify record

**Built**: 2026-05-04
**Built from**: 90dbc26d (SOP Q2/Q3/Q4 regression fixes) over afe1cef9 / f784ca7f / 20fdf659 / dbb2bde9
**.app path**: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
**Release app mtime**: 2026-05-04 17:38:41 +1200
**Live verify runner**: Codex Computer Use, release app pid 53176, URL `tauri://localhost/sops/sop_1888af03-8655-4943-b19c-62c4b0639161`
**Launch note**: the previous pid 44314 was closed via Computer Use; the exact release `.app` path below was opened again before the Q2/Q3/Q4 retest.
**Final Q3/Q4 fix build**: current worktree over `69676f3c`, release `.app` mtime 2026-05-04 18:50:25 +1200, Computer Use release app pid 74601. Root fix: `SopDagCanvas` no longer renders node faces through SVG `foreignObject`; HTML node overlay and SVG interaction layer now share the same translate/scale.

```bash
open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

Computer Use screenshots were captured in-session for each visual checkpoint; tick + 1-line note per scenario below.

---

## 桶 8 — Settings layout (#11)

### S1: max-w-5xl removed
- [x] Open Settings → Provider tab. Confirm content fills the workspace width on a 1440+ display (no large empty right margin / "red rectangle").
- [x] Switch to Runtime tab. Multi-col grids (Execution / Theme / Density / Default runtime / Memory) span the full width.
- Capture: `S1-provider-fluid.png`, `S1-runtime-fluid.png`
- Note: PASS — Provider and Runtime content fill the available Settings workspace in release `.app`; Runtime top row spans three columns and memory row spans the content width.

### S2: Section gap density
- [x] Visual: gap between SettingsSections feels 16-20px (was 24-32px). No cards-in-cards.
- Capture: `S2-runtime-density.png`
- Note: PASS — Runtime sections are tight and separated by simple section dividers; no nested card stack observed.

### S3: Save bar still works
- [x] Edit a Provider field, confirm save bar shows "Save provider + runtime changes", click → success toast.
- Capture: `S3-save-bar.png`
- Note: PASS — endpoint override was temporarily changed to add a trailing slash; save bar enabled with `Save provider + runtime changes`; click produced `Provider configuration saved`. Field was restored to `https://api.minimax.io/anthropic` and saved again.

### S4: Light + dark theme
- [x] Toggle theme. Visual integrity holds in both modes.
- Capture: `S4-light.png`, `S4-dark.png`
- Note: PASS — Runtime tab held layout and contrast in both light and dark; restored to Light after verification.

---

## 桶 7 — Personnel resume layout (#9)

### P1: DetailHeader is horizontal
- [x] Open Personnel → pick any employee. Header is a single row (avatar 64px left, name+role middle, Enabled / External chips right). NOT center stack.
- Capture: `P1-detail-header.png`
- Note: PASS — Alex Chen header renders as one horizontal row: 64px avatar left, name/role middle, Enabled chip right.

### P2: Profile tab is multi-column on lg+
- [x] Profile tab body shows Identity / Persona / Config / Skills sections in 2 columns at ≥1024px width. No max-w-2xl center column.
- Capture: `P2-profile-2col.png`
- Note: PASS — Profile content uses the right-side editor pane width and renders Identity / Persona side-by-side; lower Config / Skills content remains in the same pane rather than a centered max-w column.

### P3: Other tabs span full pane
- [x] Cycle through Appearance / Runtime / Skills / Memory / History. None are clamped to a narrow center column. Forms / lists fill the pane.
- Capture: `P3-runtime-tab.png`, `P3-memory-tab.png`
- Note: PASS — Appearance, Runtime, Skills, Memory, and History all fill the same right-side editor pane; no centered narrow column clamp observed. Note: the larger middle resume area remains mostly blank in this route, outside the right editor pane.

### P4: Personnel sidebar header
- [x] Search input padding tighter (no big top whitespace before the search box). Role filter sits below search; collapse button right-aligned in the row when not narrow.
- Capture: `P4-sidebar-header.png`
- Note: PASS — Search starts near the top of the sidebar, role filter is directly below it, and collapse control sits on the right of the header row.

### P5: Save bar full-width
- [x] In Profile tab edit mode, sticky save bar buttons span the pane edges (not aligned to a 672px column).
- Capture: `P5-save-bar.png`
- Note: PASS — editing Name enabled the sticky Save button across the right editor pane; saved once, then restored the name to `Alex Chen` and saved again.

---

## 桶 6 — SOP canvas (#16)

### Q1: Toolbar regroup
- [x] Open SOPs workspace. Toolbar shows: Run + Edit + (when Edit on) Add Step + Auto Layout · spacer · Sync + Delete. NO Import / Create buttons there (they live in the sidebar header).
- Capture: `Q1-toolbar-default.png`, `Q1-toolbar-edit-mode.png`
- Note: PASS — selected SOP default toolbar shows Run / Edit / Delete; Edit mode shows Run / Editing / Add Step / Auto Layout, saved-state badge, and Delete at the right. Import/Create are only in the sidebar header, not the canvas toolbar.

### Q2: Add Step in toolbar (NOT bottom-right corner)
- [x] Toggle Edit mode. Confirm Add Step button is in the toolbar; bottom-right corner of canvas is empty.
- [x] Click toolbar Add Step → popover opens at canvas centre.
- Capture: `Q2-add-step-toolbar.png`, `Q2-popover.png`
- Note: PASS after 90dbc26d retest — Add Step stayed in the toolbar, the old bottom-right button remained absent, and the popover opened inside the SOP canvas near the middle of the visible graph instead of the sidebar/header top-left.

### Q3 (deferred): Drag step card vs canvas pan
- [x] Edit mode: drag a step card → card moves (not canvas).
- [x] Edit mode: drag empty canvas → canvas pans (not card).
- Capture: `Q3-drag-card.png`, `Q3-pan-empty.png`
- If broken: report exactly which side (card-doesn't-move / canvas-also-pans / something else) — root cause fix needed.
- Note: FAIL after 90dbc26d retest — dragging visible step-card content still did not move the card. The retest no longer produced obvious browser text selection, but the graph entered a worse visual split: port hit circles/port visuals shifted away from the cards while the cards stayed in place. Exact failure: `card-doesn't-move` + `ports-detach-from-cards`.
- Note: FAIL after 69676f3c v2 retest in release `.app` pid 65177 (mtime 2026-05-04 18:07:23 +1200). Starting from a fresh Computer Use relaunch, the graph already renders split: visible cards stay around y~180-310 while ports/edges render around y~403. Dragging the visible first card from roughly (455,244) to (540,302) does not move the card; ports/edges shift downward/right. Dragging empty canvas from roughly (590,560) to (690,560) pans ports/edges only; cards remain fixed. Exact failure: `card-doesn't-move` + `canvas-pan-does-not-move-cards` + `ports-detach-from-cards`.
- Note: PASS after final overlay fix in release `.app` pid 74601. Starting from a fresh exact-path launch, node cards, ports, and edges render aligned. Dragging the first visible Requirements card from roughly (390,400) to (490,460) moved the card plus its ports and connected edges together; dragging empty canvas from roughly (650,560) to (750,560) panned cards, ports, edges, and grid together. No split layer, no card-only or port-only motion.

### Q4 (deferred): Connect-drag end to end
- [x] Edit mode: hover an output port → port goes opaque/active.
- [x] Drag from output port → dashed Bezier line follows cursor.
- [x] Hover input port on another step → highlight.
- [x] Release on input port → edge created.
- Capture: `Q4-port-hover.png`, `Q4-bezier.png`, `Q4-edge-created.png`
- If broken: report which step fails.
- Note: FAIL after 90dbc26d retest — dragging from the shifted visible output port to the next visible input port still produced no dashed Bezier preview and no new edge. Exact failure starts at `drag from output port`.
- Note: FAIL after 69676f3c v2 retest in release `.app` pid 65177. With Edit mode active, dragging from a visible output port near (632,461) toward another visible input/port target near (818,461) produced no dashed Bezier preview, no visible hover highlight, and no new dependency edge. Because cards and ports are already visually desynchronized before the drag, Q4 still fails at `drag from output port`; this no longer looks like only a transparent SVG bubbling issue.
- Note: PASS after final overlay fix in release `.app` pid 74601. Dragging from UI/UX Design output near (733,373) to Development input near (967,374) created a new dependency; Development immediately changed from `deps · 1` to `deps · 2`, the new edge appeared, and the save badge returned to `ALL CHANGES SAVED`. Switching to Bug Fix Pipeline and back to Feature Development redrew the graph with Development still at `deps · 2`, proving the edge was persisted, not a transient preview.

---

## Aggregate

- 桶 8 Settings: 4 / 4
- 桶 7 Personnel: 5 / 5
- 桶 6 SOP canvas: 4 / 4
- Decisions / known limitations:
  - 桶 6 Q3/Q4 reserve root-cause fixes if live verify catches a regression (commit message documents the intended structure).
  - 90dbc26d fixes Q2, but 桶 6 is still not live-verified because Q3 card drag detaches ports from cards and Q4 connect-drag still does not create a preview/edge.
  - 69676f3c v2 does not clear the release `.app` gate: Q3/Q4 still fail after fresh relaunch. New trace points to a layer/transform desync between `foreignObject` cards and native SVG ports/edges, not just pointer targeting.
  - Final overlay fix clears the release `.app` gate. Consolidated OpenSpec archive / queue / CLAUDE sync may proceed.
