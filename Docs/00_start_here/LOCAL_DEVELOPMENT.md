# Local Development

How to set up a new machine and run Offisim locally. Offisim is a Tauri 2
desktop app (with an internal Vite + React WebView renderer) plus an optional
Hono platform/registry backend.

## Prerequisites

| Tool | Version | Needed for |
|------|---------|-----------|
| Node.js | `>=20` (dev uses 25.x) | everything; enable `corepack` |
| pnpm | `10.15.1` (pinned in `packageManager`) | install/build/scripts |
| Rust + Cargo | stable (dev uses 1.93.x) | the desktop app (`apps/desktop`) |
| Tauri system deps | per OS ([tauri.app prerequisites](https://tauri.app/start/prerequisites/)) | desktop build (WebKit, Xcode CLT on macOS, etc.) |
| PostgreSQL | 16 | only if you run the platform API |

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
```

## First-time setup

```bash
git clone https://github.com/mike007jd/Offisim.git
cd Offisim
cp .env.example .env.local
pnpm install
```

`.env.local` notes:

- Pi Agent owns provider auth/model registry/session state. Offisim no longer
  reads provider keys from `.env.local` or maintains a provider-source catalog.
- Platform-backed features (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGINS`)
  are only required if you run `apps/platform`.

## Common entrypoints

| Command | What it runs |
|---------|--------------|
| `pnpm --filter @offisim/desktop dev` | **Recommended** — full Tauri desktop app in dev |
| `pnpm --filter @offisim/desktop-renderer dev` | renderer Vite dev server only (browser preview; not a release-equivalent path) |
| `pnpm --filter @offisim/platform dev` | platform/registry/auth API on `:4100` |
| `docker compose -f docker/docker-compose.yml up --build` | platform API + Postgres in containers |

## Build

Builds are orchestrated by Turborepo; dependencies build in order
(`shared-types → core → renderer → …`). Do not build packages in parallel by
hand — that can read stale `dist`.

```bash
# whole monorepo
pnpm build

# desktop renderer only (fast inner loop)
pnpm --filter @offisim/desktop-renderer typecheck
pnpm --filter @offisim/desktop-renderer build

# desktop release app (.app bundle)
pnpm --filter @offisim/desktop build
```

The release bundle for live verification is the exact worktree path
`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.

## Pi Agent runtime (desktop)

AI execution goes through the Pi Agent Host bundled with the Tauri app. Offisim
passes the active project workspace as the Pi session cwd and projects Pi
events into chat/3D state. Provider auth, models, sessions, and compaction stay
inside Pi-owned storage.

## Local SQLite

The desktop app uses a single-baseline schema
(`packages/db-local/src/schema.sql`), bootstrapped at startup — there is no
migration chain. To wipe dirty local data, use the repo's release run action
(`pnpm release:run`), not a hand-written migration.

## Troubleshooting

- **Blank white desktop screen on second dev instance** —
  `tauri-plugin-single-instance` must be first in the plugin chain; a second dev
  instance otherwise shares SQLite and hangs. See `apps/desktop/CLAUDE.md`.
- **Renderer not picking up a workspace dep change** — rebuild the dep and
  restart the dev server: `pnpm --filter @offisim/core build` then restart.
  `optimizeDeps.force` is on for `serve`, so a server restart re-bundles.

See also: [DEPLOYMENT.md](./DEPLOYMENT.md) · [RELEASE_GATES.md](./RELEASE_GATES.md)
