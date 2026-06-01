# Offisim Platform Deployment Gates

Last reviewed: 2026-06-01

Deployment gates that are valid for the current Tauri desktop + Hono platform
architecture. The 1.0 platform ships as a single Node process.

## Rate Limiting

`apps/platform/src/middleware/rate-limit.ts` uses a process-local token-bucket
store. This is sufficient for single-process production, local development, and
CI.

Approved for:

- single Node process deployment
- one platform replica behind a trusted proxy that overwrites `x-forwarded-for`,
  with `OFFISIM_TRUST_PROXY_HEADERS=1` and `TRUSTED_PROXY_DEPTH` matching the
  proxy chain
- local development and CI harness runs

Future multi-instance / serverless / rolling deploys (where requests can land on
different processes or isolates) must first replace the in-memory bucket with a
shared store (Postgres row-lock, Redis, or KV) that preserves atomic consume,
expiry, and the same per-client identity policy. This is not built yet because
1.0 is single-instance — add it when horizontal scaling becomes a real
requirement, not before.

## Proxy Trust

The rate limiter only trusts `x-forwarded-for` when explicitly told to:

- set `OFFISIM_TRUST_PROXY_HEADERS=1` **only** behind a trusted proxy that
  overwrites `x-forwarded-for`
- set `TRUSTED_PROXY_DEPTH` to match the deployed proxy chain so the correct
  client IP is read

`assertProxyTrustConfig()` warns at startup if a production deployment looks like
it sits behind a proxy without these set (per-IP limiting would otherwise
silently collapse to a single bucket).
