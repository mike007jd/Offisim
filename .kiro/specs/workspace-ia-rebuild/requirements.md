# Requirements Document

## Introduction

This document captures the requirements for the Workspace IA Rebuild feature. The goal is to transform the Offisim product's information architecture so that Office, SOPs, Market, and Activity Log become peer page-level workspace surfaces with their own internal navigation, state machines, and responsive layouts — replacing the current overlay/panel-based approach. The right rail becomes exclusively a collaboration layer (Chat + Tasks), and all primary domain detail flows happen inside their respective workspace pages.

Requirements are derived from the approved design document and organized by execution phase.

## Glossary

- **Workspace**: A first-class page-level surface that occupies the center slot of the app shell. One of: Office, SOPs, Market, Activity Log.
- **WorkspaceKey**: A typed identifier for a workspace: `'office' | 'sops' | 'market' | 'activity-log'`.
- **WorkspaceRouter**: The component responsible for mounting/unmounting workspace pages based on the active workspace key.
- **WorkspacePageShell**: A shared page shell for non-office workspaces providing consistent title row, action row, loading/empty/error states, and responsive layout contracts.
- **WorkspaceSessionState**: A typed state model that preserves per-workspace navigation state (selections, filters, search, mode) across workspace switches.
- **Center_Surface**: The main content area of the app shell where exactly one workspace is rendered at a time.
- **Right_Rail**: The persistent right sidebar reserved exclusively for collaboration content (Chat, Tasks, Deliverables).
- **Left_Rail**: The persistent left sidebar for the Personnel layer.
- **Office_Scene**: The SceneCanvas-based 3D/2D office rendering, including Studio mode.
- **SopWorkspacePage**: The full SOPs workspace component with 3-pane layout.
- **MarketWorkspacePage**: The full Market workspace component with explore/manage modes.
- **ActivityLogPage**: The full Activity Log page component with timeline, filters, and event focus.
- **Short_Flow_Dialog**: A modal dialog for brief transactional tasks (Settings, SOP Create/Edit, SOP Import, Market Publish, Company Select).
- **Back_Navigation**: The browser/system back action that unwinds workspace-internal drill-in before switching to the previous workspace.
- **Session_State_Preservation**: The guarantee that switching away from a workspace and returning restores its navigation state.
- **Responsive_Tier**: One of three layout tiers determined by viewport width: narrow (≤768px), tablet (769–1280px), desktop (>1280px).
- **Overlay_Retirement**: The process of replacing SopDrawer, MarketplaceDetailOverlay, and WorkspaceSurface with page-native workspace components.

## Requirements

### Requirement 1: Workspace Surface Architecture

**User Story:** As a user, I want each major product area (Office, SOPs, Market, Activity Log) to be a full page-level workspace, so that I experience real page navigation instead of overlays stacked on top of the Office scene.

#### Acceptance Criteria

1. THE WorkspaceRouter SHALL render exactly one workspace in the Center_Surface at any given time
2. WHEN a user clicks a workspace navigation item in the header, THE WorkspaceRouter SHALL switch the Center_Surface to the selected workspace page
3. WHEN the active workspace is not Office, THE WorkspaceRouter SHALL either unmount the Office_Scene or mount it with `pointer-events: none` and `aria-hidden: true`
4. THE WorkspaceRouter SHALL treat Office, SOPs, Market, and Activity Log as peer page-level surfaces with mutually exclusive rendering
5. WHEN switching workspaces, THE WorkspaceRouter SHALL not produce a stacked-card or overlay visual effect where the Office_Scene is visible underneath the active workspace

### Requirement 2: Session State Preservation

**User Story:** As a user, I want my selections, filters, and navigation position preserved when I switch between workspaces, so that I don't lose my context when moving between tasks.

#### Acceptance Criteria

1. WHEN a user switches away from a workspace, THE WorkspaceRouter SHALL preserve that workspace's WorkspaceSessionState including selections, search, filters, and mode
2. WHEN a user returns to a previously visited workspace, THE WorkspaceRouter SHALL restore the preserved WorkspaceSessionState
3. THE WorkspaceSessionState SHALL store per-workspace state including: Office (viewMode, selectedEmployeeId, studioMode), SOPs (selectedSopId, leftPaneMode, centerMode, rightPaneTab, search, filters), Market (mode, selectedListingId, search, sort, filters, manageTab), Activity Log (selectedEventId, search, eventTypes, actorFilters, datePreset)
4. WHEN a Short_Flow_Dialog is opened or closed, THE WorkspaceRouter SHALL not reset the active workspace's selection state or filters

