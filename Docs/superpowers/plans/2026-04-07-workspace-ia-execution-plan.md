# Offisim Workspace IA Execution Plan

> For this project, implementation follows the agreed structure baseline in conversation. This file is the single execution source of truth for the current workspace IA rewrite.

## Structure Baseline

| Area | Final Ownership |
| --- | --- |
| `Header` left | `Company`, `Project` |
| `Primary nav band` | `Office`, `SOPs` |
| `Header right utilities` | `Market`, `Studio`, `Notifications`, `Settings` |
| Left side | `Personnel` |
| Center | `Office Scene` or the current primary page |
| Right side | `Chat`, workflow status, contextual collaboration |
| Bell secondary page | `Activity Log` |

## Module Decisions

| Module | Final Position | Definition |
| --- | --- | --- |
| `Office` | `Primary nav band` | Primary workspace |
| `SOPs` | `Primary nav band` | Primary workflow workspace |
| `Market` | `Header right utilities` | High-priority meta-system card |
| `Studio` | `Header right utilities` in `Office` context | `Office` edit mode |
| `Notifications` | Header bell | Recent, important, actionable items |
| `Activity Log` | Bell secondary page | Full activity timeline |
| `Personnel` | Left panel | Team / employee layer |
| `Chat` | Right panel | Primary collaboration layer |
| `Tasks` | Right collaboration context | Task state and result context |
| `Outputs` | Inside `Tasks` | Task results, no separate tab |
| `Library / Server` | Zone / building entry | Spatial features, not fixed sidebar tabs |

## Must-Not-Do Rules

1. Do not place `Market` back into `RightSidebar`.
2. Do not elevate `Studio` into `Primary nav band`.
3. Do not keep an `Events` tab in the right sidebar.
4. Do not keep `Outputs` as a separate top-level tab.
5. Do not keep `Library / Server` as fixed global tabs.
6. Do not keep the heavy top-level pipeline bar shape.

## P0 Execution Order

### Phase 0: Freeze Structure

1. Normalize layout terminology in implementation discussion and code comments where needed.
2. Treat `Primary nav band`, `Header right utilities`, and `Right sidebar` as fixed structural terms.
3. Preserve the left `Personnel` panel as-is.

### Phase 1: Stop the Bleeding

1. Fix onboarding hint positioning so it never renders off-screen.
2. Fix chat completeness issues: truncation perception, final stream settlement, markdown rendering consistency.
3. Make employee direct chat fully reliable from inspector to response.
4. Improve 3D gizmo hit area and drag affordance.

### Phase 2: Unify Containers

1. Standardize panel/dialog/tab shells.
2. Ensure stable outer height with internal scrolling only.
3. Remove clipping issues affecting SOP and related overlays.

### Phase 3: Rebuild the Right Side into Collaboration

1. Reduce `RightSidebar` responsibilities.
2. Shift desktop chat priority from bottom drawer to the right collaboration area.
3. Replace the heavy pipeline bar with a lightweight text workflow status at the top of the chat area.

### Phase 4: Migrate Misplaced Modules

1. Move `SOPs` out of `RightSidebar` into `Primary nav band` and a full workspace page.
2. Move `Market` out of `RightSidebar` into a `Header right utilities` card entry.
3. Replace `Events` with `Notifications + Activity Log`.
4. Fold `Outputs` into `Tasks`.
5. Move `Library / Server` toward zone / building entry points.

### Phase 5: Employee System Cleanup

1. Reposition the employee inspector as quick inspect, not fake full profile.
2. Remove or downgrade fake-complete profile / appearance affordances.
3. Treat workstation assignment as automatic by default.

### Phase 6: Studio Refactor

1. Treat `Studio` as `Office` mode.
2. Split editing flow into `Zone Mode` then `Decoration Mode`.
3. Make decoration clearly belong to the selected zone.
4. Add zone focus / isolate editing cues.

### Phase 7: Visual Unification

1. Rework misleading icon mappings.
2. Unify dialog language and shell behavior.
3. Finalize workflow text-state visuals.
4. Finalize the `Market` card visual language so it reads as ecosystem access, not a monetization store.

## Core File Anchors

| File | Role |
| --- | --- |
| `apps/web/src/App.tsx` | Top-level composition |
| `packages/ui-office/src/components/layout/AppLayout.tsx` | Left / center / right layout shell |
| `packages/ui-office/src/components/layout/Header.tsx` | Header composition |
| `packages/ui-office/src/components/layout/RightSidebar.tsx` | Current overloaded right sidebar |
| `packages/ui-office/src/components/chat/ChatDrawer.tsx` | Bottom chat shell to demote on desktop |
| `packages/ui-office/src/components/chat/ChatPanel.tsx` | Core collaboration UI |
| `packages/ui-office/src/components/chat/PipelineProgress.tsx` | Workflow status UI to reshape |
| `packages/ui-office/src/components/notifications/NotificationCenter.tsx` | Recent notifications |
| `packages/ui-office/src/components/events/EventLog.tsx` | Activity log source UI |
| `packages/ui-office/src/components/sop/SopPanel.tsx` | SOP sidebar source |
| `packages/ui-office/src/components/marketplace/MarketplacePanel.tsx` | Market sidebar source |
| `packages/ui-office/src/components/agents/EmployeeInspector.tsx` | Employee quick inspect |
| `apps/web/src/components/OnboardingController.tsx` | Onboarding hint positioning |
| `packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` | Zone editing surface |
| `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx` | Decoration and gizmo behavior |

## Verification Gates

### Gate A: Core Reliability

1. Onboarding hint remains visible and dismissible across layout states.
2. Chat shows full long-form responses correctly.
3. Employee direct chat is functional end-to-end.
4. 3D gizmo is practically draggable.

### Gate B: Structural Clarity

1. The right side reads as collaboration, not a tools warehouse.
2. `SOPs` is no longer discovered through the right sidebar.
3. `Market` is no longer discovered through the right sidebar.
4. `Events` no longer exists as a right sidebar tab.
5. `Outputs` no longer exists as a separate top-level tab.

### Gate C: Product Clarity

1. Users can explain where `Office`, `SOPs`, `Market`, `Studio`, `Notifications`, and `Activity Log` live without confusion.
2. `Studio` reads as an `Office` edit mode.
3. `Market` reads as an ecosystem hub, not a payment store.

## Risk Controls

1. If `Market` drifts back into `RightSidebar`, stop and correct immediately.
2. If `Studio` starts reading like a top-level workspace, stop and correct immediately.
3. If the workflow UI is only moved rather than redesigned, do not count the task as done.
4. If `Activity Log` becomes a bell enlargement instead of a distinct page, do not count the task as done.
5. If container issues are fixed piecemeal instead of by a shell rule, do not proceed to broad module migration.

## Short Execution Summary

Left is people. Center is place. Right is collaboration. Top switches primary workspaces. Top-right hosts meta-system and utilities. Bell shows recent items. `Activity Log` shows full history. `Studio` is an `Office` mode, not a top-level world.
