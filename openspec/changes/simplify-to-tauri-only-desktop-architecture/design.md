# Simplify To Tauri-Only Desktop Architecture Design

## Context

Offisim currently has three app-level surfaces: a Tauri desktop app, a standalone web app package, and a launcher app. In practice, the product direction is now desktop-only: Tauri v2 is the trusted host, local DB and desktop commands are the real runtime authority, and release validation must exercise the release `.app`.

The important distinction is that Tauri still needs a WebView renderer. This change does not delete the React Office UI. It deletes the standalone web product boundary and moves the renderer under desktop ownership so the repository presents one product architecture.

The default runtime owner remains `offisim-core`. Model SDKs remain model transport/provider-adapter details or verified employee/runtime profiles; this change does not create or revive an ordinary SDK lane.

## Goals / Non-Goals

**Goals:**

- Make `apps/desktop` the only shipped app package and the only release target.
- Move renderer source/build ownership from `apps/web` into the desktop package.
- Remove launcher code, launcher specs, launcher scripts, and launcher docs from the active product.
- Remove browser-only runtime and web-only product semantics from the active runtime.
- Split giant runtime context/state surfaces into production-maintainable, capability-scoped contexts and hooks.
- Replace arbitrary `@offisim/core/dist/*` consumer imports with supported public subpath exports.
- Leave the repo in a state that looks intentional to outside contributors: one app, clear packages, clear verification gates.

**Non-Goals:**

- No rewrite of the Office UI visuals.
- No replacement of Tauri v2.
- No downgrade of the default `offisim-core` harness.
- No change to the model transport boundary beyond making exports and ownership cleaner.
- No release claim from dev server, local browser, or standalone web preview evidence.

## Decisions

### Decision 1: Keep one app package: `apps/desktop`

`apps/desktop` SHALL own both `src-tauri` and the renderer source. The preferred target structure is:

```text
apps/desktop/
  src-tauri/
  renderer/
```

This is cleaner than keeping `apps/web` as a pseudo-renderer because open-source contributors should not have to infer that a package named `web` is actually the desktop WebView renderer.

Alternative considered: keep `apps/web` but rename docs. Rejected because package names, scripts, and build graph still communicate the wrong product shape.

### Decision 2: Delete launcher instead of hiding it

The launcher is not part of the target product. Its code, package, scripts, docs, and OpenSpec active requirements SHALL be retired instead of kept as dead or disabled code.

Alternative considered: mark launcher unsupported but leave source. Rejected because dead app code increases maintenance load and confuses the open-source starting point.

### Decision 3: Runtime initializes through a Tauri-only path

Runtime creation SHALL no longer branch between browser and Tauri product paths. Desktop runtime initialization owns local DB repositories, MCP bridge, vault/filesystem, attachment storage, trusted provider access, release command permissions, and the default harness connection.

Browser-only runtime modules MAY temporarily exist during migration only as deleted/moved files in the implementation diff; they SHALL NOT remain active imports after completion.

### Decision 4: Split runtime context by capability

The current runtime context is too broad. It SHALL be split into scoped providers/hooks so that a page needing status does not depend on services, MCP, vault, deliverables, interaction, and attachment state.

Target context groups:

- runtime services: repos, services, event bus, skill loader, telemetry
- execution: send/retry/abort, running state, failed run state
- interaction: mode, pending interaction, response handler
- desktop host: vault, local paths, desktop-only host capability
- status: ready/running/version

This reduces blast radius for future runtime changes.

### Decision 5: Core exports become explicit contracts

Consumers SHALL stop importing arbitrary `@offisim/core/dist/*` paths. `@offisim/core` SHALL expose deliberate subpaths for runtime, harness, LLM transport, MCP, services, and browser/renderer-safe types as needed.

The goal is not to hide all internals immediately. The goal is to make the public contract explicit before open source release.

### Decision 6: `tauri dev` keeps a vite dev server on port 5176; only ownership moves

Tauri v2's `tauri dev` model requires a renderer dev-server URL for HMR. This change SHALL NOT replace it with a static-build watch loop. The vite config moves with the renderer to `apps/desktop/renderer/vite.config.ts`, keeps `server.port: 5176` + `strictPort`, and the standalone browser-dev product entry disappears (no separate `pnpm --filter @offisim/web dev`, no `dev:all` web lane, no `run-clean-release` web dev server). `devUrl`, `frontendDist` (re-pathed to `../renderer/dist`), CSP, and `DEV_DEFAULT_ORIGINS` are unchanged in shape — only renderer location/ownership changes, not the dev contract.

Two non-obvious facts the implementer MUST honor: (1) `pnpm-workspace.yaml`'s `apps/*` glob does NOT recurse into `apps/desktop/`, so `apps/desktop/renderer` needs an explicit workspace entry; (2) renderer path constants in `vite.config.ts` / `tsconfig.json` go one directory deeper (`../../packages` → `../../../packages`).

Alternative considered: drop the dev server, point Tauri at a watched static build. Rejected — it regresses DX for a pure-cleanup change and is out of scope.

## Risks / Trade-offs

