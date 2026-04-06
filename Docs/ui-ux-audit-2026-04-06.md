# Offisim UI/UX Full Audit Report

**Date**: 2026-04-06
**Method**: Playwright visual + accessibility snapshot, 1440x900 & 1024x768
**Scope**: All screens — main office, all sidebar tabs, all dialogs/overlays, Studio, responsive

---

## P0 — Critical (Blocks usability or causes data loss)

### 1. SOP Drawer timeline truncation — no scroll indicator
**Location**: Right sidebar > SOPs tab > click any SOP > SopDrawer
**Evidence**: scrollWidth=800, clientWidth=447 — 353px of content hidden. Only 2-3 of 5 batches visible. "Technical Architec..." text truncated. No scrollbar, no arrows, no fade-out hint.
**Impact**: User cannot see or interact with the full SOP definition. Core feature rendered unusable in the 480px drawer.
**Fix**: Either switch to vertical timeline layout (better for narrow width), or add visible scroll indicators (arrows + fade edges). Consider a dedicated full-width SOP editor dialog instead of a narrow drawer.

### 2. Settings dialog closes on outside click — unsaved data loss
**Location**: Settings > any tab with form input (API Key, MCP Server URL)
**Evidence**: Dialog has no modal backdrop. Clicking outside dismisses it immediately.
**Impact**: User editing API Key or MCP URL will lose input on accidental outside click.
**Fix**: Add modal backdrop, or warn before closing with unsaved changes.

### 3. Notification popover blocks right sidebar tabs + no outside-click dismiss
**Location**: Header > Notifications bell button
**Evidence**: Popover uses `absolute right-0 top-full z-50 w-72`, overlaps right sidebar tab area. No click-outside handler. Can only close by re-clicking bell.
**Impact**: After opening notifications, user cannot click sidebar tabs underneath. Popover persists across dialog opens.
**Fix**: Use Radix Popover (auto-dismiss), or add click-outside + Escape handlers. Auto-close when other dialogs/overlays open.

### 4. 1024px width: panels don't auto-collapse, 3D scene crushed to ~360px
**Location**: Main layout at viewport width <= 1280px
**Evidence**: Left (280px) + Right (280px) panels both stay open. Scene area: ~360px. Zone labels clipped.
**Impact**: Office scene is unusable at laptop-width resolutions. Current breakpoint (768px) is too narrow.
**Fix**: Auto-collapse right panel at <= 1280px, or add a breakpoint at 1024px.

---

## P1 — High (Significantly hurts UX but doesn't block)

### 5. Header button heights inconsistent — 4 different heights in one row
**Location**: Header bar
**Evidence**: 3D/2D toggle: 24-26px, Company chip: 28px, Install Package: 32px, Icon buttons: 36px.
**Impact**: Visual rhythm is broken. Header feels unpolished.
**Fix**: Standardize all header controls to 32px height.

### 6. Red button color misuse — Save/Connect/Add all use destructive red
**Location**: Settings > "Save Configuration", "Add & Connect" (MCP), "Connect" (OpenClaw)
**Evidence**: All positive-action buttons use red background, same color as Delete buttons.
**Impact**: Red = destructive in standard UI semantics. Users hesitate to click "Save" when it looks like "Delete".
**Fix**: Use blue/emerald for positive actions, reserve red for Delete/Archive only.

### 7. "AGENT_DEPLOYMENT_INTERFACE" naming + terminology inconsistency
**Location**: Add Employee dialog title
**Evidence**: Title says "AGENT_DEPLOYMENT_INTERFACE", button says "Deploy Agent", but header says "Add Employee" and left panel says "Team".
**Impact**: Three different terms (Employee, Agent, Team Member) for the same concept. Confusing.
**Fix**: Standardize on "Employee" throughout. Rename dialog to "New Employee", button to "Add Employee".

### 8. Chat area shows two duplicate "Configure API Key" messages
**Location**: Chat panel when no API key configured
**Evidence**: Yellow banner at top + gray text at bottom both say "Configure an API Key".
**Impact**: Redundant messaging wastes space and feels unpolished.
**Fix**: Keep the actionable banner (has "Open Settings" button), remove the bottom text.

