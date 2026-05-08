# Release Gates

This runbook is the release checklist for Offisim 1.0 security and marketplace
hardening. Do not mark a release candidate ready while any Gate A or Gate B item
is implemented but unverified.

## Gate A - Security Blockers

- Provider transport: webview sends provider profile id and endpoint kind only;
  Rust resolves credential destination, auth scheme, host allowlist, HTTPS/local
  exception, redirect policy, and response-header filtering.
- Trusted sidecars: Claude/Codex SDK lanes resolve cwd inside the bound
  workspace, do not receive raw base URLs from the webview, and emit no-secret
  sidecar audit events.
- Local workspace commands: path open/save, git, deliverables, and shell require
  project id plus workspace containment. Shell records approval, timeout,
  network-policy disclosure, exit code, and redacted output metadata.
- Marketplace ownership: publish draft create/update/submit and moderation
  updates must verify listing ownership against the creator.

## Gate B - Marketplace And Platform Hardening

- Marketplace manifests use `@offisim/asset-schema`; route Zod schemas only
  validate request envelopes.
- Artifact sha256/size are validated and persisted on active package versions.
- `external_url` artifact fetch is production fail-closed unless the full SSRF
  fetch contract is present: redirect revalidation, DNS A/AAAA validation,
  non-global IP rejection, timeout, max content length, byte cap, and streaming
  sha256.
- Install materialization runs through the desktop transaction path and rollback
  is verified for installed package/assets/employees/bindings.
- MCP stdio registration/startup requires source, approval id, command
  fingerprint, risk class, project scope where applicable, and startup/tool-call
  audit.
- Platform API tokens load scopes and route-level checks cover publish writes,
  install receipts, reviews, and local runtime bridge routes.
- Platform migrations are generated and drift checked; desktop fresh baseline
  remains allowed before first release, but post-release persistence changes need
  migration and rollback planning.

## Gate C - Commands And Evidence

Run the exact commands that match the changed surface:

- `pnpm typecheck`
- `pnpm validate` or `pnpm lint`
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/desktop build`
- `pnpm platform:migration:drift`
- `cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy && cargo test`
- `openspec validate harden-release-security-and-marketplace --strict`

For desktop behavior, launch the release app from the current worktree path:

`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

Record the commit SHA, app path, app bundle hash, environment, provider profile
class, command outputs/log paths, and release `.app` interaction evidence. Dev
webview or localhost browser evidence can help debug, but it is not release
desktop evidence.
