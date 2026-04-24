## Why

The current main application UI has several blocking UX issues: narrow screens can clip primary company-creation CTAs, Office overlays and panels compete for attention, modal closing behavior is inconsistent, and key workflows such as Dashboard/Kanban discovery and workspace empty/error recovery rely on hidden or unclear paths. This change turns the screenshot audit into an implementation-ready UX contract so the product can ship a more stable, discoverable, and responsive work surface without changing backend data models.

## What Changes

- Make the app shell, Company Portal, and template wizard responsive across desktop, tablet, and 390px narrow viewports with no horizontal overflow or obstructed primary CTA.
- Add a unified dialog/overlay interaction protocol covering close buttons, Escape, Cancel/Back actions, backdrop behavior, focus containment, and shortcut suppression while overlays are active.
- Make Office tools discoverable through visible Header entries for Studio, Dashboard, Kanban, and Add Employee, while keeping Office/SOPs/Market/Activity/Settings as peer workspace navigation.
- Reduce Office visual competition by making task input the right-panel priority, moving first-run guidance inline, and preserving 2D/3D view switching without overlaying key work areas.
- Improve SOP, Market, Activity, Settings, Studio, Employee Inspector, and Employee Creator surfaces with actionable default states, error states, empty states, and non-obscuring bottom actions.
- Consolidate shared UI primitives for surfaces, toolbars, segmented controls, empty/error states, and dialog shells while preserving the existing dark office-oriented product direction.
- No backend data model, provider API, LLM runtime, or `WorkspaceKey` changes are required.

## Capabilities

### New Capabilities
- `responsive-app-shell`: Responsive layout behavior for AppLayout, Company Portal, template wizard, and sticky action areas across desktop/tablet/narrow viewports.
- `dialog-overlay-protocol`: Shared dialog and overlay interaction rules for closing, focus, Escape priority, backdrop behavior, and keyboard shortcut gating.
- `office-tool-discovery`: Visible Office tool navigation and hierarchy rules for Studio, Dashboard, Kanban, Add Employee, 2D/3D switching, and first-run guidance.
- `workspace-state-surfaces`: Shared actionable empty/error/default-state behavior for SOP, Market, Activity, Settings, Studio, Employee Inspector, and Employee Creator surfaces.
- `design-system-consolidation`: Shared presentational primitives and visual constraints for surface cards, empty/error states, toolbars, segmented controls, dialog shells, radius, spacing, letter spacing, and accent usage.

### Modified Capabilities
- `unified-shell-routing`: Header behavior changes to distinguish peer workspace navigation from Office-scoped tools while still rendering through a single AppLayout.
- `workspace-state-management`: Dashboard and Kanban can be opened from visible Office tool entries in addition to shortcuts, using the existing Office session state update path.

## Impact

- Affected UI packages and app code:
  - `apps/web/src/components/app-shell/*`
  - `apps/web/src/hooks/useAppKeyboardShortcuts.ts`
  - `packages/ui-office/src/components/layout/AppLayout.tsx`
  - `packages/ui-office/src/components/header/*`
  - `packages/ui-office/src/components/company/*`
  - `packages/ui-office/src/components/office/*`
  - `packages/ui-office/src/components/settings/*`
  - `packages/ui-office/src/components/workspaces/*`
  - shared UI primitives in `packages/ui-core` or the nearest existing UI package
- Testing impact:
  - Add screenshot-based manual QA coverage for `1440x900`, `1280x800`, and `390x844`.
  - Validate overlay close behavior through click, Escape, Cancel/Back, and shortcut interactions.
  - Run `pnpm typecheck` and `pnpm lint`.
- No database migrations, backend service changes, or external API integrations are expected.