- **Risk: Renderer migration breaks Tauri build paths** -> Mitigation: update desktop `beforeBuildCommand`, Vite config, Tauri `frontendDist` / dev URL, and run `pnpm --filter @offisim/desktop build`.
- **Risk: Browser-only code is still imported transitively** -> Mitigation: add grep gates for `apps/web`, `createBrowserRuntime`, browser snapshot keys, and browser-provider wording.
- **Risk: Runtime context split changes render timing** -> Mitigation: split by additive providers first, preserve existing hook names through compatibility wrappers, then narrow consumers.
- **Risk: Deleting launcher leaves stale OpenSpec/docs truth** -> Mitigation: remove or delta the launcher spec and run strict OpenSpec validation.
- **Risk: Dist subpath cleanup causes a large import diff** -> Mitigation: introduce public exports first, then migrate imports module family by module family with typecheck after each tranche.
- **Risk: Current dirty UI work is mixed into architecture cleanup** -> Mitigation: the renderer relocation rewrites the exact files that currently carry ~40 uncommitted ui-office/apps-web edits; commit or stash that unrelated work BEFORE task 2 so the move starts from a clean tree for those paths. "Snapshot + identify" is not enough.
- **Risk: CSP↔CORS sync invariant drift (the documented 翻车原点)** -> `scripts/check-platform-tauri-origin-sync.mjs` runs in both `apps/desktop` and `apps/platform` prebuild and enforces Invariant A (CSP `connect-src` ⊇ `http(s)://localhost:<platformPort>` + `tauri://localhost`) and Invariant B (`DEV_DEFAULT_ORIGINS` ⊇ `tauri://localhost`). Renderer relocation / web removal / port change can drift it. Mitigation: keep port 5176; keep `DEV_DEFAULT_ORIGINS` as a stable array literal (the regex hard-fails if it is env-ified — relabel only the comment web→renderer, keep `http://localhost:5176` + `tauri://localhost`); do not touch CSP tokens (owned by `desktop-llm-credential-isolation`, out of scope); the script's own absolute paths are NOT relocation-sensitive, but `frontendDist` is — a wrong `../../web/dist` → `../renderer/dist` edit ships a stale bundle while origin-sync / harness / typecheck all stay green, so verify it via release `.app` evidence, not gate color.
- **Risk: Deleting `browser-runtime.ts` breaks the DESKTOP type graph, not just the browser path** -> The canonical `RuntimeBundle` type lives in `browser-runtime.ts` and is `import type`-d by `tauri-runtime-lite.ts` / `tauri-runtime.ts` / `useRuntimeInit.ts`. Mitigation: relocate `RuntimeBundle` to a platform-neutral module first; only then delete the browser factories. Also: the repos-only pre-company-select stage is desktop-required (`createTauriRuntimeReposOnly` populates the company-selection screen when no provider key is set) — task 5.3 must NOT delete the repos-only concept, only the browser `createBrowserRuntime*` factories + the `isTauri()` branch.
- **Risk: vite dual-import stub system is load-bearing and partly survives** -> The 9 `apps/web/src/polyfills/tauri-*.ts` stubs + `createBrowserTauriAliases()` are deletable under Tauri-only, but `async-local-storage.ts` / `empty-module.ts` / `camelcase.ts` and `scripts/copy-pdf-worker.mjs` MUST move with the renderer (PDF attachment parsing breaks silently otherwise). Mitigation: tasks 3.3/3.4 explicitly separate MOVE-with-renderer from DELETE.
- **Risk: tasks 2, 6, 7 rewrite the same renderer files three times** -> renderer move + runtime-context-split + `@offisim/core/dist/*` import rewrite all touch the same files (~74 of the 84 dist imports are renderer-internal). Mitigation: execute one pass per file (move + re-path imports + scoped-hook swap together); the section headings are scope tracking, not three sequential tree sweeps.

## Migration Plan

1. Create the desktop renderer directory and move the current renderer composition from `apps/web/src` into `apps/desktop/renderer`.
2. Update desktop package scripts and Tauri config so desktop builds its own renderer and no longer depends on `@offisim/web`.
3. Remove `apps/web` package membership, web-only scripts, preview/dev references, and browser runtime imports.
4. Remove `apps/launcher`, launcher scripts, and launcher OpenSpec/docs references from active product truth.
5. Introduce explicit `@offisim/core` subpath exports, then replace consumer `@offisim/core/dist/*` imports.
6. Split runtime provider context into scoped providers/hooks while preserving user-visible behavior — done in the same per-file pass as steps 1 and 5, not a separate sweep.
7. Update docs, AGENTS/CLAUDE guidance, OpenSpec specs, and verification instructions.
8. Run typecheck, build, deterministic harnesses, and release `.app` live verification.
9. At archive time, decommission the fully-emptied `web-app-shell-boundaries` and `launcher-shell-layout` capabilities: `openspec archive` leaves header-only carcasses (it never auto-deletes fully-REMOVED specs), and `openspec validate --all --strict` then HARD-FAILS because `SpecSchema` requires ≥1 requirement per spec. The decommission is an explicit `git rm -r openspec/specs/<cap>` after archive sync and before strict validate; provenance survives in the archived change delta. See tasks section 10.

Rollback is a git-level rollback before archive. This is a repository topology change; there is no runtime feature flag that safely restores `apps/web` or launcher after deletion.

## Open Questions

Resolved (was previously and incorrectly marked "none blocking" while the concrete dev/build form was unspecified): the dev/build form is decided in Decision 6 — `tauri dev` keeps a vite dev server on port 5176, vite config relocates with the renderer, the standalone browser-dev entry is removed. The product decision (Tauri v2 desktop only) was already made; no remaining blockers.
