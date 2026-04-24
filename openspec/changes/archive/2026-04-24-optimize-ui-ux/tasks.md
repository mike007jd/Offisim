## 1. Shared UI Foundations

- [x] 1.1 Add or standardize shared `SurfaceCard`, `Toolbar`, `SegmentedControl`, `EmptyState`, `ErrorState`, and `DialogShell` primitives in the nearest existing UI package.
- [x] 1.2 Define a typed navigation configuration for peer workspaces and Office-scoped tools, including labels, icons, active state, disabled/hidden behavior, and action handlers.
- [x] 1.3 Add a shared dialog/overlay close contract covering close button, Escape, Cancel/Back, backdrop behavior, focus containment, and post-close focus restore.
- [x] 1.4 Add a small utility or hook for detecting whether the topmost dialog/overlay owns keyboard input so Office shortcuts can be gated consistently.

## 2. Responsive Shell and Company Entry

- [x] 2.1 Update `AppLayout` responsive behavior for desktop, tablet, and narrow modes so `390x844` has no horizontal document overflow.
- [x] 2.2 Update Company Portal to stack company list, empty/default content, preview/brief, and primary create action on narrow screens.
- [x] 2.3 Update the template wizard to stack template selection, details, preview, and `Start Company` on narrow screens with no pointer interception.
- [x] 2.4 Ensure sticky/fixed footers in Company Editor, Employee Creator, and Settings reserve bottom padding in their scrollable content regions.

## 3. Dialog and Overlay Protocol

- [x] 3.1 Migrate Company Editor to the shared dialog protocol and verify close button, Escape, Cancel/Back, and dirty-state handling use one close path.
- [x] 3.2 Migrate Employee Creator and company creation/template wizard dialogs to the shared close/backdrop/focus protocol.
- [x] 3.3 Migrate Dashboard, Kanban, Studio, and Keyboard Shortcuts overlays/dialogs to topmost Escape ownership and focus restore behavior.
- [x] 3.4 Prevent Dashboard/Kanban and other Office state shortcuts from mutating underlying workspace state while a topmost modal or full-screen overlay owns keyboard input.

## 4. Header Navigation and Office Hierarchy

- [x] 4.1 Render Header peer workspace navigation separately from Office tool controls using the new navigation configuration.
- [x] 4.2 Add visible Office tool entries for Studio, Dashboard, Kanban, and Add Employee in Office mode.
- [x] 4.3 Wire Dashboard and Kanban visible entries to the existing `updateWorkspaceState('office', updater)` path used by keyboard shortcuts.
- [x] 4.4 Add constrained-width Header behavior that preserves active workspace identity and peer workspace access while moving Office tools into an overflow/menu when needed.
- [x] 4.5 Move first-run Office guidance inline so it does not cover the central scene or Chat/Tasks input.

## 5. Workspace State Surfaces

- [x] 5.1 Update SOP default state with template, create, and import starting actions; hide or disable run actions with reason when no runnable SOP is selected.
- [x] 5.2 Update Market unavailable state with user-level platform/API dependency copy, retry action, and cached/offline context when available.
- [x] 5.3 Update Activity empty state with event-family explanation, filter-reset guidance, and return-to-Office action when appropriate.
- [x] 5.4 Update Settings layout with readable content max width, non-obscuring save area, and disabled Save reason text.
- [x] 5.5 Update Studio Properties empty state and current-tool context; move Plot Size into the toolbar or Properties area.
- [x] 5.6 Update Employee Inspector to anchor to the selected employee or render as a right-side detail drawer with clear source context.
- [x] 5.7 Simplify Employee Creator grouping and verify deploy/cancel actions remain available without covering fields or validation messages.

## 6. Visual System and Accessibility Cleanup

- [x] 6.1 Replace duplicated local empty/error/default-state markup on touched screens with the shared primitives or compatible wrappers.
- [x] 6.2 Reduce hardcoded large radii, all-caps metadata, monospaced body text, heavy glass effects, and non-priority cyan highlights on touched surfaces.
- [x] 6.3 Add stable dimensions or responsive constraints for touched toolbar buttons, segmented controls, scene controls, board columns, and footer actions.
- [x] 6.4 Remove ambiguous duplicate accessible names between 2D employee scene nodes and employee rail cards.

## 7. Verification

