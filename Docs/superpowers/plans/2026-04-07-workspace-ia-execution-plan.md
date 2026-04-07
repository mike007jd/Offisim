# Offisim Workspace IA Full Execution Plan

> I'm using the writing-plans skill to create the implementation plan.

> This file replaces the earlier shortcut migration plan and the first “page-card” rewrite. The prior pass correctly identified that `SOPs`, `Market`, and `Activity Log` must leave the overloaded right rail, but it still implemented them with modal/card thinking. This document is the new execution source of truth and assumes a real workspace-surface redesign.

## Goal

Rebuild the main product information architecture so that:

1. `Office` remains the default world/work surface.
2. `SOPs` becomes a serious full workspace with internal navigation and page-native detail flow.
3. `Market` becomes a serious full workspace with browse/detail/install/manage flows inside the page, not in overlays.
4. `Activity Log` becomes a real page distinct from the notification bell panel.
5. The right side becomes collaboration-only, not a warehouse of unrelated tools.
6. `Studio` remains an `Office` mode, never a peer workspace.

This plan includes all phases required to reach that state, including responsive behavior, rollback rules, overlay retirement rules, and edge-case handling.

---

## Chunk 1: Product IA Contract

### Top-Level Navigation Model

| Surface | IA Class | Entry Point | Expected Scale | Notes |
| --- | --- | --- | --- | --- |
| `Office` | Primary workspace | Top primary nav | Full product surface | Default product world |
| `SOPs` | Primary workspace | Top primary nav | Full product surface | Definition and execution workspace |
| `Market` | Utility workspace | Header right utility | Full product surface | Ecosystem and package management workspace |
| `Activity Log` | Secondary page | Bell CTA / activity affordance | Full product surface | Full history and review page |
| `Studio` | Office mode | Header utility while in Office | Mode switch inside Office context | Not a peer workspace |
| `Settings` | Short-flow dialog | Header utility | Dialog | Transactional/settings only |

### Persistent Layout Model

| Region | Meaning | Ownership |
| --- | --- | --- |
| Header left | Identity and project context | `Company`, `Project`, current mode context |
| Header middle | Primary navigation | `Office`, `SOPs` |
| Header right | Utilities and meta systems | `Market`, `Studio`, `Notifications`, `Settings` |
| Left rail | People layer | `Personnel` |
| Center surface | Current page/workspace | `Office`, `SOPs`, `Market`, `Activity Log` |
| Right rail | Collaboration layer | `Chat`, workflow/task context, contextual collaboration |

### Page / Panel / Dialog Classification Rules

1. If a user can spend meaningful time there, it is a page/workspace, not a dialog.
2. If a user drills into domain details from that workspace, the drill-in happens inside the workspace shell unless the action is truly short and transactional.
3. Overlays are allowed only for short tasks such as import, confirm, publish, settings, or small creation flows.
4. The center surface must feel like a real page transition when switching `Office`, `SOPs`, `Market`, or `Activity Log`.
5. The right rail may show page-aware collaboration context, but it must never become the primary detail surface for `SOPs`, `Market`, or `Activity Log`.

### Non-Negotiable Must-Not-Do Rules

1. Do not render `SOPs` as a card-like center overlay on top of the `Office` scene.
2. Do not render `Market` as a utility popover, large dialog, or pseudo-page card.
3. Do not render `Activity Log` as a bigger version of the bell panel.
4. Do not keep `SopDrawer` as the primary SOP detail model.
5. Do not keep `MarketplaceDetailOverlay` as the primary market listing model.
6. Do not keep `Outputs` as a top-level destination anywhere.
7. Do not let `Studio` read as a peer workspace beside `Office` and `SOPs`.
8. Do not put `Library` or `Server` back into fixed top-level tabs while this IA rewrite is in progress.

### Design Quality Contract

1. Workspace pages must feel intentionally designed, not just “content mounted inside a generic shell”.
2. Each page must have its own internal structure, visual rhythm, and hierarchy.
3. The shell should be consistent across workspaces, but the body layout should be specialized to the job.
4. No page should require opening another primary-sized dialog just to inspect its core domain object.
5. The first screenful of each workspace must explain itself without relying on onboarding copy.

---

## Chunk 2: Current Codebase Reality

### Current Ownership That Will Change

