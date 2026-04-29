## Why

Today the URL is decorative. `useWorkspaceBackNavigation` pushes a single
`{ workspace }` history entry on mount and re-pushes the same entry after every
internal back consumption — the address bar always stays at `/`. Workspace
switches, employee selection, SOP drill-in, market detail, settings tab,
activity-log filters, and overlay state never reach `window.location`.
Consequences observed in live runtime:

1. **Refresh always lands on Office** — switching to Personnel, drilling into
   `Maya / appearance`, then hitting browser refresh discards the entire
   navigation context and re-mounts at default Office. Power users who
   keep browser tabs open across sessions lose their place every reload.
2. **No shareable links** — there is no way for one user to send a teammate
   "open Maya's appearance tab" or "review activity event evt_123". Sharing
   any state requires verbal or screenshot directions because a URL pasted
   into a new tab opens at the default workspace.
3. **Browser back/forward is half-wired** — back works (via `goBack()`
   unwind) but forward is dead because no future-direction history entries
   are ever pushed. Users hit back once too many, lose their place, and
   cannot redo.
4. **`createRouteToPersonnel` is the documented cross-surface SSOT** for
   "edit employee" but the URL never moves, so it cannot be a deep-link
   target — every callsite has to import the helper. External integrations
   (OS-level deep links, paste-into-Slack) cannot drive it.
5. **Tauri `.app` reload is uglier** — desktop webview reloads (devtools
   reload, plugin re-init, manual `Cmd+R`) drop all session state with no
   way to restore. The desktop shell currently relies on this not happening
   often, which is fragile.

`useDeepLinkInstall` already proves the pattern works in Tauri (it consumes
`offisim://install?listing_id=...` events). The web shell has no mirror.

We're pre-launch — no back-compat shims, no incremental "URL just for office"
slice. This change introduces full URL routing for every workspace, every
documented nested state, and every overlay that has a non-modal identity.
Production grade or not at all.

## What Changes

- **Adopt URL as the single source of truth for workspace + nested state +
  non-modal overlays.** `useWorkspaceSessionState` SHALL initialize from
  `window.location` on mount, SHALL emit `history.replaceState` on every
  state change that is reachable in the URL grammar, and SHALL drive
  `popstate` through the existing `goBack` / `setActiveWorkspace` paths.
- **Define a precise URL grammar** for all six workspaces and the four
  overlays (see design `URL Grammar Table`). Pathnames carry workspace
  identity + primary entity (employee id, sop id, market detail id,
  settings section, activity event); query strings carry secondary state
  (tab, view mode, filters); overlays use a dedicated path or query token
  per overlay type.
- **Build a small in-house router** (no third-party dependency) layered over
  the native `History` API plus `useSyncExternalStore`. Decision recorded
  in design — vs. React Router 7 or TanStack Router. Rationale: bundle size
  budget (main chunk already ~1.7 MB known debt), Tauri webview compatibility
  (no `BrowserRouter` history quirks), and the workspace + overlay double
  axis maps cleanly to a `parseUrl(location)` / `serializeUrl(state)` pair.
- **Initialize from URL on first paint.** `apps/web/src/App.tsx` and the
  hosted hooks SHALL read `window.location` once before first render, hand
  the parsed `{ workspace, sessionState, overlay }` triple into
  `useWorkspaceSessionState({ initial })` and `useOverlayState({ initial })`
  so the first frame already reflects the deep link.
- **Synchronize state writes back to URL.** Every workspace mutation that
  the URL grammar covers SHALL call into a single `useUrlSync` hook that
  serializes the next state and calls `history.replaceState` (state push
  for workspace switches, replace for in-place state edits).
- **Browser back/forward parity.** `popstate` SHALL re-parse the new URL
  and hand the resulting state to the workspace + overlay setters
  (`setActiveWorkspace`, `updateWorkspaceState`, `setActiveOverlay`)
  so going back/forward jumps directly to the historical state. The
  existing `useWorkspaceBackNavigation` becomes a thin compatibility
  layer that delegates to URL-driven navigation; internal drill-in
  unwind still computes through `tryWorkspaceInternalBack` but the
  resulting state mutation goes through the same URL serializer.
- **Cross-surface helper integration.** `createRouteToPersonnel` SHALL be
  refactored to compute the target URL and call the URL setter once
  (single `history.pushState`), instead of two separate writes
  (`updateWorkspaceState` then `setActiveWorkspace`). Same pattern for
  any other cross-surface helpers (`personnel-routing.ts`).
- **404 / unknown URL fallback.** Unknown workspace keys, malformed query
  parameters, missing entity IDs (employee not in roster, sop not in
  catalog, listing not in market), and invalid overlay tokens SHALL fall
  back to a defined safe state (Office workspace, no overlay, default
  session state) AND emit a single info-level toast `Couldn't open the
  link — switched to Office.` The fallback is silent for purely cosmetic
  parameters (e.g. an unknown `?filter=...` value just gets dropped, no
  toast).
