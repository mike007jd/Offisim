# Local Development

How to set up a new machine and run Offisim locally. Offisim is a Tauri 2
desktop app (with an internal Vite + React WebView renderer) plus an optional
Hono platform/registry backend.

## Prerequisites

| Tool | Version | Needed for |
|------|---------|-----------|
| Node.js | `>=22.19.0` (release bundle uses 24.x) | everything; enable `corepack` |
| pnpm | [`11.13.1`](https://www.npmjs.com/package/pnpm/v/11.13.1) (pinned in `packageManager`; official npm registry checked 2026-07-17) | install/build/scripts |
| Rust + Cargo | stable (dev uses 1.93.x) | the desktop app (`apps/desktop`) |
| Tauri system deps | per OS ([tauri.app prerequisites](https://tauri.app/start/prerequisites/)) | desktop build (WebKit, Xcode CLT on macOS, etc.) |
| PostgreSQL | 16 | only if you run the platform API |

```bash
corepack enable
corepack prepare pnpm@11.13.1 --activate
```

## First-time setup

```bash
git clone https://github.com/mike007jd/Offisim.git
cd Offisim
cp .env.example .env.local
pnpm install
```

`.env.local` notes:

- AI provider keys are not read from `.env.local`. Configure API providers in
  the desktop AI Accounts surface; Pi writes them to its own
  `~/.pi/agent/models.json` and returns only safe summaries. External CLI
  orchestration reuses CLI-owned login without copying OAuth/session files.
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

## AI runtime engines (desktop)

AI execution goes through one neutral desktop gateway. The Pi API engine plus
Codex and Claude Code CLI orchestration adapters are implemented.
Each Turn binds one backend-authorized effective workspace and one engine lane.
Pi additionally binds a configured API account/model; external CLI login, model
choice, sessions, compaction, and global memory remain in the CLI's own home.

## Local SQLite

The desktop app uses a single-baseline schema
(`packages/db-local/src/schema.sql`), bootstrapped at startup — there is no
migration chain. To wipe dirty local data, delete the local `offisim.db` and let
the app rebuild it from the current baseline; do not add a hand-written
migration for prelaunch local state.

## Troubleshooting

- **Blank white desktop screen on second dev instance** —
  `tauri-plugin-single-instance` must be first in the plugin chain; a second dev
  instance otherwise shares SQLite and hangs. See `apps/desktop/CLAUDE.md`.
- **Renderer not picking up a workspace dep change** — rebuild the dep and
  restart the dev server: `pnpm --filter @offisim/core build` then restart.
  `optimizeDeps.force` is on for `serve`, so a server restart re-bundles.

See also: [DEPLOYMENT.md](./DEPLOYMENT.md) · [RELEASE_GATES.md](./RELEASE_GATES.md)