### Requirement 3: Back Navigation

**User Story:** As a user, I want the browser/system back action to unwind my drill-in within a workspace before switching to the previous workspace, so that navigation feels predictable and layered.

#### Acceptance Criteria

1. WHEN the user presses back while in a workspace with internal drill-in depth greater than zero, THE Back_Navigation SHALL unwind the workspace-internal state by one level
2. WHEN the user presses back while in a workspace with no internal drill-in, THE Back_Navigation SHALL switch to the previously active workspace
3. WHEN the back history stack is empty and the workspace has no internal drill-in, THE Back_Navigation SHALL perform no action
4. WHEN navigating back within SOPs, THE Back_Navigation SHALL follow the sequence: run-focus → browse-selected → browse-empty → previous workspace
5. WHEN navigating back within Market, THE Back_Navigation SHALL follow the sequence: explore-detail → explore-feed → previous workspace
6. WHEN navigating back within Activity Log, THE Back_Navigation SHALL follow the sequence: event-focused → timeline state (filtered or default) → previous workspace

### Requirement 4: Office Scene Mount Policy

**User Story:** As a user, I want the Office scene to be fully interactive only when I'm in the Office workspace, so that it doesn't interfere with other workspaces or consume unnecessary resources.

#### Acceptance Criteria

1. WHILE the active workspace is Office, THE Office_Scene SHALL be mounted and fully interactive with pointer events enabled
2. WHILE the active workspace is not Office and no transition animation is in progress, THE WorkspaceRouter SHALL unmount the Office_Scene from the DOM
3. WHILE a transition animation is in progress from Office to another workspace, THE WorkspaceRouter SHALL keep the Office_Scene mounted but non-interactive until the animation completes
4. WHEN the transition animation completes, THE WorkspaceRouter SHALL unmount the Office_Scene
5. WHILE the Office_Scene is mounted but not active, THE Office_Scene SHALL have `pointer-events: none` and `aria-hidden: true`

### Requirement 5: Studio Containment

**User Story:** As a user, I want Studio mode to be available only within the Office workspace, so that editing the office layout is clearly scoped to the Office context.

#### Acceptance Criteria

1. THE Office_Scene SHALL allow entering Studio mode only when the active workspace is Office
2. WHEN the user switches away from Office while Studio mode is active, THE WorkspaceRouter SHALL close Studio mode before completing the workspace switch
3. WHEN the user returns to Office after Studio was closed by a workspace switch, THE Office_Scene SHALL not auto-reopen Studio mode
4. WHILE Studio mode is active, THE Office_Scene SHALL preserve the Office session state (viewMode, selectedEmployeeId) for restoration after Studio exits

### Requirement 6: WorkspacePageShell

**User Story:** As a developer, I want a shared page shell for non-office workspaces, so that all workspace pages have consistent structure, loading states, and responsive behavior.

#### Acceptance Criteria

1. THE WorkspacePageShell SHALL render a consistent page header with eyebrow text, title, and optional secondary actions
2. WHILE data is loading, THE WorkspacePageShell SHALL display a loading skeleton with the workspace eyebrow and title visible
3. WHEN an error occurs during data loading, THE WorkspacePageShell SHALL display an error state with a descriptive message
4. WHEN no data is available, THE WorkspacePageShell SHALL display a configurable empty state
5. THE WorkspacePageShell SHALL provide desktop, tablet, and narrow layout contracts via CSS responsive rules


### Requirement 7: SOPs Workspace

**User Story:** As a user, I want SOPs to be a full workspace with a library sidebar, definition canvas, and context pane, so that I can browse, inspect, and manage SOPs without leaving the workspace or opening overlays.

#### Acceptance Criteria

1. THE SopWorkspacePage SHALL render a 3-pane layout: library sidebar (left), definition canvas (center), and context pane (right)
2. WHEN a user clicks an SOP in the library list, THE SopWorkspacePage SHALL display the SOP definition in the center pane without opening a drawer or overlay
3. WHEN no SOP is selected, THE SopWorkspacePage SHALL display an empty state with create/import guidance in the center pane
4. WHEN a user clicks a run or active run on a selected SOP, THE SopWorkspacePage SHALL transition to run-focus mode with runtime context prioritized in the right pane
5. WHEN a selected SOP is deleted while the user is viewing it, THE SopWorkspacePage SHALL fall back to the browse-empty state and display a non-blocking toast notification
6. THE SopWorkspacePage SHALL manage its internal state machine with states: browse-empty, browse-selected, run-focus, editing-meta, creating, importing
7. WHEN the SOP library has no SOPs, THE SopWorkspacePage SHALL show an empty library state in the left pane and create/import guidance in the center pane
8. WHEN a search or filter returns zero results, THE SopWorkspacePage SHALL keep filter controls visible and show a zero-results message without claiming data loss
9. WHEN a running SOP completes while the user is on another workspace, THE system SHALL deliver a notification via the bell panel and Activity Log without hijacking the SOPs workspace selection on return

