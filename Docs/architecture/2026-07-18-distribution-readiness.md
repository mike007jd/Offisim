# Offisim R2 distribution readiness (2026-07-18)

Status: accepted implementation direction for the public prelaunch repository.

## Current-source check

Checked on 2026-07-18 against current official material:

- Tauri v2 macOS signing requires a Developer ID Application identity for direct distribution and notarization for that identity: <https://v2.tauri.app/distribute/sign/macos/>
- Tauri v2 supports signed macOS app bundles and DMG distribution: <https://v2.tauri.app/distribute/macos-application-bundle/> and <https://v2.tauri.app/distribute/dmg/>
- Tauri updater artifacts require an updater signing key and fetch release metadata/artifacts over configured HTTPS endpoints; request headers are the authentication extension point: <https://v2.tauri.app/plugin/updater/>
- Private GitHub release assets require authenticated access, while public assets can be fetched unauthenticated: <https://docs.github.com/en/rest/releases/assets>
- GitHub CLI owns authenticated release lookup/download through `gh release view` and `gh release download`: <https://cli.github.com/manual/gh_release_view> and <https://cli.github.com/manual/gh_release_download>

## Decisions

### Release publishing

`scripts/release-publish.mjs` is the single distribution entrypoint. It runs the
required gates, builds the arm64 release app, applies the fixed Developer ID
identity already present in the keychain, submits app and DMG through the fixed
`offisim-notary` keychain profile, staples and validates both, verifies them with
Gatekeeper, writes SHA-256 sidecars/evidence, and creates the GitHub release.

Credential boundary: the identity and keychain profile names are non-secret
references. Apple passwords, App Store keys, GitHub tokens, and updater private
keys are neither accepted by the script nor stored in repo files. GitHub CLI and
`notarytool` read their own keychain entries.

### GitHub CLI update boundary

Do not move update authentication or release access into the renderer or a
reusable HTTP credential. The repository is public, but the narrow GitHub CLI
path remains the approved boundary because it keeps account state in the user's
existing CLI, fixes the repository and command surface, and avoids adding a
second updater credential or trust path.

Use the narrow native `app_update_check` / `app_update_install` commands instead:

1. Locate an already installed GitHub CLI and verify its own active login.
2. Read only `mike007jd/Offisim` release metadata and fixed arm64 asset names.
3. Download through `gh release download` without inspecting its credential.
4. Verify SHA-256, exact version, Developer ID authority/team, code signature,
   and Gatekeeper notarization.
5. Replace only `/Applications/Offisim.app` and restart.

Stable automatic checks ignore draft/prerelease releases. The
`OFFISIM_UPDATE_TEST_TAG` process variable exists only for release QA against an
explicit draft tag; it contains no credential and is not persisted.

### Startup recovery

The renderer waits for `startup_status` before mounting database-backed app
providers. Rust setup runs behind a panic/error boundary. Database initialization,
cleanup, permission, resource, or setup panic failures record a sanitized
incident and keep the main window alive in safe mode.

Safe mode can export a zip to `~/Downloads/Offisim Diagnostics` containing only
the sanitized startup-log tail, app/OS environment summary, and SQLite header/file
metadata. It excludes environment variables, database rows, conversations,
projects, files, credentials, and native agent homes. Reset is explicitly
confirmed, deletes only the exact real `~/.offisim` directory, and restarts.
