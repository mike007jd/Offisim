# launcher-shell-layout

## REMOVED Requirements

### Requirement: Launcher main window uses a fixed-track grid layout

**Reason**: The launcher app is removed from the active product architecture.

**Migration**: No replacement. Users launch the Tauri v2 desktop app directly.

### Requirement: Launch buttons remain reachable on narrow widths

**Reason**: The launcher app is removed from the active product architecture.

**Migration**: No replacement. There are no launcher launch buttons.

### Requirement: StatusBar action buttons remain reachable on narrow widths

**Reason**: The launcher app is removed from the active product architecture.

**Migration**: Runtime status and desktop actions belong inside the desktop app surfaces.

### Requirement: Banner stack does not steal log viewer height

**Reason**: The launcher app is removed from the active product architecture.

**Migration**: No replacement. Desktop runtime status/errors are handled by the desktop app.

### Requirement: Layout uses pure CSS without JS viewport measurement

**Reason**: The launcher app is removed from the active product architecture.

**Migration**: No replacement for launcher layout. General UI layout rules continue under active desktop/UI specs.