### Requirement 8: Market Workspace

**User Story:** As a user, I want Market to be a full workspace with explore and manage modes, so that I can browse listings, view details, install packages, and manage installed assets all within the same page.

#### Acceptance Criteria

1. THE MarketWorkspacePage SHALL render a 3-pane layout: mode/filter rail (left), content area (center), and metadata/context pane (right)
2. THE MarketWorkspacePage SHALL support two primary modes: Explore (browse and inspect listings) and Manage (installed, updates, published)
3. WHEN a user clicks a listing in explore mode, THE MarketWorkspacePage SHALL display the listing detail in the center pane without opening an overlay
4. WHEN a user switches between Explore and Manage modes, THE MarketWorkspacePage SHALL preserve search, sort, and filter state separately per mode
5. WHEN a selected listing becomes unavailable, THE MarketWorkspacePage SHALL show an unavailable state inline without crashing or silently bouncing to the feed
6. THE MarketWorkspacePage SHALL manage its internal state machine with states: explore-feed, explore-detail, manage-installed, manage-updates, manage-published, publishing, installing
7. WHEN an install or update is in progress and the user leaves the Market workspace, THE system SHALL continue the operation in the background and reflect progress in the bell panel and Activity Log
8. WHEN the user returns to Market after leaving during an install, THE MarketWorkspacePage SHALL restore the focused listing and show the latest install/update state
9. WHEN search or filter returns no results, THE MarketWorkspacePage SHALL preserve filter controls and show a clear empty state with a reset affordance
10. WHEN an install action requires configuration or authorization, THE MarketWorkspacePage SHALL launch a Short_Flow_Dialog and return to the same listing afterward

### Requirement 9: Activity Log Page

**User Story:** As a user, I want Activity Log to be a dedicated page with full timeline, filters, and event focus, so that I can review historical events with proper filtering and reading comfort.

#### Acceptance Criteria

1. THE ActivityLogPage SHALL render a filter pane (left) and a full timeline (center) with optional contextual metadata
2. WHEN a user applies filters (event types, actors, date presets, search), THE ActivityLogPage SHALL transition to the timeline-filtered state and display matching events
3. WHEN a user clicks an event in the timeline, THE ActivityLogPage SHALL transition to event-focused mode showing detailed event information
4. WHEN the user clears all filters, THE ActivityLogPage SHALL return to the timeline-default state
5. THE ActivityLogPage SHALL manage its internal state machine with states: timeline-default, timeline-filtered, event-focused
6. WHEN no events exist, THE ActivityLogPage SHALL display an empty-history state
7. WHEN filters return zero events, THE ActivityLogPage SHALL retain filter controls and show a zero-results message
8. WHEN an event references a deleted entity, THE ActivityLogPage SHALL render a fallback entity label without breaking the focus view

### Requirement 10: Notification Bell Panel Boundary

**User Story:** As a user, I want the notification bell panel to remain a lightweight triage surface, so that it stays fast and focused while the Activity Log handles full history review.

#### Acceptance Criteria

1. THE Bell_Panel SHALL display a capped list of recent, urgent, and actionable notifications biased toward unread items
2. THE Bell_Panel SHALL not mount the full ActivityLogPage layout or EventLog page components
3. THE Bell_Panel SHALL include a footer link that navigates to the ActivityLogPage
4. WHEN a user clicks the bell CTA or activity affordance, THE system SHALL navigate to the ActivityLogPage as a workspace page transition

### Requirement 11: Collaboration Rail Purity

**User Story:** As a user, I want the right rail to contain only collaboration content (Chat, Tasks, Deliverables), so that I always know where conversations and task context live regardless of which workspace I'm in.

#### Acceptance Criteria

