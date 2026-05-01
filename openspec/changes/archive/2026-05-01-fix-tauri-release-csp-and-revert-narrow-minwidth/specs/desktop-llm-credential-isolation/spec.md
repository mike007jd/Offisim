## MODIFIED Requirements

### Requirement: Tauri release `.app` CSP SHALL allow platform endpoint origins

The Tauri release `.app` Content-Security-Policy and the `apps/platform` CORS allowlist SHALL maintain a two-way coupling so the desktop webview can reach platform endpoints in both directions of the security policy. The coupling has two named invariants:

**Invariant A — CSP `connect-src` covers platform listen origins.** The Tauri release `.app` CSP `connect-src` directive SHALL include every origin the desktop webview is expected to call against `apps/platform`. Today this set is:
- `http://localhost:4100` (default platform dev API endpoint)
- `https://localhost:4100` (TLS variant if enabled)
- `tauri://localhost` (Tauri webview self-origin, for same-origin asset loads)

**Invariant B — Platform CORS allowlist covers the desktop webview origin.** `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` (or the equivalent production CORS allowlist) SHALL include `tauri://localhost` so the platform server's `Access-Control-Allow-Origin` accepts cross-origin requests originating from the desktop webview.

Release-mode CSP SHALL NOT be stricter than dev-mode for the Invariant A origins. Adding a new platform listen port to dev SHALL trigger a matching addition to release CSP, and adding a new client origin to platform CORS SHALL trigger a matching review of CSP `connect-src` if the desktop webview is the new client.

If the user runs the desktop `.app` against a production platform endpoint (future), the CSP SHALL accept that origin via build-time env injection, not by relaxing the local-development allowlist.

The two invariants SHALL be enforced by an automated build-time check (`scripts/check-platform-tauri-origin-sync.mjs` or equivalent), wired into `apps/desktop` and `apps/platform` build chains so a drift on either side fails the build with a clear error, rather than silently waiting for runtime CSP/CORS rejection.

#### Scenario: Release `.app` reaches platform endpoint at localhost:4100

- **WHEN** the user launches the release `.app` while `pnpm --filter @offisim/platform dev` is running on port 4100
- **THEN** Market / Settings / external-employee install paths that fetch from `http://localhost:4100` succeed without CSP violation, matching dev `pnpm --filter @offisim/desktop dev` behavior

#### Scenario: Non-allowlisted port is blocked

- **WHEN** the release `.app` attempts to fetch from a non-allowlisted local port (e.g., `127.0.0.1:43177`)
- **THEN** the request is blocked by CSP and the failure surfaces as a typed network error in the UI (not a silent stall)

#### Scenario: Platform CORS accepts the Tauri webview origin

- **WHEN** the desktop release `.app` (origin `tauri://localhost`) issues a fetch to `http://localhost:4100/...`
- **THEN** the platform server's `Access-Control-Allow-Origin` response header SHALL include `tauri://localhost`
- **AND** the browser SHALL allow the response to reach the desktop webview JS

#### Scenario: Build-time check fails when CSP omits the platform listen origin

- **WHEN** a developer removes `http://localhost:4100` from `apps/desktop/src-tauri/tauri.conf.json` CSP `connect-src` and runs `pnpm --filter @offisim/desktop build` (or `pnpm --filter @offisim/platform build`)
- **THEN** the prebuild origin-sync check SHALL fail with a non-zero exit code
- **AND** the error message SHALL identify which invariant failed (Invariant A — CSP `connect-src` is missing platform listen origin) and which file to edit

#### Scenario: Build-time check fails when platform CORS omits the Tauri origin

- **WHEN** a developer removes `tauri://localhost` from `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` and runs `pnpm --filter @offisim/platform build` (or `pnpm --filter @offisim/desktop build`)
- **THEN** the prebuild origin-sync check SHALL fail with a non-zero exit code
- **AND** the error message SHALL identify which invariant failed (Invariant B — platform CORS allowlist is missing `tauri://localhost`) and which file to edit

#### Scenario: Build-time check passes on the in-tree configuration

- **WHEN** a developer runs `pnpm --filter @offisim/desktop build` or `pnpm --filter @offisim/platform build` against the in-tree, unmodified `tauri.conf.json` and `startup.ts`
- **THEN** the prebuild origin-sync check SHALL exit 0
- **AND** SHALL print a single confirmation line listing which origins were checked under each invariant
