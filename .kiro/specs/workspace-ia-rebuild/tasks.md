# Implementation Plan: Workspace IA Rebuild

## Overview

Rebuild the Offisim product information architecture across 8 phases so that Office, SOPs, Market, and Activity Log become peer page-level workspace surfaces. Each phase builds on the previous, starting with the core surface architecture and ending with visual unification. All code is TypeScript/React. Property-based tests use fast-check.

## Tasks

- [x] 1. Phase 0 — Workspace Surface Architecture
  - [x] 1.1 Create workspace types and state models
    - Create `apps/web/src/components/workspaces/types.ts` with `WorkspaceKey`, `WorkspaceSessionState`, `OfficeSessionState`, `SopSessionState`, `MarketSessionState`, `ActivityLogSessionState` types
    - Include SOPs, Market, and Activity Log state machine union types (`SopWorkspaceState`, `MarketWorkspaceState`, `ActivityLogState`)
    - Include `WorkspaceRouterProps`, `WorkspacePageShellProps` interfaces
    - _Requirements: 1.1, 1.4, 2.3_

  - [x] 1.2 Implement `useWorkspaceSessionState` hook
    - Create `apps/web/src/components/workspaces/useWorkspaceSessionState.ts`
    - Implement `activeWorkspace`, `setActiveWorkspace`, `updateWorkspaceState`, `canGoBack`, `goBack`
    - Preserve per-workspace session state across switches (save before leaving, restore on return)
    - Maintain a workspace history stack for back navigation
    - Close Studio mode when switching away from Office
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.2_

  - [ ]* 1.3 Write property test: Session State Round-Trip (Property 2)
    - **Property 2: Session State Round-Trip**
    - For any workspace W and any valid session state, switching away and back restores W's state
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 1.4 Write property test: Dialog State Independence (Property 3)
    - **Property 3: Dialog State Independence**
    - Opening and closing any Short_Flow_Dialog produces no change to workspace selection state
    - **Validates: Requirement 2.4**

  - [x] 1.5 Implement `useWorkspaceBackNavigation` hook
    - Create `apps/web/src/components/workspaces/useWorkspaceBackNavigation.ts`
    - Integrate with browser popstate/history API
    - Call workspace-internal back first; if not consumed, switch to previous workspace
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 1.6 Write property test: Back Navigation Unwind Ordering (Property 4)
    - **Property 4: Back Navigation Unwind Ordering**
    - Pressing back D times unwinds all internal state before switching workspaces
    - **Validates: Requirements 3.1, 3.4, 3.5, 3.6**

  - [ ]* 1.7 Write property test: Back Navigation Workspace Switch (Property 5)
    - **Property 5: Back Navigation Workspace Switch**
    - At internal depth 0 with non-empty history, back switches to previous workspace
    - **Validates: Requirement 3.2**

  - [x] 1.8 Implement `WorkspaceRouter` component
    - Create `apps/web/src/components/workspaces/WorkspaceRouter.tsx`
    - Mount/unmount workspace page components based on `activeWorkspace`
    - Implement `shouldMountOfficeScene` and `isOfficeSceneInteractive` logic
    - Enforce Office scene mount/freeze policy (unmount when not active, keep during exit animation only)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 1.9 Write property test: Workspace Exclusivity (Property 1)
    - **Property 1: Workspace Exclusivity**
    - After each switch, exactly one workspace page is mounted. No two are simultaneously rendered.
    - **Validates: Requirements 1.1, 1.4**

  - [ ]* 1.10 Write property test: Office Scene Mount Policy (Property 6)
    - **Property 6: Office Scene Mount and Interactive Policy**
    - `shouldMountOfficeScene` returns true only for office or exit animation; `isOfficeSceneInteractive` only when office+idle
    - **Validates: Requirements 1.3, 4.1, 4.2, 4.3, 4.5**

  - [x] 1.11 Implement `WorkspacePageShell` component
    - Create `apps/web/src/components/workspaces/WorkspacePageShell.tsx`
    - Render consistent page header (eyebrow, title, secondary actions)
    - Handle loading skeleton, error state, and configurable empty state
    - Provide desktop/tablet/narrow layout contracts via CSS
    - Replace the current `WorkspaceSurface` card-overlay pattern
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 16.1, 16.2_

  - [x] 1.12 Implement responsive layout tier computation
    - Add `computeLayoutTier` utility to workspace types or a shared hook
    - Desktop: >1280px, Tablet: 769–1280px, Narrow: ≤768px
    - Deterministic: same width always produces same tier
    - _Requirements: 13.1, 13.2, 13.3, 13.6_

  - [ ]* 1.13 Write property test: Responsive Tier Determinism (Property 13)
    - **Property 13: Responsive Tier Determinism**
    - For any positive viewport width, `computeLayoutTier` returns exactly one deterministic tier
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.6**

  - [x] 1.14 Integrate WorkspaceRouter into App.tsx and update AppLayout
    - Modify `apps/web/src/App.tsx` to use `WorkspaceRouter` instead of inline workspace composition
    - Modify `packages/ui-office/src/components/layout/AppLayout.tsx` to become a true shell with persistent left rail, right rail, and center page slot
    - Update `apps/web/src/lib/app-view-layout.ts` to remove `shouldKeepOfficeMounted` legacy behavior
    - _Requirements: 1.1, 1.2, 1.5_