| Current file | Current role | Why it is not enough |
| --- | --- | --- |
| `apps/web/src/App.tsx` | Orchestrates all page state and overlays | Already too large; still mixes workspace state with overlay state |
| `apps/web/src/lib/app-view-layout.ts` | View semantics and scene mounting rules | Current rules still keep `Office` mounted behind non-office workspaces |
| `packages/ui-office/src/components/layout/Header.tsx` | Header shell | Needs explicit workspace-navigation and surface-aware behavior |
| `packages/ui-office/src/components/layout/AppLayout.tsx` | Left/center/right shell | Needs true workspace surface support and per-workspace responsive rules |
| `packages/ui-office/src/components/layout/RightSidebar.tsx` | Right rail | Must stay collaboration-only |
| `packages/ui-office/src/components/sop/SopPanel.tsx` | Compact SOP list + `SopDrawer` launcher | Useful data/actions base, wrong IA |
| `packages/ui-office/src/components/sop/SopDrawer.tsx` | SOP detail overlay | Must become in-page detail/canvas content |
| `packages/ui-office/src/components/sop/SopEditorDialog.tsx` | SOP creation modal | Can remain short-flow dialog initially |
| `packages/ui-office/src/components/marketplace/MarketplacePanel.tsx` | Compact marketplace panel | Good browse base, wrong surface scale |
| `packages/ui-office/src/components/marketplace/MarketplaceDetailOverlay.tsx` | Listing detail overlay | Must become in-page detail content |
| `packages/ui-office/src/components/marketplace/PublishDialog.tsx` | Publish modal | Can remain modal initially |
| `packages/ui-office/src/components/events/EventLog.tsx` | Filterable activity timeline | Good content source, needs page shell and layout specialization |
| `packages/ui-office/src/components/notifications/NotificationCenter.tsx` | Bell popover | Should remain lightweight only |

### Existing Reusable Building Blocks Worth Keeping

1. `useSops` provides the core SOP list data source.
2. `useSopRuntimeState` already knows how to expose SOP execution state.
3. `useMarketplace` provides search/filter/feed behavior for market data.
4. `MarketplaceDetailOverlay` already contains most of the listing detail data requirements.
5. `EventLog` already has filter logic and shared event-history store logic.
6. `ChatPanel`, `TaskDashboard`, and `PitchHall` already provide the collaboration content to keep in the right rail.

### Existing Things To Decompose, Demote, Or Delete

1. `SopDrawer` should be broken apart into workspace components and then deleted or reduced to legacy wrapper status during migration.
2. `MarketplaceDetailOverlay` should be broken apart into workspace components and then deleted or reduced to legacy wrapper status during migration.
3. The temporary `WorkspaceSurface` helper introduced in `apps/web/src/App.tsx` should be removed.
4. `App.tsx` should stop assembling workspace page bodies inline.
5. `shouldKeepOfficeMounted` in `apps/web/src/lib/app-view-layout.ts` must stop preserving `Office` behind non-office workspaces unless explicitly required for animation.

---

## Chunk 3: Surface Architecture and State Model

## Phase 0: Workspace Surface Architecture

### Objective

Create a real page/workspace architecture before designing individual pages.

### Deliverables

1. A workspace registry or page-state model that treats `office`, `sops`, `market`, and `activity-log` as first-class surfaces.
2. A dedicated center-surface page shell that can render page-specific layouts without feeling like a modal card.
3. Clear separation between:
   - workspace-level navigation
   - utility action triggers
   - modal/dialog flows
4. Explicit scene freeze/unmount rules for `Office` when the user is not in `Office`.

### Required Code Shape

1. `apps/web/src/App.tsx` should only route between workspace surfaces and own global dialogs.
2. Introduce a workspace-focused composition layer under `apps/web/src/components/workspaces/` or `packages/ui-office/src/components/workspaces/`.
3. `AppLayout` should become a true shell with:
   - persistent left rail
   - persistent right rail
   - center page slot
   - optional `Office` scene behavior only when the current surface is `office`
4. `WorkspacePageShell` should own shared page concerns:
   - page title row
   - secondary actions row
   - desktop/tablet/narrow layout contracts
   - loading/empty/error states

### Office Scene Mount Policy

1. `Office` view:
   - `SceneCanvas` mounted
   - scene interactive
   - studio can be entered
2. `SOPs`, `Market`, `Activity Log`:
   - center surface fully replaced by workspace page
   - `Office` scene not visually active behind page content
   - no stacked-card effect
3. Allowed implementation choices:
   - `Office` scene fully unmounted, or
   - `Office` scene mounted but visually absent and non-interactive for transition continuity
4. Forbidden implementation:
   - `Office` scene clearly visible underneath page body
   - `Office` scene still receiving focus/scroll/selection while another workspace is active

