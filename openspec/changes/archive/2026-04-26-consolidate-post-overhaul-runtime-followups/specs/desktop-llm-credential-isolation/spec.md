## ADDED Requirements

### Requirement: Tauri release `.app` CSP SHALL allow platform endpoint origins

The Tauri release `.app` Content-Security-Policy SHALL allow the same platform endpoint origins as `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS`. Specifically the CSP `connect-src` directive SHALL include:
- `http://localhost:4100` (default platform dev API endpoint)
- `tauri://localhost` (Tauri webview self-origin)
- `https://localhost:4100` (TLS variant if enabled)

Release-mode CSP SHALL NOT be stricter than dev-mode for these specific origins. The two MUST stay in sync — adding a new platform origin to dev allowlist requires the same addition to release CSP, enforced via spec scenario or a startup smoke check.

If the user runs the desktop `.app` against a production platform endpoint (future), the CSP SHALL accept that origin via build-time env injection, not by relaxing the local-development allowlist.

#### Scenario: Release `.app` reaches platform endpoint at localhost:4100

- **WHEN** the user launches the release `.app` while `pnpm --filter @offisim/platform dev` is running on port 4100
- **THEN** Market / Settings / external-employee install paths that fetch from `http://localhost:4100` succeed without CSP violation, matching dev `pnpm --filter @offisim/desktop dev` behavior

#### Scenario: Non-allowlisted port is blocked

- **WHEN** the release `.app` attempts to fetch from a non-allowlisted local port (e.g., `127.0.0.1:43177`)
- **THEN** the request is blocked by CSP and the failure surfaces as a typed network error in the UI (not a silent stall)
