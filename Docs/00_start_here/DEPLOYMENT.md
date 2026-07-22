# Deployment

Offisim deploys in two pieces with very different models:

1. **Desktop app** (`apps/desktop`) — the product. Distributed as a Tauri
   `.app` / installer that runs entirely on the user's machine. There is no
   server to deploy for the desktop runtime; execution is local-first.
2. **Platform/registry backend** (`apps/platform`) — an optional Hono (Node)
   HTTP API for auth, registry, review, and install support. This is the only
   deployable service.

> Offisim is **not** a standalone hosted web product. Do not reintroduce an
> `apps/web` SPA host or a standalone launcher — those were removed. The only
> server here is the platform API.

As of **2026-07-22**, `v1.1.2` is the latest stable published release and the
GitHub repository is public. Offisim remains formally prelaunch with no
production user-data migration contract, but the published updater, deep-link,
signing, and installer formats are external distribution contracts. App Updates
discovers stable releases through the user's existing authenticated GitHub CLI
session.

## Platform API — Docker (optional local backend)

```bash
docker compose -f docker/docker-compose.yml up --build
```

This builds `docker/platform.Dockerfile` (`pnpm --filter @offisim/platform...
build`, then `node apps/platform/dist/index.js`) and brings up:

- `platform` on `:4100`
- `postgres:16-alpine` on `:5432` with a `pgdata` volume

Fresh Postgres volumes apply the single current prelaunch baseline from
`packages/db-platform/schema.sql` through `/docker-entrypoint-initdb.d/`. The
baseline is generated from `packages/db-platform/src/schema.ts`; numbered
historical migrations are intentionally not retained before formal launch.

Docker starts only the optional Platform backend. It does **not** launch the
desktop product.

The compose file intentionally has no published auth-secret default. Set a
random value of at least 32 characters before resolving or starting the stack:

```bash
BETTER_AUTH_SECRET="$(openssl rand -hex 32)" docker compose -f docker/docker-compose.yml up --build
```

The bundled database credentials remain local-development defaults; override
all database credentials and URLs for any shared or public deployment.

## Platform API — environment

| Variable | Purpose |
|----------|---------|
| `PORT` | listen port (default `4100`) |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (>=32 chars) |
| `BETTER_AUTH_URL` | public base URL of the platform |
| `CORS_ORIGINS` | comma-separated allowed origins (must include the desktop renderer origin) |
| `OFFISIM_TRUST_PROXY_HEADERS` | set `1` **only** behind a trusted proxy that overwrites `x-forwarded-for` |
| `TRUSTED_PROXY_DEPTH` | proxy-chain depth so the correct client IP is read |

## Single-instance constraint

The 1.0 platform is a **single Node process**. The rate limiter uses a
process-local token bucket, which is correct for one replica only. Horizontal
scaling (multiple processes / serverless / rolling deploys) requires first
replacing the in-memory bucket with a shared atomic store. The authoritative,
maintained list of what is approved vs. blocked is
[`Docs/platform-deployment-gates.md`](../platform-deployment-gates.md) — read it
before changing the deployment topology.

## Desktop / platform origin coupling

The release `.app` CSP `connect-src` and the platform CORS allowlist are two
independent-but-paired lists. Drift on either side is caught at build time by
`scripts/check-platform-tauri-origin-sync.mjs`. See
`apps/desktop/CLAUDE.md` → "Release CSP / platform CORS coupling".

## Desktop distribution

The desktop release `.app` used for local release verification is produced by
`pnpm --filter @offisim/desktop build`; the exact bundle path is
`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`.
Live verify and Computer Use must attach that current-worktree path — never a
bundle-id launch, never a host `/Applications` install as the source of truth.

Release and bundled-host builds must use the exact Node from repository
`.nvmrc` (`24.18.0`). Both `pnpm release:publish` and
`scripts/build-pi-agent-host.mjs` fail closed on any other `process.version`.