- [x] 2. Phase 0 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: switching Office ↔ SOPs reads as page navigation, no stacked-card effect, session state preserved

- [x] 3. Phase 1 — Office Surface Stabilization
  - [x] 3.1 Update Header for workspace-aware navigation
    - Modify `packages/ui-office/src/components/layout/Header.tsx`
    - Display primary nav (Office, SOPs) in header middle
    - Display utility nav (Market, Bell/Activity Log, Studio, Settings) in header right
    - Hide Studio nav item when active workspace is not Office
    - Visually indicate the currently active workspace
    - Trigger workspace switch via WorkspaceRouter on nav click
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 3.2 Write property test: Studio Containment (Property 7)
    - **Property 7: Studio Containment**
    - Switching away from Office closes Studio; Studio entry rejected on non-office workspaces; Studio nav hidden when not on Office
    - **Validates: Requirements 5.1, 5.2, 17.3**

  - [x] 3.3 Enforce collaboration-only right rail
    - Modify `packages/ui-office/src/components/layout/RightSidebar.tsx`
    - Ensure only Chat, Tasks, Deliverables content is rendered
    - Remove any SOP detail, Market detail, or Activity Log content from the rail
    - Add purposeful empty state when no active tasks exist
    - _Requirements: 11.1, 11.2, 11.5_

  - [ ]* 3.4 Write property test: Collaboration Rail Purity (Property 11)
    - **Property 11: Collaboration Rail Purity**
    - Right_Rail contains only Chat, Tasks, Deliverables at all times
    - **Validates: Requirement 11.1**

  - [x] 3.5 Ensure Office scene and Studio state rules
    - Modify `apps/web/src/App.tsx` and `packages/ui-office/src/components/office/OfficeEditorOverlay.tsx`
    - Studio can only be entered from Office
    - Leaving Office while Studio is active closes Studio
    - Returning to Office restores viewMode, selectedEmployeeId but does not auto-reopen Studio
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.6 Ensure chat actions don't disrupt workspace state
    - Modify `packages/ui-office/src/components/chat/ChatPanel.tsx`
    - Direct chat from notification or employee inspector focuses Chat panel in right rail
    - Active workspace session state (selections, filters, mode) must not change
    - Right rail expands only if responsive tier permits
    - _Requirements: 11.3, 11.4_

  - [ ]* 3.7 Write property test: Chat Action Workspace Isolation (Property 12)
    - **Property 12: Chat Action Workspace Isolation**
    - Triggering a direct chat action focuses Chat without modifying workspace session state
    - **Validates: Requirement 11.3**

- [x] 4. Phase 1 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: Office remains spatial, Studio reads as edit mode, collaboration rail is clean, workspace switching doesn't leak Office scene

