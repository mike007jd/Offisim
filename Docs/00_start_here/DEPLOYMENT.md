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

The desktop release is produced by `pnpm --filter @offisim/desktop build`; the
notarizable bundle is at
`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`. Code signing /
notarization is environment-specific and out of scope for this repo's defaults.

The recommended release entrypoint is `pnpm release:run` from the repo root —
it enforces the core gates from
[`RELEASE_GATES.md`](./RELEASE_GATES.md) before building, aborts on any
failure, and writes evidence (gate logs, git commit, bundle sha256) to
`output/release-evidence/`.

Release builds do not include WebView devtools. Live-verify builds that need
right-click → Inspect on the `.app` must be made with
`pnpm --filter @offisim/desktop build:devtools` and must not be distributed.

### No auto-update (deliberate 1.0 trade-off)

1.0 ships without `tauri-plugin-updater` or any in-app update channel. Updating
means installing a newer build manually. This is intentional for the 1.0
local-first scope: an update channel implies signed artifacts, an update
server, and a rollback story — all post-1.0 work. Before public launch, local
data is disposable across manual reinstalls: the local SQLite schema is a single
current baseline stamped with `PRAGMA user_version = 1`. Fresh databases
bootstrap from `packages/db-local/src/schema.sql`; older local/dev databases are
deleted and rebuilt rather than migrated.

See also: [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) · [RELEASE_GATES.md](./RELEASE_GATES.md)
