## Context

The audit covered the Web/Tauri main app screens: Company Portal, template wizard, Office 3D/2D, employee inspector and creator, SOP, Market, Settings, Studio, Company Editor, Dashboard, Notifications, Activity Log, and a 390px narrow viewport. The current implementation already has a single `AppLayout` render path, workspace session state, overlay state, and settings/workspace decomposition specs. This change keeps those architectural boundaries and focuses on user-visible UX behavior.

The highest-risk surfaces are cross-cutting: layout width behavior, Header navigation, overlay/dialog semantics, and repeated empty/error/default-state patterns. The change should therefore add a small set of shared UI contracts instead of fixing each screen with independent ad hoc rules.

## Goals / Non-Goals

**Goals:**

- Make the main app usable at `1440x900`, `1280x800`, and `390x844` without horizontal clipping, obstructed CTAs, or bottom action bars covering content.
- Separate peer workspaces from Office-scoped tools so users can discover Dashboard and Kanban without keyboard shortcuts.
- Normalize modal and overlay behavior so closing, focus, Escape priority, and shortcut suppression behave consistently.
- Improve the default, empty, and error states for SOP, Market, Activity, Settings, Studio, Employee Inspector, and Employee Creator.
- Consolidate shared presentational primitives while preserving the current dark office product direction.

**Non-Goals:**

- No backend schema changes, provider API changes, real platform API work, or LLM/runtime behavior changes.
- No brand redesign or replacement of the simulated office metaphor.
- No requirement to make Launcher part of this change beyond avoiding regressions.
- No committed E2E test suite is required by this change; screenshot QA may remain local/manual.

## Decisions

### Decision: Keep `AppLayout`, but define three responsive modes

Use the existing `AppLayout` as the single shell and formalize `desktop`, `tablet`, and `narrow` behavior around measured viewport width. Desktop keeps the three-region work surface. Tablet allows rails to collapse. Narrow switches core onboarding/company flows to stacked single-column presentation and prevents side rails from consuming primary CTA space.

Alternative considered: create separate mobile-only pages. That would reduce short-term CSS complexity, but it would fork product behavior and likely drift from the Tauri/Web shell. The single-shell approach better preserves existing workspace routing contracts.

### Decision: Introduce shared dialog semantics through `DialogShell`

Dialogs and full-screen overlays should use one interaction protocol: close button, Escape, Cancel/Back action, optional backdrop click, focus containment, and shortcut suppression. Existing overlay state remains the source of truth; `DialogShell` or an equivalent wrapper standardizes behavior without changing `OverlayKey`.

Alternative considered: fix each modal independently. That would be faster per screen but would not prevent recurrence of the Company Editor/Escape layering issue.

### Decision: Render visible Office tools from navigation configuration

Add a typed navigation configuration that distinguishes peer workspace items from Office tool entries. Office tool entries invoke existing overlay/workspace-state actions for Studio, Dashboard, Kanban, and Add Employee. Dashboard/Kanban remain Office overlays backed by `OfficeSessionState`; keyboard shortcuts remain as accelerators, not the primary discovery mechanism.

Alternative considered: promote Dashboard and Kanban to peer `WorkspaceKey` values. That would make navigation simpler but would create unnecessary routing and persistence churn for surfaces that are still Office-scoped overlays.

### Decision: Make right-panel task input the Office priority

The Office right panel should prioritize task input and current task context. First-run guidance moves inline into the relevant panel or content area rather than floating across Chat/Tasks. Scene labels, panel handles, onboarding prompts, and assistant/task controls should have clear priority so the scene remains inspectable.

Alternative considered: hide the right panel by default. That would improve visual clarity but would bury the core task input workflow.

### Decision: Add shared empty/error/default-state primitives

SOP, Market, Activity, Settings, Studio, and employee surfaces should reuse shared `EmptyState` and `ErrorState` primitives with title, reason, next action, and optional secondary action. Screen-specific content stays local, but the structure and hierarchy are shared.

Alternative considered: custom state blocks per workspace. That would keep each screen flexible but would continue the current inconsistency and weaker recovery guidance.

### Decision: Consolidate visual primitives without a brand reset

Add or standardize `SurfaceCard`, `Toolbar`, `SegmentedControl`, `DialogShell`, `EmptyState`, and `ErrorState`, then migrate high-risk surfaces first. Keep the dark office aesthetic, but reduce overuse of large radii, all-caps metadata, monospaced text, heavy glass, and cyan accents.

Alternative considered: rewrite the design language globally. That is out of scope and would slow down the UX stability work.

## Risks / Trade-offs

- [Risk] Responsive fixes may expose assumptions in fixed-width panels and canvas sizing. → Mitigation: validate screenshots at `1440x900`, `1280x800`, and `390x844`, and measure horizontal overflow explicitly.
- [Risk] Shared dialog behavior may conflict with existing overlay-specific Escape order. → Mitigation: keep `workspace-state-management` Escape priority and only standardize the dialog-level close protocol around it.
- [Risk] Header may become crowded after adding visible Office tools. → Mitigation: render Office tools as a grouped menu/toolbar on constrained widths while keeping peer workspace navigation visible.
- [Risk] Empty/error-state copy can become too verbose in compact work surfaces. → Mitigation: require one primary action and concise reason text; put secondary details behind a small details affordance where needed.
- [Risk] Design-system cleanup can become a broad visual refactor. → Mitigation: limit required migration to surfaces touched by this change and enforce constraints through components rather than global restyling.

## Migration Plan

1. Add shared UI primitives and dialog/overlay protocol wiring without changing screen behavior.
2. Update AppLayout/Header navigation grouping and Office tool entries.
3. Fix responsive Company Portal/template wizard flows and sticky action-area padding.
4. Improve Office right-panel hierarchy, first-run guidance placement, and employee inspector/creator behavior.
5. Apply shared empty/error/default states to SOP, Market, Activity, Settings, and Studio.
6. Run `pnpm typecheck`, `pnpm lint`, and screenshot QA across the required viewports.

Rollback is straightforward because no persistence or backend schema changes are introduced. UI changes can be reverted component-by-component while preserving the existing workspace/session state contracts.
