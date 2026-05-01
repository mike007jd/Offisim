## Why

Two adjacent shell-level defects surfaced in the cleanup-ui-shell-followups (2026-05-01) Tauri release verify pass, both rooted in the same misconception: that the desktop release `.app` should be treated as if it were a responsive web viewport.

1. **`minWidth: 1024 → 360` was the wrong fix.** During release-shell verification of the new tier-driven Header, the `.app` window could not be resized to `390x844`, so the narrow drawer never rendered in release. The window minimum was lowered to `360` to enable the verification. This was a verification-pipeline accommodation masquerading as a product fix. Offisim's desktop product floor is desktop — users don't shrink the desktop window to phone-portrait width, and the narrow tier (≤768) is only meaningful for the web SPA opened in a browser. Lowering the floor permanently degrades the desktop product surface so verification can run inside the same shell.
2. **Platform endpoint ↔ Tauri CSP coupling is asymmetric, weakly worded, and not enforced.** The existing `desktop-llm-credential-isolation` spec already states "Release `.app` CSP SHALL allow the same platform endpoint origins as `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS`," but that wording conflates two different sets — `DEV_DEFAULT_ORIGINS` enumerates *clients allowed to call platform* (CORS), while CSP `connect-src` enumerates *server origins the webview is allowed to call*. The shared concern is `tauri://localhost` (which must be in CORS) and `localhost:4100` (which must be in CSP). The spec also says drift "MUST stay in sync … enforced via spec scenario or a startup smoke check," but no smoke check exists. The Market 503 / `127.0.0.1:43177 Load failed` finding from the C0 verify left this as a known gap on the active backlog, never closed.

These two fixes belong in one change because they share the same root cause (treating release `.app` as a generic web viewport) and the same verification matrix (release `.app` rebuilt + Tauri 2 dialog/opener/sql + platform dev cross-origin reach + desktop window drag floor).

## What Changes

- **Revert** `apps/desktop/src-tauri/tauri.conf.json` `minWidth: 360 → 1024` (desktop product floor).
- **Clarify** `responsive-app-shell`: narrow tier (`390x844`) applies to the web SPA opened in a browser viewport; the Tauri release `.app` window SHALL enforce a desktop product floor (≥ 1024) and is exempt from the narrow scenarios. Add scenario for the floor + scenario clarifying narrow-tier verification scope = web only.
- **Tighten** `desktop-llm-credential-isolation` "Tauri release `.app` CSP SHALL allow platform endpoint origins" requirement: replace the asymmetric "same as `DEV_DEFAULT_ORIGINS`" wording with explicit two-way coupling (tauri CSP `connect-src` ⊇ platform listen origins; platform CORS allowlist ⊇ `tauri://localhost`). Add a SHALL for an automated invariant check rather than the current "scenario or startup smoke" hedge.
- **Add** `scripts/check-platform-tauri-origin-sync.mjs` — parses `tauri.conf.json` CSP `connect-src` + `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` + the platform default port; fails build if either side of the contract drifts. Hook into `apps/desktop/package.json` prebuild AND `apps/platform/package.json` prebuild so changing either surface triggers the check.
- **Document** the two-way contract in `apps/desktop/CLAUDE.md` and `apps/platform/CLAUDE.md` with a pointer to the spec scenarios; remove the older ad-hoc gotcha lines that get out of date.
- **Update** root `CLAUDE.md` to make explicit that narrow tier (`390x844`) verification target is the web SPA in browser, not the desktop release `.app`.

No runtime behavior change for end users beyond the desktop window floor (1024 enforced rather than draggable to 360). No CSP allowlist widening.

## Capabilities

### New Capabilities
<!-- None — both fixes refine existing capabilities. -->

### Modified Capabilities
- `responsive-app-shell`: add a Requirement clarifying that narrow tier (`390x844`) is the web SPA verification scope, and the Tauri release `.app` window SHALL enforce a desktop product floor (≥ 1024). Existing narrow-tier scenarios continue to apply to the web SPA only.
- `desktop-llm-credential-isolation`: replace the asymmetric "same platform endpoint origins" wording with an explicit two-way coupling between tauri release CSP `connect-src` and platform CORS allowlist. Promote the "or startup smoke check" hedge to a SHALL on an automated invariant check that runs in build chain.

## Impact

- **Code touched**:
  - `apps/desktop/src-tauri/tauri.conf.json` (revert minWidth)
  - `scripts/check-platform-tauri-origin-sync.mjs` (new)
  - `apps/desktop/package.json` (wire prebuild hook)
  - `apps/platform/package.json` (wire prebuild hook)
  - `apps/desktop/CLAUDE.md` (contract pointer)
  - `apps/platform/CLAUDE.md` (contract pointer)
  - `CLAUDE.md` (root — narrow-tier-is-web-only clarification)
  - Possibly minor wording updates in `apps/platform/src/startup.ts` comment block.
- **APIs / data / runtime**: no API change, no data change, no runtime behavior change for end users beyond enforcing the desktop window product floor.
- **Risk surface**: the prebuild hook adds a build-time dependency. If the script is wrong it can wedge desktop or platform build — the script must be defensive (parse-with-fallback, surface clear error, fail loud rather than silently pass). Reverting minWidth removes the "verify narrow in release" path; this is intentional — narrow tier verification belongs to the web dev server. Live agent verification at desktop release shell + platform dev cross-origin reach is the gate.
- **Spec gate**: `responsive-app-shell` and `desktop-llm-credential-isolation` deltas must be applied. No other spec is modified.
