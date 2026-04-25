## 2026-04-25 Release App Verification

Command:

- `pnpm --filter @offisim/launcher build`

Release bundle:

- `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/launcher/src-tauri/target/release/bundle/macos/Offisim Launcher.app`

Results:

- `800 x 600`: PASS. Header, control region, empty banner row, and log region are all visible. LogViewer remains the only remaining-height region.
- `640 x 600`: PASS. LaunchPanel renders Desktop and Web in the first row; Web + LAN spans both columns in the second row. StatusBar wraps independently and the log region remains visible.
- `800 x 480`: PASS. Header, LaunchPanel, and StatusBar keep intrinsic height; LogViewer takes the remaining height.
- `640 x 480`: PASS. All four semantic sections are visible. Clicking Web enters active mode, exposes Stop and Restart Platform, and Stop is clickable at minimum size.
- `640 x 480` double banner: CODE-GUARANTEE PASS by accepted downgrade. Error and database warning banners share one `auto` grid row as a vertical stack; LogViewer is the only `minmax(0,1fr)` row, so banners reduce log height without deforming header, launch, or status rows.

Validation:

- `openspec validate fix-launcher-grid-layout` passed.