### Global Surface State Contract

Create a typed state model for:

1. `activeWorkspace`
2. `activeDialog`
3. `activeUtilityMode`
4. `workspaceSessionState`

`workspaceSessionState` must preserve page-local state by workspace:

```ts
type WorkspaceSessionState = {
  office: {
    viewMode: '2D' | '3D';
    selectedEmployeeId: string | null;
    studioMode: 'create' | 'edit' | null;
  };
  sops: {
    selectedSopId: string | null;
    leftPaneMode: 'library' | 'active-runs';
    centerMode: 'empty' | 'definition' | 'run-focus';
    rightPaneTab: 'context' | 'runs' | 'history';
    search: string;
    filters: string[];
  };
  market: {
    mode: 'explore' | 'manage';
    selectedListingId: string | null;
    search: string;
    sort: string;
    filters: string[];
    manageTab: 'installed' | 'updates' | 'published';
  };
  activityLog: {
    selectedEventId: string | null;
    search: string;
    eventTypes: string[];
    actorFilters: string[];
    datePreset: 'today' | '7d' | '30d' | 'custom';
  };
};
```

### Global Navigation and Back Rules

1. Top-nav workspace switches keep page-local state for the workspace being left.
2. Re-entering a workspace restores the last in-session selection and filters.
3. Clicking the browser/system back action while inside a workspace should unwind page-internal drill-in before leaving the workspace.
4. Only after page-internal drill-in is unwound should back switch to the prior workspace.
5. Opening or closing short-flow dialogs must not reset workspace selection state.

### Likely Files

1. Modify: `apps/web/src/App.tsx`
2. Modify: `apps/web/src/lib/app-view-layout.ts`
3. Modify: `packages/ui-office/src/components/layout/AppLayout.tsx`
4. Modify: `packages/ui-office/src/components/layout/Header.tsx`
5. Create: `apps/web/src/components/workspaces/WorkspaceRouter.tsx`
6. Create: `apps/web/src/components/workspaces/WorkspacePageShell.tsx`
7. Create: `apps/web/src/components/workspaces/types.ts`
8. Create: `apps/web/src/components/workspaces/useWorkspaceSessionState.ts`

### Verification Gate

1. Switching `Office` and `SOPs` must visually read as page-level navigation.
2. Opening `Market` must visually read as entering a full workspace, not a popup.
3. Entering `Activity Log` must visually read as a page switch, not an expanded bell.
4. Leaving a workspace and coming back must restore selection state.
5. No persistent “Office behind page” visual leak remains.

### Edge Cases

1. If the selected SOP or market listing disappears while the user is in the workspace, the page must fall back to no-selection state with a non-blocking notice.
2. If a dialog opens while the right rail is collapsed, closing the dialog must not unexpectedly expand the rail.
3. If runtime config is incomplete, page switching still works and config CTAs remain short-flow dialogs.
4. If the user deep-links into a workspace before company data is ready, show a loading shell rather than a blank center surface.

---

## Chunk 4: Office Stabilization and Collaboration Boundary

## Phase 1: Office Surface Stabilization

### Objective

Lock `Office` as the default world surface and keep everything else from leaking back into it.

### Deliverables

1. `Office` keeps:
   - `Personnel` left
   - `Office` center scene/page
   - `Collaboration` right
2. `Studio` remains an Office mode and is only entered while in `Office`.
3. Notification bell remains lightweight.

### Required Changes

1. Ensure non-office workspaces do not continue rendering behind the page shell in a way that reads as stacking.
2. Keep direct employee chat, task context, and workflow progress inside the right collaboration rail.
3. Ensure `Office` mode and `Studio` mode messaging remain explicit.
4. Ensure any employee inspector or notification action that requests chat always lands in `Chat`, not in another right-rail tab.

### Collaboration Rail Contract

1. The right rail always answers one question: “Where do conversations and task context live?”
2. Allowed contents:
   - `Chat`
   - task/workflow context
   - lightweight collaboration status
3. Forbidden contents:
   - market detail
   - SOP detail
   - event history
   - generic tool dashboards

### Office and Studio State Rules

1. `Studio` can only be entered from `Office`.
2. If the user leaves `Office` while `Studio` is active, `Studio` closes and `Office` state is preserved for later return.
3. Returning to `Office` after leaving another workspace restores:
   - selected employee
   - 2D/3D mode
   - right rail state if feasible
4. Returning to `Office` does not auto-reopen `Studio` unless explicitly requested.

### Likely Files