1. THE Right_Rail SHALL contain only Chat, Tasks, and Deliverables content at all times
2. THE Right_Rail SHALL not display SOP detail, Market detail, or Activity Log content
3. WHEN a direct chat action fires from a notification or employee inspector while on any workspace, THE Right_Rail SHALL focus the Chat panel without disrupting the active workspace
4. WHILE the Right_Rail is collapsed and a direct chat action fires, THE Right_Rail SHALL expand only if the current Responsive_Tier permits it
5. WHEN task context has no active tasks, THE Right_Rail SHALL display a purposeful empty state rather than an empty tool bucket

### Requirement 12: No Primary Overlay Detail

**User Story:** As a user, I want to inspect SOPs, market listings, and activity events inside their workspace pages, so that I never need to open a large overlay or drawer for primary domain inspection.

#### Acceptance Criteria

1. THE SopWorkspacePage SHALL display SOP definition and detail content in-page, not via SopDrawer
2. THE MarketWorkspacePage SHALL display listing detail content in-page, not via MarketplaceDetailOverlay
3. THE ActivityLogPage SHALL display event detail content in-page, not via a separate overlay
4. WHEN the Overlay_Retirement is complete, THE system SHALL have no visible user path that opens SopDrawer for primary SOP inspection
5. WHEN the Overlay_Retirement is complete, THE system SHALL have no visible user path that opens MarketplaceDetailOverlay for primary market inspection

### Requirement 13: Responsive Layout

**User Story:** As a user, I want the workspace layout to adapt to my viewport size, so that the interface remains usable on desktop, tablet, and narrow screens.

#### Acceptance Criteria

1. WHILE the viewport width is greater than 1280px (desktop), THE system SHALL display both Left_Rail and Right_Rail visible by default, and workspaces SHALL use three-pane layouts
2. WHILE the viewport width is between 769px and 1280px (tablet), THE system SHALL display the Left_Rail visible and the Right_Rail collapsed by default, and workspace context panes SHALL collapse before primary content
3. WHILE the viewport width is 768px or less (narrow), THE system SHALL collapse both side rails by default, and workspace internals SHALL use stacked navigation
4. WHEN the viewport resizes from desktop to narrow while a context pane is open, THE system SHALL collapse the context pane while preserving the selected entity state
5. WHEN the viewport resizes from narrow back to desktop, THE system SHALL restore pane visibility where practical without losing entity selection
6. THE responsive tier computation SHALL be deterministic: the same viewport width SHALL always produce the same layout tier

### Requirement 14: Deleted Entity Recovery

**User Story:** As a user, I want the workspace to gracefully handle entities that are deleted while I'm viewing them, so that I never see a crash or blank screen.

#### Acceptance Criteria

1. WHEN a selected SOP, market listing, or activity event is deleted while the user has it selected, THE workspace SHALL transition to its no-selection state
2. WHEN a selected entity is deleted, THE workspace SHALL display a non-blocking toast notification informing the user
3. WHEN a selected entity is deleted, THE workspace SHALL preserve all other workspace state (search, filters, mode)

### Requirement 15: Deep Link to Missing Entity

**User Story:** As a user, I want deep links to missing entities to land me in a usable workspace state, so that stale bookmarks or shared links don't break my experience.

#### Acceptance Criteria

1. WHEN a user navigates via deep link to a workspace with an entity ID that no longer exists, THE workspace SHALL load in its default state
2. WHEN a deep-linked entity is not found, THE workspace SHALL display a non-blocking notice explaining the entity was not found
3. WHEN a deep-linked entity is not found, THE workspace SHALL provide full workspace functionality for browsing and selecting other entities

### Requirement 16: Company Data Loading

**User Story:** As a user, I want to see a loading state when I switch to a workspace before company data is ready, so that I understand the page is loading rather than broken.

#### Acceptance Criteria

1. WHEN a user switches to a workspace before company data has finished loading, THE WorkspacePageShell SHALL render a loading skeleton with the workspace eyebrow and title visible
2. WHEN company data finishes loading, THE workspace SHALL render normally with restored session state

### Requirement 17: Header Navigation

**User Story:** As a user, I want the header to clearly communicate workspace navigation, so that I can switch between workspaces and access utilities predictably.

#### Acceptance Criteria

1. THE Header SHALL display primary workspace navigation (Office, SOPs) in the header middle section
2. THE Header SHALL display utility navigation (Market, Notifications bell, Studio, Settings) in the header right section
3. WHEN the active workspace is not Office, THE Header SHALL hide the Studio navigation item
4. WHEN the user clicks a primary or utility navigation item that maps to a workspace, THE Header SHALL trigger a workspace switch via the WorkspaceRouter
5. THE Header SHALL visually indicate the currently active workspace

