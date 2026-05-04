# 桶 6 + 7 + 8 — live verify record

**Built**: 2026-05-04
**Built from**: f784ca7f (Settings dbb2bde9 / Personnel 20fdf659 / SOP f784ca7f)
**.app path**: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

```bash
osascript -e 'quit app "Offisim"' 2>/dev/null
open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

Drop screenshots into this directory; tick + 1-line note per scenario.

---

## 桶 8 — Settings layout (#11)

### S1: max-w-5xl removed
- [ ] Open Settings → Provider tab. Confirm content fills the workspace width on a 1440+ display (no large empty right margin / "red rectangle").
- [ ] Switch to Runtime tab. Multi-col grids (Execution / Theme / Density / Default runtime / Memory) span the full width.
- Capture: `S1-provider-fluid.png`, `S1-runtime-fluid.png`
- Note:

### S2: Section gap density
- [ ] Visual: gap between SettingsSections feels 16-20px (was 24-32px). No cards-in-cards.
- Capture: `S2-runtime-density.png`
- Note:

### S3: Save bar still works
- [ ] Edit a Provider field, confirm save bar shows "Save provider + runtime changes", click → success toast.
- Capture: `S3-save-bar.png`
- Note:

### S4: Light + dark theme
- [ ] Toggle theme. Visual integrity holds in both modes.
- Capture: `S4-light.png`, `S4-dark.png`
- Note:

---

## 桶 7 — Personnel resume layout (#9)

### P1: DetailHeader is horizontal
- [ ] Open Personnel → pick any employee. Header is a single row (avatar 64px left, name+role middle, Enabled / External chips right). NOT center stack.
- Capture: `P1-detail-header.png`
- Note:

### P2: Profile tab is multi-column on lg+
- [ ] Profile tab body shows Identity / Persona / Config / Skills sections in 2 columns at ≥1024px width. No max-w-2xl center column.
- Capture: `P2-profile-2col.png`
- Note:

### P3: Other tabs span full pane
- [ ] Cycle through Appearance / Runtime / Skills / Memory / History. None are clamped to a narrow center column. Forms / lists fill the pane.
- Capture: `P3-runtime-tab.png`, `P3-memory-tab.png`
- Note:

### P4: Personnel sidebar header
- [ ] Search input padding tighter (no big top whitespace before the search box). Role filter sits below search; collapse button right-aligned in the row when not narrow.
- Capture: `P4-sidebar-header.png`
- Note:

### P5: Save bar full-width
- [ ] In Profile tab edit mode, sticky save bar buttons span the pane edges (not aligned to a 672px column).
- Capture: `P5-save-bar.png`
- Note:

---

## 桶 6 — SOP canvas (#16)

### Q1: Toolbar regroup
- [ ] Open SOPs workspace. Toolbar shows: Run + Edit + (when Edit on) Add Step + Auto Layout · spacer · Sync + Delete. NO Import / Create buttons there (they live in the sidebar header).
- Capture: `Q1-toolbar-default.png`, `Q1-toolbar-edit-mode.png`
- Note:

### Q2: Add Step in toolbar (NOT bottom-right corner)
- [ ] Toggle Edit mode. Confirm Add Step button is in the toolbar; bottom-right corner of canvas is empty.
- [ ] Click toolbar Add Step → popover opens at canvas centre.
- Capture: `Q2-add-step-toolbar.png`, `Q2-popover.png`
- Note:

### Q3 (deferred): Drag step card vs canvas pan
- [ ] Edit mode: drag a step card → card moves (not canvas).
- [ ] Edit mode: drag empty canvas → canvas pans (not card).
- Capture: `Q3-drag-card.png`, `Q3-pan-empty.png`
- If broken: report exactly which side (card-doesn't-move / canvas-also-pans / something else) — root cause fix needed.
- Note:

### Q4 (deferred): Connect-drag end to end
- [ ] Edit mode: hover an output port → port goes opaque/active.
- [ ] Drag from output port → dashed Bezier line follows cursor.
- [ ] Hover input port on another step → highlight.
- [ ] Release on input port → edge created.
- Capture: `Q4-port-hover.png`, `Q4-bezier.png`, `Q4-edge-created.png`
- If broken: report which step fails.
- Note:

---

## Aggregate

- 桶 8 Settings: __ / 4
- 桶 7 Personnel: __ / 5
- 桶 6 SOP toolbar: __ / 2 + Q3/Q4 deferred-or-fail
- Decisions / known limitations:
  - 桶 6 Q3/Q4 reserve root-cause fixes if live verify catches a regression (commit message documents the intended structure).
