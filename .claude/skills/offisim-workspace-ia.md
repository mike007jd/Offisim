# Offisim Workspace Information Architecture

> **When to use:** Any work touching workspace navigation, workspace pages (SOPs, Market, Activity Log, Settings), the WorkspaceRouter, session state management, back navigation, responsive layout tiers, or the FullPageWorkspaceShell.

Current architecture decision: Offisim is Tauri v2 desktop-only. Renderer code belongs under desktop ownership at `apps/desktop/renderer`; standalone web package is removed.

## Architecture Overview

Offisim has 6 peer-level workspace surfaces. Office is the default; SOPs, Market, Personnel, Activity Log, and Settings are non-office workspace surfaces.

```
App.tsx
├── CompanySelectionPage (view='company-select')
├── Studio (view='studio', lazy)
├── OfficeWorkspaceShellLazy (view='office', shouldShowAppShell)
│   └── AppLayout (left rail + center scene + right rail)
└── FullPageWorkspaceShell (isFullPageWorkspaceView)
    └── WorkspaceRouter
        ├── SopWorkspacePage (workspace='sops')
        ├── MarketWorkspacePage (workspace='market')
        ├── PersonnelPage (workspace='personnel')
        ├── ActivityLogPage (workspace='activity-log')
        └── SettingsPage (workspace='settings')
```

## Key Types

- `WorkspaceKey` = `'office' | 'sops' | 'market' | 'personnel' | 'activity-log' | 'settings'`
- `AppView` = `WorkspaceKey | 'employee-creator' | 'office-editor' | 'company-select' | 'studio'`
- `FullPageWorkspaceAppView` = `'sops' | 'market' | 'personnel' | 'activity-log' | 'settings'`
- Each workspace has its own session state type (e.g. `SopSessionState`, `MarketSessionState`)

## Navigation Rules

1. Always use `handleWorkspaceSwitch(key)` — it syncs both `view` and `activeWorkspace`
2. Never call `setView()` directly for workspace navigation — session state won't be saved/restored
3. `useWorkspaceBackNavigation` handles browser back: unwinds internal state first, then switches workspace
4. Studio is NOT a workspace — it's a separate full-page view (`view='studio'`), only accessible from Office
5. `FullPageWorkspaceShell` provides the header + workspace nav for non-office workspaces

## Session State

- `useWorkspaceSessionState` manages per-workspace state
- State is preserved when switching away and restored when switching back
- Each workspace defines its own default state factory (e.g. `createDefaultSopState()`)
- State types live at `apps/desktop/renderer/src/components/workspaces/types.ts`.

## Responsive Layout

- `computeLayoutTier(viewportWidth)` → `LayoutTierConfig`
- Desktop (>1280px): 3-pane, both rails visible
- Tablet (769-1280px): 2-pane collapsible, right rail collapsed
- Narrow (≤768px): stacked navigation, both rails collapsed

## Workspace Page Patterns

Each non-office workspace follows a 3-pane pattern:
- Left: sidebar/filters (collapsible on tablet/narrow)
- Center: main content (canvas, explore feed, timeline)
- Right: context/detail pane (collapsible)

### SOP Workspace (`sops`)
- Files: `ui-office/components/sop/workspace/`
- Sidebar: SOP library + active runs
- Canvas: SOP definition or run focus
- Context: step details, run history

### Market Workspace (`market`)
- Files: `ui-office/components/marketplace/workspace/`
- Sidebar: filters (kind, sort)
- Center: explore feed or manage (installed/updates/published)
- Context: listing metadata, install actions

### Personnel Workspace (`personnel`)
- Files: `ui-office/components/employees/`
- Center: employee list + detail surface
- Context: 6-tab inspector for Profile, Appearance, Runtime, Skills, Memory, and History
- Employee edit lives here rather than as a global overlay

### Activity Log (`activity-log`)
- Files: `ui-office/components/events/workspace/`
- Filters pane: event types, actors, date presets
- Timeline: chronological event list
- Event focus: detailed event view

### Settings (`settings`)
- Files: `ui-office/components/settings/`
- `SettingsPage.tsx` is the workspace entry point
- `SettingsWorkspaceSurface.tsx` is the shared content (also used by legacy `SettingsDialog`)
- Tabs: Provider, Runtime, MCP

## Legacy Overlays

- `SopDrawer` — legacy, replaced by `SopWorkspacePage`
- `MarketplaceDetailOverlay` — legacy, kept only for deep-link installs
- `WorkspaceSurface` card-overlay pattern — removed, replaced by `WorkspaceRouter`
