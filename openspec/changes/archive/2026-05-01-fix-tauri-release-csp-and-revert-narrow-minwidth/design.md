## Context

Two implicit assumptions about Offisim's shell surfaces have leaked into different parts of the codebase and produced silent drift defects:

1. **Treating the Tauri release `.app` as if it were a generic responsive web viewport.** The `cleanup-ui-shell-followups` Stage 1 verify pass at `390x844` worked in dev web (browser viewport) but failed in release `.app` because the OS window simply could not be dragged below `1024px`. The `tauri.conf.json` `minWidth` was lowered `1024 → 360` to enable the verify, with no reflection that desktop product floor and web responsive floor are different concerns.
2. **`apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` and `apps/desktop/src-tauri/tauri.conf.json` CSP `connect-src` listed as if they were "the same allowlist".** They are conceptually different sets:
   - `DEV_DEFAULT_ORIGINS` enumerates *clients allowed to call the platform server* (CORS `Access-Control-Allow-Origin`).
   - CSP `connect-src` enumerates *server origins the desktop webview is allowed to call* (browser fetch policy).
   The intersection is small: platform must include `tauri://localhost` (so the desktop webview can call platform from its `tauri://localhost` origin), and tauri CSP must include the platform listen origin (so the webview is allowed to fetch `http://localhost:4100/...`). The current spec wording in `desktop-llm-credential-isolation` ("SHALL allow the same platform endpoint origins as `DEV_DEFAULT_ORIGINS`") collapses these two sets into one and ends up unenforceable.

Both surfaces are owned by Offisim, both are stable in dev, and both have already burned at least one verification cycle. This change closes them with a small, production-grade fix rather than wide refactors.

Constraints:
- No automated UI tests in this repo (`Validation Policy` in root `CLAUDE.md`); verification is live agent + build-chain gates.
- Build order discipline: `shared-types → ui-core → core → ui-office → web → desktop` — adding a prebuild hook to `desktop` and `platform` cannot create a cycle, and must remain a leaf script.
- Desktop product surface is always desktop (Tauri 2). Narrow tier `390x844` exists for the web SPA opened in browser only.

## Goals / Non-Goals

**Goals:**

- Restore the desktop product floor: the desktop `.app` window cannot be resized below the desktop tier minimum.
- Disambiguate narrow tier verification: `390x844` is verified in web dev only; release `.app` is verified at desktop tier only.
- Make the platform↔tauri origin coupling explicit, symmetric, and machine-checked, not docs-prose-coupled.
- Single, small smoke check that fails the desktop or platform build if either side of the coupling drifts.
- Capture the contract in spec scenarios so future changes that touch CSP, CORS, or tauri window config are forced to read it.

**Non-Goals:**

- Not building a general "tauri release shell contract" capability or validator covering plugin-three-piece, single-instance ordering, browser stub policy, etc. Those gotchas stay in CLAUDE.md as written口诀; their failure rate is too low to justify a validator.
- Not touching the existing CSP `connect-src` `https:` / `wss:` / `data:` clauses. Those serve LLM HTTP/WSS lanes, not platform reach.
- Not introducing automated UI tests or browser-driving harnesses for window dimensions; live agent verifies.
- Not changing platform listen port, default web dev port, or Tauri webview origin scheme.

## Decisions

### Decision 1: Desktop product floor is `1024` (not `1280`)

The two reasonable values are `1024` (existing pre-revert value, generally accepted "smallest desktop") and `1280` (the Tauri default `width`, current tablet tier in `responsive-app-shell`).

Choosing **`1024`** because:
- The web SPA's tablet tier (`1280x800`) and desktop tier (`1440x900`) both target users in browser windows. The desktop release `.app` running in a 13" laptop with split-screen (each pane ≈ 720–960 wide) is realistic, but desktop ≥ `1024` is universally regarded as desktop product floor.
- `1024` is the historical value before the `cleanup-ui-shell-followups` revert; restoring it is the smallest reversible action.
- If product later wants to push to `1280` for tablet-tier-only desktop, that is an additive change.

Alternative considered: keep `360`, document narrow as supported in release. Rejected — desktop users don't shrink desktop windows to phone width; supporting it permanently degrades the product surface for an imaginary use case.

### Decision 2: Narrow tier (≤ 768) is web-SPA-only by spec

`responsive-app-shell` currently lists narrow tier scenarios under "Required viewport capture set" without naming the verification surface. We add a Requirement: "Narrow tier scope is web SPA". Tauri release window has its own scenario: "Tauri release window enforces desktop product floor" with `minWidth ≥ 1024`.

This means:
- Future narrow tier verification (browser DevTools resize, `390x844` capture) is only required against the web SPA at `pnpm --filter @offisim/web dev`.
- Future change that wants to ship a narrow `.app` mode (e.g., a planned tablet/iPad Catalyst port) would need to update this spec — explicit, not silent drift.

Alternative considered: leave narrow tier ambient (silent / dev-server-implied). Rejected — this is exactly how the current drift happened. The fact that "390x844 verify on dev server" was the prior practice does not survive contact with a single verifier who decides "the same thing should work in release shell".