- [x] 5. Phase 2 — SOPs Workspace
  - [x] 5.1 Create SOP workspace page structure
    - Create `packages/ui-office/src/components/sop/workspace/SopWorkspacePage.tsx`
    - Implement 3-pane layout: library sidebar (left), definition canvas (center), context pane (right)
    - Accept `SopSessionState` and `onSessionStateChange` props
    - Manage internal state machine: browse-empty, browse-selected, run-focus, editing-meta, creating, importing
    - _Requirements: 7.1, 7.6_

  - [x] 5.2 Create SOP workspace sidebar
    - Create `packages/ui-office/src/components/sop/workspace/SopWorkspaceSidebar.tsx`
    - Extract SOP list from `SopPanel.tsx` into left-pane component
    - Include search, grouping, filters, recent/active-run pivots, create/import entry points
    - Reuse `useSops` hook for data
    - _Requirements: 7.1, 7.7, 7.8_

  - [x] 5.3 Create SOP workspace canvas (center pane)
    - Create `packages/ui-office/src/components/sop/workspace/SopWorkspaceCanvas.tsx`
    - Extract SOP definition content from `SopDrawer.tsx` into reusable workspace content
    - Display selected SOP definition surface with steps, dependencies, annotations
    - Handle run entry and run-relevant affordances
    - _Requirements: 7.2, 7.4, 12.1_

  - [x] 5.4 Create SOP workspace context pane (right pane)
    - Create `packages/ui-office/src/components/sop/workspace/SopWorkspaceContextPane.tsx`
    - Display run status, linked tasks, deliverables, source thread/URL, revision context
    - Support tabs: context, runs, history
    - _Requirements: 7.1, 7.4_

  - [x] 5.5 Create SOP workspace empty state
    - Create `packages/ui-office/src/components/sop/workspace/SopWorkspaceEmptyState.tsx`
    - Show create/import guidance when no SOP is selected
    - Show empty library state when no SOPs exist
    - _Requirements: 7.3, 7.7_

  - [x] 5.6 Implement SOP deleted entity recovery and edge cases
    - When selected SOP is deleted, fall back to browse-empty with non-blocking toast
    - Preserve search, filters, mode on entity deletion
    - Handle zero-results from search/filter without claiming data loss
    - Handle running SOP completion notification without hijacking selection
    - _Requirements: 7.5, 7.8, 7.9, 14.1, 14.2, 14.3_

  - [ ]* 5.7 Write property test: SOP State Machine Validity (Property 8)
    - **Property 8: SOP State Machine Validity**
    - Any sequence of valid user actions produces a valid SopWorkspaceState following defined transitions
    - **Validates: Requirements 7.2, 7.4, 7.5**

  - [ ]* 5.8 Write property test: Deleted Entity Recovery (Property 15) — SOPs
    - **Property 15: Deleted Entity Recovery**
    - Deleting a selected SOP transitions to no-selection state while preserving other workspace state
    - **Validates: Requirements 14.1, 14.3**

  - [x] 5.9 Wire SopWorkspacePage into WorkspaceRouter
    - Register SOPs workspace in WorkspaceRouter
    - Implement SOPs-specific back navigation (run-focus → browse-selected → browse-empty → previous workspace)
    - Implement SOPs responsive rules (desktop 3-pane, tablet collapsible right, narrow stacked)
    - _Requirements: 3.4, 13.1, 13.2, 13.3_

  - [ ]* 5.10 Write property test: Resize Entity State Preservation (Property 14) — SOPs
    - **Property 14: Resize Entity State Preservation**
    - Resizing from desktop to narrow collapses context pane but preserves selectedSopId
    - **Validates: Requirement 13.4**

- [x] 6. Phase 2 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: SOPs is a full workspace, selecting SOP stays in-page, back unwinds selection, no SopDrawer for primary inspection

