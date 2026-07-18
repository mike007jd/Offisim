# Deployment

Offisim ships in two pieces with very different deployment models:

1. **Desktop app** (`apps/desktop`) — the product. Distributed as a Tauri
   `.app` / installer that runs entirely on the user's machine. There is no
   server to deploy for the desktop runtime; execution is local-first.
2. **Platform/registry backend** (`apps/platform`) — an optional Hono (Node)
   HTTP API for auth, registry, review, and install support. This is the only
   deployable service.

> Offisim is **not** a standalone hosted web product. Do not reintroduce an
> `apps/web` SPA host or a standalone launcher — those were removed. The only
> server here is the platform API.

## Platform API — Docker (recommended)

```bash
docker compose -f docker/docker-compose.yml up --build
```

This builds `docker/platform.Dockerfile` (`pnpm --filter @offisim/platform...
build`, then `node apps/platform/dist/index.js`) and brings up:

- `platform` on `:4100`
- `postgres:16-alpine` on `:5432` with a `pgdata` volume

The compose file ships dev-grade defaults (`BETTER_AUTH_SECRET: change-me-for-real-use`).
**Override every secret for any real deployment.**

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
`pnpm --filter @offisim/desktop build`; the bundle is at
`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.

Signed, notarized, stapled DMG and update ZIP artifacts are published from the
repo root with:

```bash
pnpm release:publish -- --tag v1.0.0 --target main
```

The command runs renderer, Node, Rust, and release-build gates; builds and signs
`Offisim.app` with `Developer ID Application: Haosheng Li (9MP925J67C)` from the
login keychain; submits through the `offisim-notary` keychain profile; staples
and Gatekeeper-assesses the app and final DMG; writes SHA-256 sidecars; then
creates the GitHub release. Use `--draft` for QA. It refuses a dirty production
worktree by default. No Apple password, GitHub token, or updater credential is
read from `.env.local`, written to disk, or printed by this flow.

The recommended release entrypoint is `pnpm release:run` from the repo root —
it enforces the core gates from
[`RELEASE_GATES.md`](./RELEASE_GATES.md) before building, aborts on any
failure, and writes evidence (gate logs, git commit, bundle sha256) to
`output/release-evidence/`.

Release builds do not include WebView devtools. Live-verify builds that need
right-click → Inspect on the `.app` must be made with
`pnpm --filter @offisim/desktop build:devtools` and must not be distributed.

### Private-repository app updates

Settings › App Updates checks and installs releases through the user's existing
GitHub CLI login. Offisim invokes a fixed repository and fixed command surface;
it never asks for, reads, copies, logs, or persists the gh token. Missing or
signed-out GitHub CLI states show setup instructions and are never auto-fixed.
Downloaded updates must match the release SHA-256, exact bundle version,
Developer ID team, code signature, and Gatekeeper notarization before the
running `/Applications/Offisim.app` is replaced and restarted.

The official Tauri updater is intentionally not used while the repository is
private: private GitHub release metadata and assets require authenticated HTTP
requests, which would put a reusable GitHub credential in the desktop updater
path. The decision and current-source check are recorded in
[`2026-07-18-distribution-readiness.md`](../architecture/2026-07-18-distribution-readiness.md).

See also: [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) · [RELEASE_GATES.md](./RELEASE_GATES.md)