- **Tauri webview parity.** Tauri 2's webview honors the `history` API
  the same as a normal browser, so the URL approach works inside the
  desktop shell. The change SHALL verify path resolution under the
  `tauri://localhost` origin (which uses `pathname` exactly like
  `http://localhost`), SHALL handle the desktop-only deep link
  `offisim://...` registration so the shell first translates the
  deep link to an in-app URL navigation (existing `useDeepLinkInstall`
  is preserved as a parallel install-only event channel — it remains
  the route for marketplace install requests, since those are
  asynchronous-callback-driven, not navigational).
- **Shareable URL contract.** Every URL produced by the serializer SHALL
  round-trip — pasting it into a fresh window restores exactly the
  state that produced it (sub-second visual difference allowed for
  heavy lazy chunks). Round-trip is contract, not best-effort.

## Capabilities

### New Capabilities

- `url-routing-deep-links`: URL is the canonical truth for workspace +
  nested state + non-modal overlays. Owns the URL grammar (path + query),
  the parse / serialize pair, the safe-fallback rules for unknown
  workspaces / entities / overlay tokens, and the round-trip contract.
  Defines how popstate, history.pushState, and history.replaceState are
  used (push only on workspace identity changes, replace for in-place
  edits within a workspace). Defines that `createRouteToPersonnel` and
  every other cross-surface helper SHALL drive navigation through the
  URL serializer rather than directly mutating workspace + overlay state.
  Defines the Tauri webview compatibility contract.

### Modified Capabilities

- `responsive-app-shell`: App.tsx initialization SHALL read
  `window.location` once before first render and hand parsed state into
  `useWorkspaceSessionState({ initial })` / `useOverlayState({ initial })`.
  `useWorkspaceSessionState` SHALL emit history mutations on every covered
  state change. `useWorkspaceBackNavigation` SHALL become a thin
  popstate-driven URL re-application path rather than the current
  push-and-trap design. `createRouteToPersonnel` SHALL produce a single
  URL change instead of two parallel state writes. The "active workspace
  → AppLayout" rendering path stays unchanged from the consumer side
  (still reads `activeWorkspace` from the hook), only the upstream
  initialization and mutation path changes.

## Impact

- **Code (web app)**: new `apps/web/src/lib/url-routing/` (parser,
  serializer, types, fallback rules, route table for the 6 workspaces +
  4 overlays); new `apps/web/src/lib/url-routing/useUrlSync.ts` that
  hooks `popstate` and writes `history.{push,replace}State` on state
  change; modifications to `apps/web/src/App.tsx` (read URL once on
  startup, pass `initial` props to hooks), to
  `apps/web/src/components/workspaces/useWorkspaceSessionState.ts`
  (accept `initial`, emit URL writes through `useUrlSync`), to
  `apps/web/src/components/workspaces/useWorkspaceBackNavigation.ts`
  (delegate to URL-driven popstate handler, keep internal-drill-in
  semantics), to `apps/web/src/hooks/useOverlayState.ts` (accept
  `initial`, emit URL writes), and to
  `apps/web/src/lib/personnel-routing.ts` (build URL once via
  serializer, single navigation call).
- **Code (ui-office)**: no signature changes to `useDeepLinkInstall`
  (it remains the marketplace install async channel); the install
  flow may additionally produce an in-app URL navigation but that is
  internal to the install handler. No public API change.
- **Tauri runtime**: the Rust shell already passes the user's
  initial `pathname` and `search` to the webview (via the indexed
  `frontendDist` static file). The change SHALL verify that
  `tauri://localhost/personnel/abc?tab=appearance` loads the same as
  `http://localhost:5176/personnel/abc?tab=appearance` in dev. No
  Rust-side changes expected; if the production `.app` 404s on
  non-`/` paths, the change SHALL add a static-file fallback that
  rewrites unknown paths to `index.html` (single-page-app fallback)
  in the Tauri config.
- **No back-compat**: pre-launch — the change re-shapes
  `useWorkspaceSessionState` and `useWorkspaceBackNavigation` directly,
  no flag-gated rollout, no parallel router. Internal-only consumers.
- **Live verification**:
  - **Web**: dev server `apps/web` at `http://localhost:5176` —
    paste each of the 18 documented URL patterns (6 workspace
    bases + 8 nested + 4 overlays) into a fresh window, observe
    state restored. Hit Cmd+R on each, observe state preserved.
    Click browser back/forward, observe correct sequence. Open
    devtools network panel, confirm no spurious extra fetch
    storms triggered by URL re-parse.
  - **Tauri release**: build `pnpm --filter @offisim/desktop build`,
    open `.app`, devtools URL bar (Tauri 2 webview supports it
    via dev menu), navigate to `tauri://localhost/sops/sop_42?step=4`,
    observe state restored. Quit and relaunch — URL is reset to
    `/` because Tauri does not persist webview URL across launches;
    that is correct behavior, the deep-link-via-OS path goes
    through `offisim://...` deep link → install handler.
  - **Cross-window**: Cmd+drag a tab into a new window, paste the
    URL — state restored in the new window without disturbing the
    source window.