- [x] 7. Phase 3 — Market Workspace
  - [x] 7.1 Create Market workspace page structure
    - Create `packages/ui-office/src/components/marketplace/workspace/MarketWorkspacePage.tsx`
    - Implement 3-pane layout: mode/filter rail (left), content area (center), metadata/context pane (right)
    - Accept `MarketSessionState` and `onSessionStateChange` props
    - Manage internal state machine: explore-feed, explore-detail, manage-installed, manage-updates, manage-published, publishing, installing
    - _Requirements: 8.1, 8.6_

  - [x] 7.2 Create Market workspace sidebar
    - Create `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceSidebar.tsx`
    - Scope filters, category filters, Explore vs Manage mode switch
    - Search and sort controls that persist per mode
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 7.3 Create Market workspace explore view
    - Create `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceExplore.tsx`
    - Listing feed in explore mode
    - Reuse `useMarketplace` hook for data
    - _Requirements: 8.1, 8.2_

  - [x] 7.4 Create Market workspace detail view
    - Create `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceDetail.tsx`
    - Extract listing detail content from `MarketplaceDetailOverlay.tsx`
    - Display listing detail in center pane without overlay
    - _Requirements: 8.3, 12.2_

  - [x] 7.5 Create Market workspace context pane
    - Create `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceContextPane.tsx`
    - Package metadata, version/install/update state, trust/risk/reviews, compatibility signals
    - _Requirements: 8.1_

  - [x] 7.6 Create Market workspace manage view
    - Create `packages/ui-office/src/components/marketplace/workspace/MarketWorkspaceManage.tsx`
    - Installed, updates, published tabs
    - Handle zero installed packages with jump-to-Explore affordance
    - _Requirements: 8.2, 8.9_

  - [x] 7.7 Implement Market edge cases and error handling
    - Selected listing becomes unavailable: show inline unavailable state
    - Install requires config/auth: launch Short_Flow_Dialog, return to same listing
    - Install in progress on workspace leave: continue in background, reflect in bell/Activity Log
    - Return to Market restores focused listing and latest state
    - Zero search results: preserve controls, show reset affordance
    - _Requirements: 8.5, 8.7, 8.8, 8.9, 8.10, 14.1, 14.2, 14.3_

  - [ ]* 7.8 Write property test: Market State Machine Validity (Property 9)
    - **Property 9: Market State Machine Validity**
    - Any sequence of valid user actions produces a valid MarketWorkspaceState following defined transitions
    - **Validates: Requirements 8.3, 8.4, 8.5**

  - [x] 7.9 Wire MarketWorkspacePage into WorkspaceRouter
    - Register Market workspace in WorkspaceRouter
    - Implement Market-specific back navigation (explore-detail → explore-feed → previous workspace)
    - Implement Market responsive rules (desktop 3-pane, tablet collapsible right, narrow stacked)
    - _Requirements: 3.5, 13.1, 13.2, 13.3_

- [x] 8. Phase 3 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: Market is a full workspace, listing detail in-page, Explore/Manage feel distinct, no MarketplaceDetailOverlay for primary inspection

- [x] 9. Phase 4 — Activity Log Page
  - [x] 9.1 Create Activity Log page structure
    - Create `packages/ui-office/src/components/events/workspace/ActivityLogPage.tsx`
    - Render filter pane (left) and full timeline (center) with optional contextual metadata
    - Accept `ActivityLogSessionState` and `onSessionStateChange` props
    - Manage internal state machine: timeline-default, timeline-filtered, event-focused
    - _Requirements: 9.1, 9.5_

  - [x] 9.2 Create Activity Log filters pane
    - Create `packages/ui-office/src/components/events/workspace/ActivityLogFiltersPane.tsx`
    - Event type filters, actor filters, date presets, search
    - Reuse existing `EventLog` filter logic
    - _Requirements: 9.2, 9.4, 9.7_

  - [x] 9.3 Create Activity Log event focus view
    - Create `packages/ui-office/src/components/events/workspace/ActivityLogEventFocus.tsx`
    - Detailed event information display
    - Handle deleted entity references with fallback labels
    - _Requirements: 9.3, 9.8_

  - [x] 9.4 Implement Activity Log edge cases
    - No events: show empty-history state
    - Zero filter results: retain controls, show zero-results message
    - Event references deleted entity: render fallback label
    - _Requirements: 9.6, 9.7, 9.8_

  - [ ]* 9.5 Write property test: Activity Log State Machine Validity (Property 10)
    - **Property 10: Activity Log State Machine Validity**
    - Any sequence of valid user actions produces a valid ActivityLogState following defined transitions
    - **Validates: Requirements 9.2, 9.3, 9.4**

  - [x] 9.6 Enforce notification bell panel boundary
    - Modify `packages/ui-office/src/components/notifications/NotificationCenter.tsx`
    - Bell panel shows capped recent list, does not mount full ActivityLogPage
    - Bell panel footer links to ActivityLogPage as workspace page transition
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 9.7 Wire ActivityLogPage into WorkspaceRouter
    - Register Activity Log workspace in WorkspaceRouter
    - Implement Activity Log back navigation (event-focused → timeline state → previous workspace)
    - Implement responsive rules (desktop filters+timeline, tablet collapsible filters, narrow stacked)
    - _Requirements: 3.6, 13.1, 13.2, 13.3_

