# Deployment

This document covers the supported deployment surfaces for Offisim 1.0.

## Docker Compose

From the repository root:

```bash
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up
```

Services:

- Web SPA: `http://localhost:5176`
- Platform API: `http://localhost:4100`
- Health check: `http://localhost:4100/health`
- Postgres: `localhost:5432`

Important environment variables for the platform container:

- `DATABASE_URL`
- `CORS_ORIGINS`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`

## Static Web Deployment

`apps/web` builds to a static Vite bundle:

```bash
pnpm --filter @offisim/web build
```

Deploy `apps/web/dist` to any static host. If you deploy behind a custom API,
set `VITE_PLATFORM_API_URL` appropriately at build time.

### Vercel

Recommended settings:

- Root directory: repo root
- Build command: `pnpm --filter @offisim/web build`
- Output directory: `apps/web/dist`

## Platform API Deployment

The platform app depends on workspace packages, so treat it as a monorepo
service, not a single-file Node server.

Build:

```bash
pnpm --filter @offisim/platform... build
```

Start:

```bash
pnpm --filter @offisim/platform start
```

Good fits:

- Railway
- Fly.io
- Render
- Any container-based Node host

Required environment variables:

- `DATABASE_URL`
- `CORS_ORIGINS`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`

Optional provider keys, depending on your integration path:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`

## Desktop Build

The desktop app is the 1.0 reference environment.

Requirements:

- Rust / Cargo
- Tauri OS prerequisites
- Node 20+
- pnpm 10+

Build:

```bash
pnpm --filter @offisim/desktop build
```

## Operational Notes

- `CORS_ORIGINS` is mandatory in production for `apps/platform`
- Web and platform may be deployed independently
- Desktop bundles the web shell and does not require a hosted web deployment
