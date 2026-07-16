# Release Gates

Offisim does not keep a broad product unit-test suite. Release validation is a
fixed set of retained gates plus release-app live verification. Match the gates
you run to the risk of the change, but **a desktop release must be green on the
core gates below and carry live `.app` evidence.**

All commands run from the repo root unless noted.

## Enforcement

These gates are not a convention — they are enforced in two places:

- **CI** (`.github/workflows/ci.yml`) runs the core gate set plus desktop
  `cargo test` on every push/PR to `main`.
- **`pnpm release:run`** runs the same core gates before building, aborts on
  the first failure, and writes evidence — per-gate logs, git commit/dirty
  state, and the `.app` bundle sha256 — to `output/release-evidence/`.
  `--skip-gates` exists for local iteration only; its output is marked
  non-evidence in `summary.json`.

The gate list itself is defined once in `scripts/release-gates.mjs`; CI and
`release:run` both consume it, so only this prose table can drift — update it
when the list changes.

## Core gates (run for any release-bound change)

| Gate | Command | Proves |
|------|---------|--------|
| Types | `pnpm typecheck` | all 21 workspace packages compile (`tsc --noEmit`) |
| Validate | `pnpm validate` | types plus product, runtime, workspace, UI, security-boundary, and dead-code harnesses |
| Product truth guards | `pnpm harness:review-fixes` | neutral gateway, exact account/model truth, docs truth, and removed partial lanes stay coherent |
| API adapter host | `pnpm harness:pi-agent-host` | bundled API host wiring, target/provenance, tools, usage, delegation, and release resources |
| Codex subscription host | `pnpm harness:codex-app-server-contract` | official sidecar artifact plus native protocol, stream, account/model, approval, Stop, Usage, and recovery contracts |
| UI hygiene | `pnpm check:ui-hygiene` | no stale/dead UI copy, no hardcoded provider copy outside settings, design-token discipline |
| Security harness | `pnpm security:harness` | platform auth/body-limit, doc-engine CSV, git-source tarball cap/zip-bomb, registry-client, web fetch/search boundaries |
| Desktop Rust | `cargo test` in `apps/desktop/src-tauri` | path containment, shell classifier, redaction, attachment store, local db baseline/refusal behavior |
| Supply chain | `pnpm audit --prod --audit-level high` | no unresolved high/critical advisories in the prod tree (transitive highs are pinned via root `pnpm.overrides`) |

## Build gates (desktop release)

```bash
# renderer must build before any desktop verification
pnpm --filter @offisim/desktop-renderer typecheck
pnpm --filter @offisim/desktop-renderer build

# desktop release .app
pnpm --filter @offisim/desktop build
codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

The desktop `cargo` side is gated by `cargo check` / `cargo test` in
`apps/desktop/src-tauri` for any Rust change (credential transport, sidecars,
workspace containment, local shell/git/path commands, install materialization).

## Platform gates (when `apps/platform` / `packages/db-platform` change)

```bash
pnpm platform:migration:drift   # migration generation/drift for the Postgres schema
pnpm platform:auth-harness      # auth boundary harness (also run inside security:harness)
```

## Risk-matched harnesses (run when the change touches that area)

| Area | Command |
|------|---------|
| Production gateway / cross-engine behavior | `pnpm harness:runtime-conformance`, `pnpm harness:renderer-engine-authority`, `pnpm harness:execution-provenance` |
| API adapter host | `pnpm harness:pi-agent-host` |
| Codex subscription host | `pnpm harness:codex-app-server-contract` |
| Doc-engine parsers | `pnpm harness:doc-engine` |
| Chat attachments | `pnpm harness:chat-attachment-roundtrip` |

The full harness inventory is the `harness:*` scripts in the root
`package.json`. LangGraph-era or partial provider lanes are not release
evidence. The neutral gateway plus the selected engine-specific host gate are
the active runtime proof.

## Release `.app` live verification (required for desktop runtime behavior)

A green typecheck/build is **not** sufficient for UI/runtime changes. Build the
renderer and `@offisim/desktop`, then launch the exact release bundle from this
worktree:

```
apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

Drive it with Computer Use (window attach, interaction, screenshots,
foregrounding, closing). Record the app path/hash, ad-hoc signing verification,
plus the observed behavior.

Not acceptable as release evidence: dev webviews, `pnpm --filter
@offisim/desktop-renderer dev` servers, localhost browser checks, or
`open -b com.offisim.desktop` bundle-id launches (multiple worktrees may share
the bundle id).

## Evidence rule

Release evidence must name the specific gate (gateway/engine harness,
Rust check, platform drift, build, or live `.app` observation) that actually
proved the behavior. Do not reintroduce broad `vitest` / Playwright / `pnpm
test` suites as product gates.

See also: [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) · [DEPLOYMENT.md](./DEPLOYMENT.md)