1. Modify: `apps/web/src/App.tsx`
2. Modify: `apps/web/src/lib/app-view-layout.ts`
3. Modify: `packages/ui-office/src/components/layout/RightSidebar.tsx`
4. Modify: `packages/ui-office/src/components/chat/ChatPanel.tsx`
5. Modify: `packages/ui-office/src/components/office/OfficeEditorOverlay.tsx`
6. Modify: `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx`

### Verification Gate

1. `Office` remains spatial and alive.
2. `Studio` reads as editing the office, not navigating elsewhere.
3. Collaboration remains available and reliable while in `Office`.
4. Changing workspaces does not leave the scene visually hanging underneath page bodies.

### Edge Cases

1. If the user opens chat from a notification while on `SOPs` or `Market`, only the right rail changes; the workspace must remain stable.
2. If `Studio` is active and the user opens `Market`, the product must not show both editing and market states at once.
3. If narrow-screen mode hides both rails, entering `Office` must still expose clear affordances to reopen `Personnel` and `Collaboration`.

---

## Chunk 5: SOPs Workspace

## Phase 2: SOPs Workspace Design and Migration

### Objective

Turn `SOPs` into a true primary workspace with internal layout and in-page drill-in.

### SOPs Page Shape

The `SOPs` workspace should feel like a serious productivity workbench:

1. Left pane:
   - SOP search
   - grouping and filters
   - recent and active-run pivots
   - create/import entry points
2. Center pane:
   - selected SOP definition surface
   - steps, dependencies, annotations
   - run entry and run-relevant affordances
3. Right pane:
   - run status
   - linked tasks and deliverables
   - source thread or source URL
   - revision and sync context

### SOPs Internal State Machine

Required states:

1. `browse-empty`
   - no SOP selected
   - center pane shows onboarding/empty state
2. `browse-selected`
   - SOP selected
   - center pane shows definition surface
3. `run-focus`
   - SOP selected and runtime activity highlighted
   - right pane prioritizes runtime context
4. `editing-meta`
   - short-flow dialog for name/metadata editing
5. `creating`
   - short-flow create dialog
6. `importing`
   - short-flow import dialog

Transitions:

1. list click: `browse-empty` -> `browse-selected`
2. run click: `browse-selected` -> `run-focus`
3. close runtime focus: `run-focus` -> `browse-selected`
4. selected SOP removed: any selected state -> `browse-empty`
5. create/import success:
   - if new SOP exists, select it and land in `browse-selected`
   - if import yields multiple SOPs, return to list with success toast

### SOPs Navigation Rules

1. Clicking an SOP from the list selects it inside the page and must not open a drawer.
2. Clicking another SOP preserves filters and search but swaps selection.
3. Browser/system back inside `SOPs` behaves as:
   - `run-focus` -> `browse-selected`
   - `browse-selected` -> `browse-empty`
   - `browse-empty` -> previous workspace
4. Deep links or future route params should map to `selectedSopId`.

### SOPs Responsive Rules

1. Desktop:
   - three-pane layout
   - left list fixed
   - center definition surface primary
   - right context always visible
2. Tablet:
   - left pane persistent
   - right context collapsible or tabbed
   - center remains primary
3. Narrow:
   - step 1: library/list
   - step 2: selected SOP definition
   - step 3: context sheet or secondary tab
4. On narrow, selection should never open a modal-sized drawer; it should push into the next screen/state.

### Migration Rules

1. `SopDrawer` must be broken apart and reused inside the page.
2. `SopDrawer` may remain temporarily as a compatibility wrapper during extraction, but it cannot remain mounted in final interaction flows.
3. `SopEditorDialog` and `SopImportDialog` can stay modal at first, but they must open from the workspace shell.
4. Center pane language must use `definition surface` or `canvas`, not `detail card`.

### Component Plan

1. Extract SOP list from `SopPanel` into a left-pane component.
2. Extract SOP definition content from `SopDrawer` into reusable workspace content.
3. Add explicit page state:
   - selected SOP id
   - left pane mode
   - center mode
   - right pane tab
4. Add internal no-selection state for center pane.
5. Add loading, empty, and deleted-selection recovery states.

### Likely Files

