# Changelog

## 1.0.0-rc.2

- Added a Developer ID signed and notarized release publisher with stapled DMG/ZIP artifacts and SHA-256 evidence.
- Added private GitHub release checks and one-click updates through the user's existing authenticated `gh` CLI.
- Added startup safe mode with sanitized diagnostic export, local-data reset, restart recovery, and Rust setup panic capture.

## 1.0.0-rc.1

### Open Source Release Candidate

- added legal and contributor-facing open source files
- added GitHub issue templates, a pull request template, and a CI workflow
  (`.github/workflows/ci.yml`) that enforces the core release gates on every
  push/PR: typecheck, Pi Agent Host validation, UI hygiene, security harness,
  supply-chain audit, and desktop Rust tests
- `pnpm release:run` runs the same gates before building, aborts on any
  failure, and writes release evidence (gate logs, git commit, bundle sha256)
  to `output/release-evidence/`
- release desktop builds no longer ship WebView devtools; live-verify builds
  opt back in with `pnpm --filter @offisim/desktop build:devtools`
- collapsed the prelaunch local SQLite schema to a single baseline: fresh
  installs bootstrap `packages/db-local/src/schema.sql` and are stamped via
  `PRAGMA user_version = 1`; historical local migration SQL was removed because
  Offisim has no launched user-data upgrade contract
- added Docker support for the platform API and local Postgres
- aligned package metadata for an open source release candidate
- fixed the web `tauri-repos` import path so tests no longer depend on private `dist` paths
- prepared the repository for final 1.0 UI and runtime polish

### Known limitations

- Market install pipelines cover skill and employee packages; company
  templates, office layout packs, and prefab packs are preview-only listings
  (see README → "1.0 marketplace install scope")
- the platform API is a single-process deployment; the rate limiter is
  process-local (see `Docs/00_start_here/DEPLOYMENT.md`)
- no in-app auto-update mechanism; updating means installing a newer build
  manually (deliberate 1.0 trade-off, documented in DEPLOYMENT.md)
- no automated release/CD workflow yet; releases are produced locally via
  `pnpm release:run`, which records gate + bundle evidence
- AI provider credentials and model configuration are owned by Pi Agent under
  `~/.pi/agent/`; Offisim does not maintain a provider catalog or store
  provider API keys
