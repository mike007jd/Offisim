# Simplify To Tauri-Only Desktop Architecture

## Why

Offisim is moving to an open-source desktop-first product, and the current `apps/web` / `apps/desktop` / `apps/launcher` split makes the product boundary look broader and less intentional than the runtime we actually want to ship. Before opening the repo, the architecture should say one clear thing: Offisim is a Tauri v2 desktop app with an internal WebView renderer, not a separate web product plus a launcher.

## What Changes

- **BREAKING** Remove the standalone `apps/web` product surface, web dev/preview semantics, browser-only runtime, and browser-only persistence/provider paths.
- **BREAKING** Remove `apps/launcher` and all launcher app/build/runtime references.
- Keep Tauri v2 as the only shipped app host under `apps/desktop/src-tauri`.
- Move the desktop WebView renderer into the desktop app ownership boundary, e.g. `apps/desktop/renderer`, and make desktop build scripts consume that renderer directly.
- Preserve the existing React/Office UI where it is used by the Tauri WebView; the UI is not deleted, it is relocated and renamed as desktop renderer code.
- Collapse runtime initialization to a Tauri-only path backed by local DB, desktop permissions, desktop vault/filesystem, MCP bridge, and the default `offisim-core` harness.
- Split oversized runtime context surfaces into maintainable, capability-scoped contexts/hooks so UI consumers do not depend on one giant `OffisimRuntimeValue`.
- Replace ad hoc `@offisim/core/dist/*` runtime imports with explicit supported subpath exports for runtime, harness, LLM transport, MCP, and services.
- Update docs, specs, scripts, package graph, and verification gates so the repo no longer presents web or launcher as active product routes.

## Capabilities

### New Capabilities

- `tauri-only-desktop-architecture`: Establishes the single-product architecture, desktop renderer ownership, package graph, deletion boundary, and release verification expectations for a Tauri v2-only Offisim.

### Modified Capabilities

- `web-app-shell-boundaries`: Retire standalone web app shell semantics and migrate the shell boundary to the desktop renderer path.
- `launcher-shell-layout`: Remove launcher product requirements because launcher is no longer a supported app.
- `runtime-provider-boundaries`: Replace browser/tauri bifurcation with a Tauri-only runtime provider boundary and split runtime context into scoped contexts.
- `unified-shell-routing`: Preserve single-shell workspace routing while moving the implementation path from `apps/web` to the desktop renderer.
- `runtime-live-verification-gates`: Remove web live verification as a release gate and require release `.app` evidence for desktop-only acceptance.

## Impact

- App topology: `apps/web` and `apps/launcher` are removed; `apps/desktop` becomes the only app package. `apps/desktop/renderer` needs an explicit `pnpm-workspace.yaml` entry (the `apps/*` glob does not recurse into `apps/desktop/`).
- Dev/build form: `tauri dev` keeps a vite dev server on port 5176; only the renderer's location/ownership moves. No standalone browser-dev product entry remains.
- Build scripts: the touched surface is ~10 scripts (`dev-config`, `dev-all`, `copy-pdf-worker` [MOVE-with-renderer, not delete — PDF attachment parsing], `run-clean-release`, `harness-contract`, `harness-provider-adapter`, `emit/check-tailwind-theme`, `lint-no-raw-hex`, `build-agent-host-lib`) plus `tauri.conf.json` (`frontendDist`, `beforeDevCommand`) and `docker/` (`web.Dockerfile` deleted, `platform.Dockerfile` rm-list updated) — not just "stop building `@offisim/web`".
- Runtime: browser runtime, browser-only storage, browser-only provider config, web MCP/vault fallbacks, and web preview semantics are removed or folded into desktop-only equivalents.
- UI: `packages/ui-office` remains the product UI library, but renderer composition moves under desktop app ownership.
- Core API: `@offisim/core` gains supported subpath exports and loses consumer reliance on arbitrary `dist/*` imports.
- Documentation and OpenSpec: active docs/specs must describe Tauri v2 desktop-only truth and remove launcher/web-as-product wording. The 9 still-true shell-architecture invariants from `web-app-shell-boundaries` are re-homed as ADDED requirements under `tauri-only-desktop-architecture` (not lost as REMOVED migration prose). `web-app-shell-boundaries` and `launcher-shell-layout` are fully decommissioned at archive time via explicit spec-dir deletion (archive does not auto-delete emptied capabilities, and `validate --all --strict` fails on the empty carcasses otherwise).
- Verification: acceptance requires typecheck/build/harness gates plus release `.app` launch evidence; local web browser proof is no longer a release substitute. Release `.app` live verification is handed to the user/Codex operator — the main session does not drive Computer Use against the Tauri shell.
