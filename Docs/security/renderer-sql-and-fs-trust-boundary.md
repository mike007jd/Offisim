# Renderer SQL & FS Trust Boundary (S4 / D-1)

> Recorded by the GPT-5.5 audit remediation loop, Wave 1. Documents two desktop
> trust-surface decisions: the renderer raw-SQL risk (kept, with rationale) and
> the fs-capability narrowing (applied).

## D-1 — Renderer raw SQL (`sql:allow-execute`) — KEPT, documented

**What.** The desktop capability grants the webview `sql:allow-execute` (plus
`sql:allow-load/select/close`). The renderer's entire local data layer
(`apps/desktop/renderer/src/lib/tauri-repos/**` via the sqlite-proxy + raw
`db.execute`/`db.select`) runs SQL the **renderer JS composes** directly against
the local SQLite file.

**Risk.** Any code running in the webview can execute arbitrary SQL against the
local DB. There is no per-table / per-statement allowlist between the renderer and
SQLite — the boundary is "the webview is first-party Offisim code." A renderer
compromise (e.g. a malicious dependency executing in the webview) could read or
mutate any local row.

**Why it is NOT removed (authority D-1).** Removing `sql:allow-execute` means
rewriting the whole renderer repo layer to route every mutation through
hand-written, individually-permissioned Tauri commands — effectively re-deriving
the repository surface in Rust. That is a separate epic, not a pre-launch fix.
Pre-launch ROL is: (a) keep the local DB local (no network egress of raw SQL),
(b) reduce other plaintext/over-broad surfaces first (see S4 and the secret
hardening), (c) treat the renderer bundle as trusted first-party code and protect
*that* (dependency hygiene, the `check:deadcode` / `check:src-imports` gates, CSP).

**Compensating controls already in place.**
- The webview origin is the bundled app, not remote content; CSP `connect-src` is
  pinned (`Docs` invariant A/B) so the renderer cannot exfiltrate to arbitrary hosts.
- File/shell tool access is NOT via raw SQL — it goes through the sandboxed
  `project_*` / `builtin_tools` / `attachment_*` Tauri commands with path jails.
- Tenant-boundary correctness of the SQL the renderer *does* run is pinned by the
  Wave-0 contract harness (`scripts/harness-workspace-repo-contract.mts`).

A full `SecretStore` / least-privilege-SQL migration remains a tracked, separate
proposal.

## S4 — FS capability narrowed (applied)

**Before.** `apps/desktop/src-tauri/capabilities/default.json` granted the webview
`fs:allow-app-{read,write,meta}-recursive` and `fs:allow-temp-{read,write,meta}-recursive`
— blanket recursive read/write/metadata over the entire app-data and OS-temp dirs.

**Finding.** No webview code uses `tauri-plugin-fs`: an exhaustive scan found zero
`@tauri-apps/plugin-fs` imports, zero `plugin:fs|*` invokes, and zero
`BaseDirectory`/`readTextFile`/`writeTextFile` usage in
`apps/desktop/renderer/src`. Every real data path bypasses the fs capability:
- **Vault** writes/reads go through the `runtime_vault_*` custom Tauri commands
  (`local_paths.rs`, std::fs) — the old "vault 写盘" comment on the recursive grants
  was stale.
- **Local DB** goes through `tauri-plugin-sql` (`sql:*`), not fs.
- **Attachments** go through the `attachment_*` commands (`fs-shell` capability).
- **Drag-drop** allows each dropped path individually at runtime via
  `lib.rs` `try_fs_scope().allow_file/allow_directory`, and the renderer receives
  file path + name + size through the `offisim-native-file-drop` event payload
  (not by reading bytes via plugin-fs). The dynamic per-drop allow is independent
  of the static recursive grants.

**Change.** Removed all six `fs:allow-app/temp-*-recursive` permissions; kept
`fs:default` as the plugin baseline that the drag-drop dynamic scope rides on.

**Verification.** Static: the exhaustive scan above. Runtime: release `.app` boots
and the local v1 SQLite DB is created/written on disk (data layer functional) with
the narrowed capability. Interactive vault-write and drag-drop click-through were
not screenshot-verified in this environment, but both paths are statically
confirmed to bypass the fs capability, so the removal cannot regress them.

**Reversibility.** If a future webview feature genuinely needs plugin-fs over
app-data, re-add a **scoped** permission targeting the specific subpath (e.g. a
single vault subdir), not the blanket `*-recursive` grants.