1. Create: `packages/ui-office/src/components/sop/workspace/SopWorkspacePage.tsx`
2. Create: `packages/ui-office/src/components/sop/workspace/SopWorkspaceSidebar.tsx`
3. Create: `packages/ui-office/src/components/sop/workspace/SopWorkspaceCanvas.tsx`
4. Create: `packages/ui-office/src/components/sop/workspace/SopWorkspaceContextPane.tsx`
5. Create: `packages/ui-office/src/components/sop/workspace/SopWorkspaceEmptyState.tsx`
6. Modify: `packages/ui-office/src/components/sop/SopPanel.tsx`
7. Modify: `packages/ui-office/src/components/sop/SopDrawer.tsx`
8. Modify: `packages/ui-office/src/components/sop/SopEditorDialog.tsx`
9. Modify: `packages/ui-office/src/hooks/useSops.ts`
10. Modify: `apps/web/src/App.tsx`

### Verification Gate

1. `SOPs` no longer looks like a popup over `Office`.
2. Selecting an SOP keeps the user inside the `SOPs` workspace.
3. SOP detail is visible without opening another primary-sized dialog.
4. A user can describe the layout as `library / definition surface / context`.
5. Back behavior unwinds selection before leaving the workspace.

### Edge Cases

1. No SOPs exist:
   - left pane shows empty library state
   - center pane shows “create or import” guidance
2. Filter/search returns zero results:
   - keep controls visible
   - center pane should not claim data loss
3. Running SOP updates while another SOP is selected:
   - right pane may show background activity count
   - do not steal center focus automatically
4. Running SOP completes while user is on another workspace:
   - notification enters bell/activity log
   - returning to `SOPs` may show recent activity highlight but must not hijack selection
5. Imported SOP lands with missing fields or parse warnings:
   - keep it selectable
   - show warnings in right context, not blocking modal loop

---

## Chunk 6: Market Workspace

## Phase 3: Market Workspace Design and Migration

### Objective

Turn `Market` into a full utility workspace with page-native browse/detail/install/manage flows.

### Market Page Shape

`Market` should read as an ecosystem browser, not a store popup:

1. Left pane:
   - scope filters
   - category filters
   - `Explore` vs `Manage`
   - search and sort controls that persist
2. Center pane:
   - listing feed in explore mode, or
   - selected listing detail surface, or
   - installed/update management tables in manage mode
3. Right pane:
   - package metadata
   - version/install/update state
   - trust/risk/reviews/support context
   - compatibility and dependency signals

### Market Internal State Machine

Required states:

1. `explore-feed`
2. `explore-detail`
3. `manage-installed`
4. `manage-updates`
5. `manage-published`
6. `publishing`
7. `installing`

Transitions:

1. open market from header -> restore last market state, default to `explore-feed`
2. click listing -> `explore-detail`
3. back from `explore-detail` -> `explore-feed`
4. switch mode -> `manage-*` or `explore-*` while preserving filters/search separately by mode
5. install success:
   - stay on detail
   - update right pane state and manage counts
6. uninstall/remove failure:
   - remain on page
   - show inline error state, not generic dialog bounce

### Market Navigation Rules

1. Clicking a listing must push the workspace into detail mode inside the page.
2. Installed/update flows must remain accessible without leaving the workspace.
3. Browser/system back inside `Market` behaves as:
   - `explore-detail` -> `explore-feed`
   - `manage-*` subview with focused item -> `manage-*` overview
   - base market mode -> previous workspace
4. Market must remember:
   - selected mode
   - last listing
   - search
   - sort
   - filters

### Market Design Language Requirement

`Market` must feel like an ecosystem access surface:

1. Not a monetization shop
2. Not a tiny package manager panel
3. Not a generic dashboard tab

It needs stronger hierarchy, broader browsing posture, and clearer `explore / install / manage` zones.

### Market Responsive Rules

1. Desktop:
   - three-pane layout
   - left mode/filter rail
   - center feed/detail
   - right metadata/install context
2. Tablet:
   - left rail stays
   - right pane collapses to secondary drawer/tab
3. Narrow:
   - `Explore` feed -> listing detail push navigation
   - install/context moves into stacked sections below detail
   - `Manage` becomes segmented top control plus list/detail stack

### Migration Rules

1. `MarketplaceDetailOverlay` becomes page detail, not overlay.
2. `MarketplaceDetailOverlay` may temporarily become a shared content source while extraction is underway, but it cannot remain mounted as the user-facing primary detail surface.
3. `PublishDialog` can stay modal for now, but its launch point belongs to the workspace shell.
4. Any “install package” affordance in the header must be demoted if it conflicts with the workspace ownership model.

### Component Plan

1. Split `Market` into explicit `Explore` and `Manage` modes.
2. Extract shared detail content from `MarketplaceDetailOverlay`.
3. Create page-local empty states:
   - no results
   - no installed packages
   - no updates
4. Add compatibility and trust messaging to right context, not floating dialogs.