- [ ] 10. Phase 4 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: Activity Log is a page, bell stays compact, event focus and filter states unwind correctly

- [ ] 11. Phase 5 — Collaboration Rail Finalization
  - [ ] 11.1 Finalize right rail content and behavior
    - Review and clean `packages/ui-office/src/components/layout/RightSidebar.tsx`
    - Ensure Chat is primary, Tasks is context, Deliverables inside task context
    - Workflow status is lightweight, text-first, page-aware
    - Remove any remaining non-collaboration content
    - _Requirements: 11.1, 11.2, 11.5_

  - [ ] 11.2 Clean up ChatPanel and task context
    - Modify `packages/ui-office/src/components/chat/ChatPanel.tsx` — remove page-independent baggage
    - Modify `packages/ui-office/src/components/plan/TaskDashboard.tsx` — ensure readable in all workspaces
    - Modify `packages/ui-office/src/components/pitch/PitchHall.tsx` — ensure collaboration-only
    - Modify `packages/ui-office/src/components/chat/PipelineProgress.tsx` — lightweight workflow status
    - _Requirements: 11.1, 11.3, 11.4_

- [ ] 12. Phase 5 Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: right rail reads as collaboration on every page, no tool tabs reappear

- [ ] 13. Phase 6 — Employee and Office Semantics Cleanup
  - [ ] 13.1 Clean up employee inspector and Studio semantics
    - Modify `packages/ui-office/src/components/agents/EmployeeInspector.tsx` — keep as quick inspect, no fake HR profile language
    - Modify `packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` — reinforce "Office edit mode" wording
    - Modify `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx` — explicit zone focus and decoration ownership
    - Handle sparse employee data gracefully, no missing profile tab implications
    - Handle Studio with no selected zone: show "editing the office shell" state
    - _Requirements: 5.1, 5.3_

- [ ] 14. Phase 7 — Visual Unification and Overlay Retirement
  - [ ] 14.1 Unify workspace page shell styling
    - Unify page-shell spacing, hierarchy, and motion across SOPs, Market, Activity Log
    - Ensure each workspace has distinct job-specific structure (workbench / ecosystem browser / timeline)
    - Remove visual traces of "sidebar panel promoted into page"
    - Ensure animations respect reduced motion preferences
    - _Requirements: 6.1, 6.5_

  - [ ] 14.2 Retire overlay components
    - Remove or mark as legacy: `SopDrawer.tsx` (no visible user path opens it for primary SOP inspection)
    - Remove or mark as legacy: `MarketplaceDetailOverlay.tsx` (no visible user path opens it for primary market inspection)
    - Remove `WorkspaceSurface` temporary helper from `App.tsx`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 14.3 Implement deep link handling for missing entities
    - When deep link targets a missing entity, load workspace in default state
    - Show non-blocking notice explaining entity not found
    - Provide full workspace functionality for browsing
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ]* 14.4 Write unit tests for deep link and overlay retirement
    - Test deep link to missing SOP, market listing, activity event
    - Test that no runtime path opens retired overlays
    - _Requirements: 12.4, 12.5, 15.1, 15.2, 15.3_

- [ ] 15. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: all workspaces are page-native, right rail is collaboration-only, no overlay detail paths remain, responsive layouts work across tiers, back navigation unwinds correctly everywhere

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Property tests validate universal correctness properties from the design document using fast-check
- All code is TypeScript/React — no language selection needed
- The execution order follows the approved plan: shell first, then individual workspaces, then polish