### 9. Event Log text truncation in 280px sidebar
**Location**: Right sidebar > Events tab
**Evidence**: "employee_direct_setup comp..." / "employee state: idle → executi..." — key information cut off.
**Impact**: Users can't read event details without hovering.
**Fix**: Wrap long event names to 2 lines, or move timestamp to second line to free horizontal space. Add tooltip on hover.

### 10. Default chat height (35%) occludes office zones
**Location**: Chat drawer in 900px viewport
**Evidence**: 315px default height covers PRODUCT and ART & DESIGN zones in 3D scene.
**Impact**: User's first impression of the office is incomplete. Must manually resize chat to see full layout.
**Fix**: Lower default to ~22% (200px), or default to compact mode.

### 11. Right sidebar tab icons have no text labels — poor discoverability
**Location**: Right sidebar tab bar (7 icon-only tabs)
**Evidence**: All tabs are icon-only (~37px each). Terminal icon for Tasks, scissors for SOPs, grid for Outputs — non-standard mappings.
**Impact**: New users cannot identify tabs without hovering each one. Even experienced users mis-click.
**Fix**: Show text label on selected tab at minimum. Or add small text below each icon.

---

## P2 — Medium (Visible polish/consistency issues)

### 12. Employee Inspector is an undersized floating card (~220x180px)
**Location**: Click employee in left panel or 3D scene
**Evidence**: Tiny card with only: name, role, status, "No active task", Chat/Edit buttons. No expertise, zone, recent activity.
**Impact**: Inspector provides almost no useful information. Users immediately need to click Edit for anything useful.
**Fix**: Expand to a proper inspector sidebar panel with more context, or at least show expertise summary and current zone.

### 13. SOP card descriptions truncated in sidebar list
**Location**: Right sidebar > SOPs tab
**Evidence**: "Standard feature development f..." / "Structured bug investigation an..." — single-line truncation.
**Fix**: Allow 2-line descriptions (`line-clamp-2`) or make cards taller.

### 14. Event Log entry interactivity inconsistent
**Location**: Right sidebar > Events tab
**Evidence**: Some entries are `<button>` (clickable), others are `<div>` (non-interactive). Visually identical.
**Impact**: User can't predict which events are interactive.
**Fix**: Uniform visual treatment — all clickable, or clearly differentiate read-only entries.

### 15. Settings red dot on gear icon — meaning unclear
**Location**: Header > Settings button, top-right red dot (8x8px)
**Evidence**: No tooltip, no number badge. Separate "Configure API Key" button already exists.
**Impact**: User doesn't know what the dot means or what action to take.
**Fix**: Remove red dot if "Configure API Key" button already handles the CTA. Or add tooltip "API Key not configured".

### 16. Company Settings pencil icon grouped ambiguously with company chip
**Location**: Header > company chip area
**Evidence**: Pencil icon (28x28) immediately adjacent to company dropdown, no visual separator.
**Impact**: User might think it's part of the dropdown toggle rather than a separate action.
**Fix**: Add 4px gap + divider, or merge into company dropdown menu.

### 17. 3D zone labels visible through/behind sidebars
**Location**: 3D scene with panels open
**Evidence**: "MEETING ROOM" shows as "ETING ROOM", "LIBRARY" as "ARY" — HTML overlays not clipped to scene bounds.
**Fix**: Clip zone labels to the scene viewport area, or hide labels when occluded by panels.

### 18. All employees cluster in REST AREA when idle — label overlap
**Location**: 2D/3D scene, all employees idle
**Evidence**: 8 employees stacked in REST AREA, name labels overlapping.
**Fix**: Spread idle employees across the REST AREA using the spiral layout, or keep some at their workstation zones.

### 19. Tasks tab empty state too bare vs other tabs
**Location**: Right sidebar > Tasks tab
**Evidence**: Just "No active plan" text. Compare: Outputs has icon + title + description, Server has icon + description + inline form, Library has icon + description + Upload button.
**Fix**: Add icon and brief guidance text ("Send a task via chat to create a plan").

### 20. Marketplace tab error message unfriendly
**Location**: Right sidebar > Market tab
**Evidence**: "Marketplace unavailable. Failed to fetch" — raw error, no icon, no retry button.
**Fix**: Show friendly message ("Could not connect to marketplace server") + retry button + help text.