### Likely Files

1. Create: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspacePage.tsx`
2. Create: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceSidebar.tsx`
3. Create: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceExplore.tsx`
4. Create: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceDetail.tsx`
5. Create: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceContextPane.tsx`
6. Create: `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceManage.tsx`
7. Modify: `packages/ui-office/src/components/marketplace/MarketplacePanel.tsx`
8. Modify: `packages/ui-office/src/components/marketplace/MarketplaceDetailOverlay.tsx`
9. Modify: `packages/ui-office/src/components/marketplace/InstalledList.tsx`
10. Modify: `packages/ui-office/src/hooks/useMarketplace.ts`
11. Modify: `apps/web/src/App.tsx`

### Verification Gate

1. `Market` opens as a full workspace.
2. Listing detail no longer relies on a giant overlay.
3. Installed/manage/update flows remain available inside the workspace.
4. The page reads as an ecosystem hub, not a purchase modal.
5. `Explore` and `Manage` feel like distinct work modes, not just filter tabs.

### Edge Cases

1. Search/filter returns no results:
   - preserve filter controls
   - show clear empty state with reset affordance
2. Selected listing becomes unavailable:
   - show unavailable state inline
   - do not crash or silently bounce to feed
3. Install action requires config or auth:
   - keep user in `Market`
   - launch short-flow dialog
   - return to same listing afterward
4. Install/update is in progress and user leaves the workspace:
   - progress continues if runtime supports it
   - activity enters bell/activity log
   - re-entry restores focused listing and latest state
5. Manage mode has zero installed assets:
   - empty manage state
   - provide jump back to `Explore`

---

## Chunk 7: Activity Log and Notification Boundary

## Phase 4: Activity Log Page and Notifications Boundary

### Objective

Make `Activity Log` a proper page and keep notifications intentionally lightweight.

### Notifications vs Activity Log Contract

1. Bell panel is for:
   - recent
   - urgent
   - actionable
   - unread-biased triage
2. `Activity Log` page is for:
   - full timeline
   - historical review
   - filtering
   - denser reading
   - actor/task/event correlation

### Activity Log Internal State Machine

Required states:

1. `timeline-default`
2. `timeline-filtered`
3. `event-focused`

Transitions:

1. bell CTA -> enter `timeline-default` or last-used filtered state
2. apply filters -> `timeline-filtered`
3. click event -> `event-focused`
4. back from `event-focused` -> previous timeline state
5. clear filters -> `timeline-default`

### Bell Panel Rules

1. Bell panel should show a capped recent list.
2. Bell panel must not mount the full `EventLog` page layout.
3. Bell panel may surface:
   - unread
   - failures
   - mentions
   - task-complete events
4. Bell panel footer must link to `Activity Log`.

### Activity Log Page Shape

1. Left pane:
   - filters
   - saved or pinned filter groups if available
2. Center pane:
   - full timeline
   - event-focused reading state
3. Right pane:
   - contextual metadata only if it improves readability
   - otherwise this pane may collapse to keep the timeline dominant

### Responsive Rules

1. Desktop:
   - filters rail plus full timeline
2. Tablet:
   - filters collapsible
   - timeline dominant
3. Narrow:
   - filters become top sheet or segmented control
   - timeline single-column
   - event focus pushes to next state rather than opening a dialog

### Likely Files

1. Create: `packages/ui-office/src/components/events/workspace/ActivityLogPage.tsx`
2. Create: `packages/ui-office/src/components/events/workspace/ActivityLogFiltersPane.tsx`
3. Create: `packages/ui-office/src/components/events/workspace/ActivityLogEventFocus.tsx`
4. Modify: `packages/ui-office/src/components/events/EventLog.tsx`
5. Modify: `packages/ui-office/src/components/notifications/NotificationCenter.tsx`
6. Modify: `apps/web/src/App.tsx`

### Verification Gate

1. Bell panel stays compact.
2. `Activity Log` is clearly a page.
3. Long-history review feels intentional and comfortable.
4. Back behavior unwinds event focus before leaving the page.

### Edge Cases

1. No events exist:
   - bell panel shows all-clear state
   - activity page shows empty-history state
2. Filters return zero events:
   - retain filters
   - show zero-results message
3. Event references deleted entity:
   - render fallback entity label
   - do not break focus view
4. Notification opened from bell and then event disappears:
   - keep page stable
   - show unavailable event placeholder

---

## Chunk 8: Collaboration, Semantics, and Visual Cohesion

## Phase 5: Collaboration Rail Finalization

### Objective

Finish the right rail so it is unmistakably the collaboration layer.

### Target UX

1. `Chat` is primary.
2. `Tasks` is context, not another mini app.
3. Deliverables remain inside task context.
4. Workflow status is lightweight, text-first, and page-aware.

### Required Changes

1. Review whether `ChatPanel` still contains too much page-independent baggage.
2. Ensure direct chat and project chat both land correctly.
3. Ensure task context is readable in both `Office` and non-office workspaces.
4. Ensure no old “operations/tools warehouse” language remains.

### Likely Files

1. Modify: `packages/ui-office/src/components/layout/RightSidebar.tsx`
2. Modify: `packages/ui-office/src/components/chat/ChatPanel.tsx`
3. Modify: `packages/ui-office/src/components/chat/PipelineProgress.tsx`
4. Modify: `packages/ui-office/src/components/plan/TaskDashboard.tsx`
5. Modify: `packages/ui-office/src/components/pitch/PitchHall.tsx`

### Verification Gate

1. Right side reads as collaboration on every page.
2. Users can always answer “where do conversations happen?” with one clear answer.
3. No top-level tool tabs reappear.

### Edge Cases

1. If right rail is collapsed and a direct chat action fires, focus `Chat` and expand only if the viewport contract says it should.
2. If task context has no active tasks, the rail must still feel purposeful and not turn into an empty tool bucket.

---

## Phase 6: Employee and Office Mode Semantics Cleanup

### Objective

Finalize semantics so the product stops implying fake-complete systems.

### Required Changes

1. Employee inspector remains quick inspect, not full HR profile.
2. Workstation assignment defaults remain low-friction.
3. `Studio` wording and focus cues keep reinforcing “Office edit mode”.
4. Zone focus and decoration ownership are made explicit.

### Likely Files

1. Modify: `packages/ui-office/src/components/agents/EmployeeInspector.tsx`
2. Modify: `packages/ui-office/src/components/office/OfficeEditorOverlay.tsx`
3. Modify: `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx`

### Verification Gate

1. No fake-full-profile language remains.
2. `Studio` never reads as a top-level world.
3. Edit-mode interactions are clear and believable.

### Edge Cases

1. If an employee has sparse data, the inspector should degrade gracefully without implying missing profile tabs.
2. If the user enters studio with no selected zone, the product should clearly show “editing the office shell” rather than a broken detail panel.

---

## Phase 7: Visual Unification and Final QA

### Objective

Make the new IA feel deliberate and coherent across all workspaces.

### Required Work

1. Unify page-shell spacing, hierarchy, and motion.
2. Unify internal pane language across `SOPs`, `Market`, and `Activity Log`.
3. Ensure each workspace still has distinct job-specific structure.
4. Remove any remaining visual traces of “sidebar panel promoted into page”.

### Workspace Shell Design Rules

1. Shared shell elements:
   - title row
   - secondary action row
   - consistent top spacing
   - consistent page transition behavior
2. Distinct body structure:
   - `SOPs` reads as definition workbench
   - `Market` reads as ecosystem browser/manager
   - `Activity Log` reads as review/timeline page
3. Avoid generic repeated card grids as the default answer for all three pages.

### Verification Gate

1. Workspace switching looks intentional.
2. `SOPs`, `Market`, and `Activity Log` all feel page-native.
3. The product no longer has obvious “big popup pretending to be a page” moments.

### Edge Cases

1. Animations must remain readable when reduced motion is on.
2. When content is sparse, pages must still preserve hierarchy instead of collapsing into empty cards.

---

## Chunk 9: Responsive, Overlay Retirement, Testing, and Rollout

## Responsive IA Rules

These rules apply across all phases and must be implemented consistently.

### Viewport Tiers

1. Desktop: `> 1280px`
2. Tablet: `769px - 1280px`
3. Narrow: `<= 768px`

### Shell Rules By Tier

1. Desktop:
   - left and right rails may both remain visible
   - workspaces may use three-pane layouts
2. Tablet:
   - left rail visible by default
   - right rail collapsible by default
   - workspace context panes should collapse before primary content
3. Narrow:
   - both side rails collapse by default
   - workspace internals must use stacked navigation
   - no full-size desktop drawers pretending to be mobile pages

### Global Responsive Edge Cases

1. Resizing from desktop to narrow while a right context pane is open must not lose selected entity state.
2. Resizing from narrow back to desktop should restore pane visibility where practical.
3. Keyboard focus must move to the visible pane after responsive collapse.
4. Scroll positions should be preserved per major pane where feasible.

## Overlay Retirement Plan

### Overlay Retirement Targets

1. `packages/ui-office/src/components/sop/SopDrawer.tsx`
2. `packages/ui-office/src/components/marketplace/MarketplaceDetailOverlay.tsx`
3. Temporary `WorkspaceSurface` in `apps/web/src/App.tsx`

### Retirement Stages

1. Stage A: Extract reusable content from old overlay components.
2. Stage B: Replace user entry points so page-native workspace components become primary.
3. Stage C: Keep old overlays only as temporary compatibility wrappers if tests or hidden paths still reference them.
4. Stage D: Delete wrapper code once no runtime path depends on them.

### Retirement Success Criteria

1. No visible user path opens `SopDrawer` for primary SOP inspection.
2. No visible user path opens `MarketplaceDetailOverlay` for primary market inspection.
3. `App.tsx` no longer contains `WorkspaceSurface`.

## Testing Strategy

### Unit Coverage Targets

1. Header navigation semantics
2. App layout workspace surface behavior
3. Right collaboration rail ownership
4. Notification panel versus activity page boundary
5. SOP workspace selection and back behavior
6. Market workspace browse/detail/manage behavior
7. Activity log filters and event-focus behavior
8. Responsive collapse behavior for workspace internals

### Build / Integration Coverage

1. `pnpm --filter @offisim/ui-office build`
2. `pnpm --filter @offisim/ui-office typecheck`
3. `pnpm --filter @offisim/ui-office exec vitest run ...` for touched unit suites
4. `pnpm --filter @offisim/web build`

### Browser Verification Targets

1. `Office` -> `SOPs` reads as page navigation
2. `SOPs` list click updates center content in-page
3. `SOPs` back behavior unwinds selection
4. `Market` opens as full workspace
5. `Market` listing click stays in-page
6. `Market` `Explore` and `Manage` modes feel distinct
7. Bell panel stays compact
8. `Activity Log` opens as page
9. `Activity Log` focus and filter states unwind correctly
10. Direct employee chat still works from inspector and notification affordances
11. Responsive layouts remain comprehensible on desktop, tablet, and narrow

## Success Metrics

### Product-Level Success Checks

1. A first-time reviewer can explain:
   - `Office` is the live world
   - `SOPs` is a dedicated SOP workbench
   - `Market` is an ecosystem workspace
   - bell is triage and `Activity Log` is history
2. No primary domain object requires a large overlay for normal inspection.
3. Returning to a workspace restores enough context that users do not feel reset.

### Engineering-Level Success Checks

1. `App.tsx` becomes thinner, not thicker.
2. Workspace body composition moves out of `App.tsx`.
3. Old overlay code paths are either removed or explicitly marked legacy and unused.

## Risk Controls

1. If any workspace page is implemented as a large center card again, stop and correct before proceeding.
2. If `SopDrawer` or `MarketplaceDetailOverlay` remain the primary detail experience, stop and correct.
3. If `Activity Log` is only a resized bell panel, stop and correct.
4. If `Market` begins reading like a store popup instead of an ecosystem workspace, stop and correct.
5. If `Studio` starts drifting back toward peer-workspace semantics, stop and correct.
6. If `App.tsx` keeps accumulating page composition logic inline, stop and extract a workspace composition layer.
7. If narrow-screen behavior falls back to giant drawers rather than stacked page states, stop and correct.

## Recommended Execution Order

1. Phase 0: workspace surface architecture
2. Phase 1: office stabilization
3. Phase 2: SOPs workspace
4. Phase 3: Market workspace
5. Phase 4: Activity Log page
6. Phase 5: collaboration rail finalization
7. Phase 6: employee/office semantics cleanup
8. Phase 7: visual unification

## Why This Order

1. The shell must be correct before page design work.
2. `SOPs` and `Market` need proper page containers before detail-flow migration.
3. `Activity Log` should follow the same page architecture instead of inventing a third pattern.
4. Collaboration, semantics, and visual polish should happen after page ownership is stable.

## Completion Criteria

This plan is complete only when all of the following are true:

1. `Office`, `SOPs`, `Market`, and `Activity Log` are page-native surfaces.
2. The right rail is collaboration-only.
3. `SOPs` and `Market` detail flows happen inside their own workspaces.
4. Bell remains lightweight.
5. `Studio` reads as an `Office` mode.
6. The UI no longer feels like old sidebar modules were simply stretched into the center.
7. Desktop, tablet, and narrow layouts all preserve the IA contract.