The recommended local release entrypoint is `pnpm release:run` from the repo
root. In formal mode it fail-closes on a dirty or unreadable Git worktree,
runs the core gates from [`RELEASE_GATES.md`](./RELEASE_GATES.md), aborts on any
failure, builds the desktop package, rechecks commit/dirty after build/hash,
and writes evidence (gate logs, git commit, bundle sha256, `releaseEvidence`)
under `output/release-evidence/`. `summary.releaseEvidence` is true only when
`evidenceDisqualifiers` is empty (for example `gates_skipped`, `dirty_worktree`,
`git_state_unknown`, `commit_changed_during_release`, or
`worktree_changed_during_release`). `--skip-gates` is local iteration only: the
summary records the skip and the run does **not** count as release evidence.

Signed, notarized, stapled DMG and update ZIP artifacts are published from the
repo root with `pnpm release:publish` only after explicit release authorization.
Historical `1.1.2` production invocation (already executed; do not re-run):

```bash
pnpm release:publish -- --tag v1.1.2 --target main --notes-file Docs/releases/v1.1.2.md
```

The historical `v1.1.1` and `v1.1.2` publish commands must not be re-run. Both
tags point at immutable historical release commits; `v1.1.2` is the current
published Latest stable.

Source contract: the publisher must run on branch `main`, after refreshing
`origin/main`, with `HEAD` exactly equal to `origin/main`, and with the GitHub
`--target` resolving to that same HEAD. The release version must be an
Apple-safe three-integer SemVer that matches root `package.json`,
`apps/desktop/package.json`, `apps/desktop/renderer/package.json`,
`apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock` (`offisim-desktop`), and
`tauri.conf.json`. The tag must be exactly `v{version}`, must not already exist
on origin, and after publish must fetch and resolve `tag^{commit}` to the exact
source HEAD. Mid-run source drift fails closed. The publisher reuses the full
`scripts/release-gates.mjs` (Node + Rust lanes), not a sliced `--lane=node`
substitute.

`--draft` is for QA only. `--allow-dirty`, `--skip-build`, and `--skip-gates`
are permitted only together with `--draft`; those escapes are not formal
release evidence and must not be treated as a published distribution. The
existing `v1.1.1` and `v1.1.2` releases are published and notarized. The
`v1.1.2` release additionally has replacement-installation and installed-app
streak evidence recorded in the release-readiness closeout.

When authorized, the command builds and signs `Offisim.app` with
`Developer ID Application: Haosheng Li (9MP925J67C)` from the login keychain;
verifies the app with `codesign --verify --deep` (it does not re-sign the app
with `codesign --force --deep`); submits through the `offisim-notary` keychain
profile; archives `notarytool log` JSON under the evidence directory; staples
and Gatekeeper-assesses the app and final DMG; writes SHA-256 sidecars; then
creates the GitHub release. A non-draft production worktree must be clean. No
Apple password, GitHub token, or updater credential is read from `.env.local`,
written to disk, or printed by this flow.

Release builds do not include WebView devtools. Live-verify builds that need
right-click → Inspect on the `.app` must be made with
`pnpm --filter @offisim/desktop build:devtools` and must not be distributed.

### GitHub app updates

Settings › App Updates checks and installs releases through the user's existing
GitHub CLI login. Offisim invokes a fixed repository and fixed command surface;
it never asks for, reads, copies, logs, or persists the gh token. Missing or
signed-out GitHub CLI states show setup instructions and are never auto-fixed.
Downloaded updates must match the release SHA-256, exact bundle version,
Developer ID team, code signature, and Gatekeeper notarization
(`xcrun stapler validate` before `spctl`) before the running
`/Applications/Offisim.app` is replaced and restarted.

The official Tauri updater is intentionally not used: the update path verifies
GitHub release metadata and assets through the user's existing authenticated
GitHub CLI session without putting a reusable GitHub credential in the desktop
updater path. The decision and current-source check are recorded in
[`2026-07-18-distribution-readiness.md`](../architecture/2026-07-18-distribution-readiness.md).

See also: [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) · [RELEASE_GATES.md](./RELEASE_GATES.md)
