# Offisim UI/UX Audit - 2026-06-07

Checked at: 2026-06-07 22:37 NZST.

Target: current worktree release app at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.

Build gate: `pnpm --filter @offisim/desktop build` passed. The frontend build emitted existing chunk-size warnings only.

## Evidence

1. `01-office-main.png` - Office main workbench.
2. `02-apps-chat.png` - Apps / chat workspace.
3. `03-market-installed.png` - Market installed view.
4. `04-personnel-profile-top.png` - Personnel profile, top of form.
5. `05-personnel-profile-scrolled.png` - Personnel profile, scrolled form.
6. `06-settings-provider.png` - Settings / Provider.
7. `07-settings-runtime.png` - Settings / Runtime.
8. `08-activity-list.png` - Activity list.
9. `09-company-selection.png` - Company selection entry.

## Step Health

1. Company selection - weak. The first screen reads as a generic SaaS dashboard: oversized CTA, large preview card, oversized stats, and a floating edit icon inside the company card.
2. Office main - weak. The attention strip creates a second topbar, the Office right rail is a search/list rail instead of one conversation axis, and the 3D/2D controls sit as a floating button island on the stage.
3. Apps / chat workspace - weak. Left navigation is duplicated as a vertical app rail plus the global Apps topbar, while the main pane is mostly blank with a composer pinned to the bottom.
4. Market installed - weak. A single installed item spans the full width, the status badge is pushed to the far right, and the empty remaining canvas is not doing useful inventory work.
5. Personnel profile - weak. The tab strip is a wide container containing small tab buttons, the enabled badge floats far from the employee identity, and the sticky action bar competes with the long form.
6. Settings Provider - mixed but noisy. The page is usable, but route/status/model metadata appears as many small badges/chips/cards at once.
7. Settings Runtime - weak. The surface stacks a main card, nested segmented control, accordion cards, and a right summary card; this is the clearest double-container issue.
8. Activity list - weak. The page is a long full-width list with sparse rows; it should be a dense, virtualized activity pane with stronger scanning affordances.

## Findings

1. Shell/frame does not match V3 DNA.
   Evidence: all screenshots. The current window is a flat light app that fills the native window; V3 calls for a bordered rounded workbench surface inside a dark outside frame. This makes every surface feel more like a web admin page than a desktop HUD.
   Likely entry: `apps/desktop/renderer/src/design-system/shell/AppFrame.tsx`, `apps/desktop/renderer/src/design-system/shell/shell.css`.

2. Office has two competing top axes.
   Evidence: `01-office-main.png`. The global topbar is followed by a full-width "2 conversations need attention" resume strip with chips and a close button. This reads as another navigation/status bar and conflicts with the V3 "no chrome status strip" direction.
   Likely entry: `apps/desktop/renderer/src/assistant/parts/ResumeBar.tsx`, `apps/desktop/renderer/src/surfaces/office/office.css`.

3. Office right rail is not a single-axis conversation rail.
   Evidence: `01-office-main.png`. The rail shows search, new thread, and thread list. V3 says Office right rail should be list <-> selected conversation with no extra tab/axis chrome. Current state also leaves the actual conversation/composer absent from the visible rail.
   Likely entry: `apps/desktop/renderer/src/surfaces/office/OfficeSurface.tsx`, `apps/desktop/renderer/src/surfaces/office/ChatRail.tsx`.

4. Buttons/controls are repeatedly wrapped in visible outer containers.
   Evidence: `04-personnel-profile-top.png`, `07-settings-runtime.png`, `03-market-installed.png`. Personnel tabs sit inside a full-width bordered rail; Runtime puts a segmented control inside a card, then accordion cards below, then a summary card beside it; Market has Browse/Installed plus Installed/Updates/Published as two adjacent control rows. This is the "button in double container" issue.
   Likely entry: `apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx`, `apps/desktop/renderer/src/surfaces/settings/RuntimePane.tsx`, `apps/desktop/renderer/src/surfaces/market/MarketSurface.tsx`.

5. Badge/chip noise is overused.
   Evidence: `06-settings-provider.png`, `07-settings-runtime.png`, `09-company-selection.png`, `03-market-installed.png`, `08-activity-list.png`. Examples: Connected, GLOBAL API KEY, model suggestion chips, ACTIVE, SIDELOADED, group count pills. Some statuses are useful, but too many are styled as pills, so important state no longer stands out.
   Likely entry: `apps/desktop/renderer/src/surfaces/settings/ProviderPane.tsx`, `apps/desktop/renderer/src/surfaces/market/MarketManage.tsx`, `apps/desktop/renderer/src/surfaces/lifecycle/CompanySelectionPage.tsx`.

6. Several pages use full-page sprawl where a contained scroll/list pane would work better.
   Evidence: `03-market-installed.png`, `08-activity-list.png`, `09-company-selection.png`. Market and Activity stretch sparse rows across the entire window. Company selection uses a large vertical dashboard before the user can enter the actual workbench. This is the "long page instead of proper scrollable work surface" class of problem.
   Likely entry: `apps/desktop/renderer/src/surfaces/activity/ActivitySurface.tsx`, `apps/desktop/renderer/src/surfaces/market/MarketManage.tsx`, `apps/desktop/renderer/src/surfaces/lifecycle/CompanySelectionPage.tsx`.

7. Personnel form has sticky footer/content tension.
   Evidence: `04-personnel-profile-top.png`, `05-personnel-profile-scrolled.png`. At the top position, the sticky Delete/Reset/Save bar visually cuts into the next field area; after scroll it remains workable but still feels like a browser form footer rather than a desktop inspector action area.
   Likely entry: `apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx`, `apps/desktop/renderer/src/surfaces/personnel/personnel.css`.

8. Stable icon/text hard overlay was not confirmed.
   Evidence limit: screenshots did not show a persistent icon label overlapping text. There are hover/focus glows during clicks and a floating edit icon inside the company card, but those are not enough to call a stable overlay bug.

## Recommended Repair Order

1. Fix shell/frame and topbar grammar first. This will improve every surface at once.
2. Remove or relocate `ResumeBar` so it does not become a second topbar.
3. Normalize all segmented controls/tabs to the V3 chip grammar and remove full-width outer wrappers.
4. Convert Activity and Market installed into dense scrollable/virtualized panes instead of full-width sparse rows.
5. Rework Personnel as a true inspector: fixed identity header, contained scroll body, action row inside the inspector region.
6. Reduce badges to one status layer per row/card; convert secondary metadata to plain inline text.

## Accessibility Limits

This audit used release-app screenshots plus Computer Use accessibility snapshots. It can flag visible layout, hierarchy, target clarity, and likely keyboard/focus risks. It does not prove full keyboard traversal, screen reader quality, contrast ratios, zoom reflow, or reduced-motion behavior.