### 21. 03 ATTRIBUTES section in Add Employee is non-functional
**Location**: Add Employee dialog > step 3
**Evidence**: Shows "Display only -- trait tuning coming in a future update". Uneditable.
**Impact**: Creates a dead zone in the UI. Users may try to interact and feel confused.
**Fix**: Hide section until functional, or show it collapsed/dimmed with "Coming soon" label.

### 22. Employee Edit Delete button has no confirmation dialog
**Location**: Employee Edit dialog > bottom-left red Delete button
**Evidence**: No confirmation step before deleting an employee.
**Fix**: Add confirmation dialog: "Delete Alex Chen? This cannot be undone."

### 23. Runtime Policy tab has no Save button (auto-save) but LLM Provider has one
**Location**: Settings dialog
**Evidence**: LLM Provider: explicit "Save Configuration" button. Runtime Policy: changes apply immediately.
**Impact**: Inconsistent save model confuses users.
**Fix**: Either add Save button to Runtime Policy, or make both tabs auto-save with visible confirmation.

---

## P3 — Minor / Polish

### 24. Status bar "Standby" label is ambiguous
**Fix**: Change to "Idle — No tasks running" or similar self-explanatory text.

### 25. Status bar "Proxy"/"Human" toggle has no tooltip
**Fix**: Add tooltip explaining the two modes.

### 26. Status bar version icon (Zap) meaning unclear
**Fix**: Remove icon or use a more standard version indicator.

### 27. 3D/2D toggle doesn't look like a segment control
**Evidence**: No container background/border, buttons look independent.
**Fix**: Add a visible container with shared background.

### 28. Add Employee wizard progress bar misleading
**Evidence**: 3-step progress bar, but all sections visible on one scrollable page.
**Fix**: Either make it a real step wizard, or remove the progress indicators.

### 29. Employee Edit skin/hair color pickers have no selected indicator
**Evidence**: 5 skin tones / 7 hair colors, no checkmark or ring on selected option.
**Fix**: Add ring border or checkmark overlay on selected color.

### 30. Config tab Skills empty state text too verbose
**Evidence**: "No runtime skill bound to this employee yet. Install a skill package..."
**Fix**: Shorten text, add "Go to Marketplace" link button.

### 31. Employee card edit icon (pencil) has no tooltip
**Fix**: Add tooltip "Edit employee".

### 32. "Configure API Key" button in header uses warning-amber style
**Evidence**: Amber border, tiny text (11px), looks like a warning badge not a CTA.
**Fix**: Make it more prominent — regular button with clear CTA styling.

### 33. Chat compact mode double-click toggle unreliable
**Evidence**: Double-click on resize handle sometimes triggers underlying buttons.
**Fix**: Stop event propagation on the resize handle.

### 34. Company selector "CUSTOM" label meaning unclear
**Fix**: Change to template name or remove if not informative.

### 35. Company selector "Archive Company" has no confirmation
**Fix**: Add confirmation dialog.

### 36. Employee Edit has 6 tabs — consider consolidation
**Evidence**: Profile, Persona, Config, Test, Memory, History.
**Fix**: Merge Profile + Persona. Consider moving Memory/History to inspector sidebar.

### 37. Studio bottom zone bar overflows at 768px height
**Evidence**: Zone buttons pushed below viewport at small heights.
**Fix**: Make zone bar horizontally scrollable or merge into left palette.

---

## Summary

| Severity | Count |
|----------|-------|
| P0 Critical | 4 |
| P1 High | 7 |
| P2 Medium | 12 |
| P3 Minor | 14 |
| **Total** | **37** |

## Recommended Fix Order

**Sprint 1 (P0 — do first)**:
1. SOP timeline: switch to vertical layout or add scroll indicators
2. Settings dialog: add modal behavior
3. Notification popover: add click-outside dismiss
4. Responsive: auto-collapse panels at <= 1280px

**Sprint 2 (P1 — do next)**:
5. Standardize header button heights
6. Fix red button color semantics
7. Unify Employee/Agent terminology
8. Remove duplicate API Key message
9. Fix Event Log truncation
10. Lower default chat height
11. Add text labels to sidebar tabs

**Sprint 3 (P2+P3 — polish pass)**:
12-37. Remaining items in priority order above.