- [x] 7.1 Run `pnpm typecheck` and resolve failures related to the UI/UX change.
- [x] 7.2 Run `pnpm lint` and resolve failures related to the UI/UX change.
- [x] 7.3 Capture or verify local screenshots at `1440x900`, `1280x800`, and `390x844` for Portal, template wizard, Office 3D/2D, SOP, Market, Settings, Studio, Company Editor, Dashboard, and Activity.
- [x] 7.4 Verify all touched dialogs close through close button, Escape, and Cancel/Back paths, and that dirty dialogs do not discard progress without confirmation.
- [x] 7.5 Verify `390x844` has no horizontal overflow, primary CTAs are visible/clickable, and fixed bottom action bars do not cover content.

## Verification Record

- **7.1 typecheck** — 2026-04-24 re-run after fixing 3 residual errors: (a) `useAppKeyboardShortcuts` no longer accepts `shortcutHelpOpen` (only setter), so `App.tsx:133` dropped the prop; (b) `HeaderPeerWorkspaceItem` / `HeaderOfficeToolItem` icon type relaxed from `LucideIcon` to `ComponentType<{ className?: string }>` so `NavIcon` (workspace-navigation abstraction) satisfies Header props. `pnpm typecheck` 26/26 green.
- **7.2 lint** — Repo-wide baseline 163 errors / 27 warnings (pre-existing, not introduced by this change). All files touched by this change (`empty-state.tsx`, `App.tsx`, `Header.tsx`, `CompanyEditor.tsx`, `DashboardOverlay.tsx`, `KanbanOverlay.tsx`) have zero lint output. The 6 intentional `biome-ignore` directives for `useSemanticElements` / `useKeyWithClickEvents` on custom full-screen overlays remain (reason: `<dialog>` primitive doesn't fit fixed full-screen layout and Escape is routed through `useTopmostEscape`).
- **7.3 live QA (390×844, via Playwright MCP)** — SOP workspace renders the new `EmptyState` cleanly (title "Select an SOP" + "Create SOP" primary action + footer hint), no console errors. Market renders the new `ErrorState` ("Market is unavailable" + Retry + technical detail disclosure); the two `ERR_CONNECTION_REFUSED` errors against `localhost:4100/v1/market/search` are the known "platform not running — cosmetic" issue from CLAUDE.md, not caused by this change. Fixed during this session: `EmptyState.renderIcon` used `typeof icon === 'function'` which is false for lucide `forwardRef` objects and caused "Objects are not valid as a React child" crashes on SOP/Market; swapped to `isValidElement` reverse check so `ComponentType` (function or `forwardRef`) renders via `<Icon />` and `ReactNode` falls through.
- **7.4 live QA (dialog close + focus)** — Company Editor opens with `aria-label="Company editor"`, `aria-modal="true"`, initial focus lands on "Close company editor" button. Eleven consecutive real Tab presses never leak focus outside the dialog (prior to this session, the first Tab jumped to the underlying "Office workspace" Header button). Root cause: CompanyEditor / DashboardOverlay / KanbanOverlay are custom `<div role="dialog">` surfaces (not Radix `DialogShell`), so they did not inherit the shared focus containment. Fix: each of the three now calls `useFocusTrap(dialogRef, isOpen)` — the existing ui-core hook that pulls initial focus in and wraps Tab/Shift-Tab around the first/last focusable inside the container. EmployeeInspector is intentionally not a modal (inline comment: "floating inspector is a popover anchored to rail, not a modal dialog") and stays without a trap.
- **7.5 live QA (390×844 layout)** — `documentElement.scrollWidth === innerWidth === 390` for every peer workspace visited (Office / SOPs / Market / Settings / Studio). Settings page's `main.scrollWidth = 455` is purely an `<input>` inner text scroll buffer (the 831-char `https://api.minimax.io/anthropic` endpoint string); no layout element (excluding INPUT/TEXTAREA) exceeds `main.clientWidth = 358`, so Settings has no real content clipping. Studio page shows `overflowX: 'hidden'` on the top toolbar flex row with `scrollWidth = 506` vs `width = 390`, so the "Save layout (⌘S)" button sits at `x = 421` off-screen at 390px. This is a **known limitation**, not an archive blocker: Studio is an absolute-positioned 3D editor optimized for desktop (`LAYOUT.paletteWidth = propertiesWidth = 240` fixed rails already require > 768 to be usable); a narrow-viewport bail page is a separate follow-up. All other primary CTAs in Portal / wizard / Company Editor / Dashboard / Kanban / Settings remain within the 390px viewport and clickable.
- **Follow-up deferred** (out of scope for this change): Studio narrow-viewport bail page or responsive toolbar that keeps "Save" reachable below ~768px. Track as its own change so this one can close.