### Decision 3: Two-way platform↔tauri coupling expressed as two named invariants

Replace the single fuzzy "same origins" line in `desktop-llm-credential-isolation` with:

- **Invariant A (CSP-side):** Tauri release `.app` CSP `connect-src` SHALL include every platform listen origin the desktop webview will reach. Today: `http://localhost:4100`, `https://localhost:4100` (TLS variant), and `tauri://localhost` (self-origin).
- **Invariant B (CORS-side):** `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` SHALL include `tauri://localhost`. (The desktop webview makes its fetch FROM `tauri://localhost`; platform's `Access-Control-Allow-Origin` must accept it.)

Both invariants are testable against the source files; both fail closed if the coupling drifts.

Alternative considered: one bigger "shell origin matrix" with tier × env × surface. Rejected — the actual coupling is two narrow rules; encoding tier × env × surface adds vocabulary without catching new bugs.

### Decision 4: Single Node script, hooked into both prebuilds

`scripts/check-platform-tauri-origin-sync.mjs` is a Node ESM script (no bundler dep, runs in `pnpm` exec). Reads:
- `apps/desktop/src-tauri/tauri.conf.json` → `app.security.csp` → tokenize the `connect-src` directive.
- `apps/platform/src/startup.ts` → parse `export const DEV_DEFAULT_ORIGINS = [...]` literal via lightweight regex (the constant is a stable shape; if it changes shape the script must be updated and the failure is loud, not silent).
- `apps/platform/src/startup.ts` (or fallback to `process.env.PORT` default `4100`) for the platform listen port.

Outputs a clear pass/fail line per invariant. Exits 0 on pass, 1 on fail. Hooked into both:
- `apps/desktop/package.json` — new `prebuild` step runs the script.
- `apps/platform/package.json` — new `prebuild` step runs the script.

Why both: a developer who only runs `pnpm --filter @offisim/desktop build` (touching tauri.conf.json) needs the same gate as one who only runs `pnpm --filter @offisim/platform build` (touching startup.ts).

Alternative considered: place under `pnpm typecheck` or root `pnpm build`. Rejected — root `pnpm build` is turbo-orchestrated and the script needs to surface clearly per affected package, not as a single root-level failure.

### Decision 5: Documentation says "see spec", not duplicates spec text

`apps/desktop/CLAUDE.md` and `apps/platform/CLAUDE.md` get a one-line pointer: "Origin coupling: see `openspec/specs/desktop-llm-credential-isolation/spec.md` requirement *Tauri release `.app` CSP and platform CORS allowlist stay coupled*." Root `CLAUDE.md` gets a one-line pointer for narrow tier scope. We do NOT copy spec text into CLAUDE.md — that creates the same drift problem in a different shape.

## Risks / Trade-offs

- **Risk: Smoke check breaks an unrelated `tauri.conf.json` field move.** → Mitigation: script reads only `app.security.csp` and `app.windows[].minWidth`; defensive parse with explicit error on schema mismatch ("expected `app.security.csp` to be a string"). Failure is loud and points at the field that moved.
- **Risk: Reverting to `minWidth: 1024` breaks a verifier who wanted to verify narrow drawer in release shell.** → Mitigation: the new spec scenario explicitly directs narrow verification to `pnpm --filter @offisim/web dev` (browser DevTools resize). The `cleanup-ui-shell-followups` archive note already records that narrow tour-ref defect was found AND fixed during the verify cycle, so future regressions of narrow tier behavior would still be caught — just in the web SPA, not the desktop shell.
- **Risk: Future platform port change (e.g., dynamic port for production deployment) breaks the static `4100` invariant.** → Mitigation: spec scenario calls out "platform listen origin" as the abstract concern; if production port is configurable, the script accepts an env override (`OFFISIM_PLATFORM_PORT`). For now `4100` is stable across dev. When production deploys, that change carries its own update to the script + CSP via build-time injection (already foreshadowed in the existing spec line "build-time env injection, not by relaxing the local-development allowlist").
- **Risk: `apps/platform/src/startup.ts` parse-by-regex is fragile.** → Mitigation: the script's regex extracts the array literal between `DEV_DEFAULT_ORIGINS = [` and the closing `];`; if the file is refactored to load from JSON or env, the script fails loud with "could not locate `DEV_DEFAULT_ORIGINS` literal in `apps/platform/src/startup.ts` — update the smoke check OR keep the literal stable". This is a deliberate choice: we want the constant shape to be stable, and the smoke check enforces that.
- **Trade-off: Adding two prebuild hooks slightly slows `pnpm --filter @offisim/desktop build` and `pnpm --filter @offisim/platform build`.** → Cost is a single Node process spawn that reads two files; negligible vs the rebuild cost itself. Worth it to catch drift at edit time, not at runtime in release.
- **Trade-off: Production-grade scope rejected (full release-shell contract validator).** → Acknowledged in user direction; we ship the targeted fix today, not the speculative validator. If plugin-three-piece or single-instance ordering bugs reappear, that change can be proposed separately.
