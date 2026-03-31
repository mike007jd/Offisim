# Local Development Setup

This guide is for pulling Offisim onto a new machine and getting the repo running with the fewest surprises.

## Prerequisites

- `git`
- `Node.js 20+`
- `corepack` enabled so the repo uses the pinned `pnpm@10.15.1`
- `pnpm install` from the repo root

Additional prerequisites depend on what you want to run:

- Desktop app: `Rust` / `cargo` plus the Tauri system dependencies for your OS
- Platform API: `PostgreSQL`
- Browser E2E tests: Playwright browser install if you intend to run them

## Install

From the repo root:

```bash
corepack enable
pnpm install
```

If you use `nvm`, the repo now includes `.nvmrc`:

```bash
nvm use
```

## Environment Variables

Use the root example file as the source of truth:

```bash
cp .env.example .env.local
```

Important caveat:

- The root `.env.local` is the shared template used by repo tooling such as web Playwright smoke tests.
- `apps/platform` reads from the shell environment when you run it. Export the variables in your shell before starting it.
Minimum useful variables by surface:

- Desktop or browser runtime with platform-backed install flows:
  - `VITE_PLATFORM_API_URL=http://localhost:4100`
- Platform API:
  - `DATABASE_URL=postgres://localhost:5432/offisim_platform`
  - `BETTER_AUTH_URL=http://localhost:4100`
  - `BETTER_AUTH_SECRET=<32+ char secret>`
  - Recommended for local multi-app work: `CORS_ORIGINS=http://localhost:3000,http://localhost:5176,http://localhost:1420`
- LLM-backed smoke tests:
  - one provider key such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`

## Start Commands

Run these from the repo root in separate terminals as needed.

### Recommended Desktop Flow

```bash
pnpm --filter @offisim/desktop dev
```

Notes:

- This is the recommended 1.0 reference environment.
- Tauri automatically starts the `apps/web` Vite dev server for you.
- The web frontend runs at `http://localhost:5176` under Tauri dev.

### Browser Runtime Only

```bash
pnpm --filter @offisim/web dev
```

Use this only if you specifically want the browser shell without Tauri.

### Platform API

```bash
pnpm --filter @offisim/platform dev
```

Defaults:

- Port: `4100`
- Development CORS allowlist: `3000`, `5173`, and `1420` unless overridden
- Because `apps/web` currently serves on `5176`, set `CORS_ORIGINS` explicitly if you want browser runtime and platform API to talk to each other locally

## Common Local Setups

### Desktop Only

Use when you only want the local runtime shell:

```bash
pnpm --filter @offisim/desktop dev
```

### Platform + Runtime

Use when you want the publish/auth/registry flow plus the local runtime:

```bash
pnpm --filter @offisim/platform dev
pnpm --filter @offisim/desktop dev
```

### Full Local Stack

Use when you want everything available:

```bash
pnpm --filter @offisim/platform dev
pnpm --filter @offisim/desktop dev
```

## Verification

Useful repo-level checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Troubleshooting

- `pnpm` version mismatch: run `corepack enable` and retry.
- Desktop app fails before opening: confirm Rust/Cargo and Tauri prerequisites are installed.
- Platform starts but auth behaves strangely: confirm `BETTER_AUTH_URL` matches `http://localhost:4100`.
- Browser or desktop install flows cannot reach the platform: check `VITE_PLATFORM_API_URL`.
- Postgres connection errors: verify the local DB exists and matches `DATABASE_URL`.
