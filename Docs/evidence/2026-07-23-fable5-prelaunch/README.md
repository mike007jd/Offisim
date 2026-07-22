# Fable 5 prelaunch convergence evidence

Checked on 2026-07-23 (Pacific/Auckland) against branch
`codex/fable5-prelaunch-convergence`.

## Closed findings

- Secret persistence now fails closed when encryption or decryption fails; no
  plaintext fallback remains.
- Startup no longer purges former app storage. A fresh local database resets
  only the exact database, WAL, and SHM files when its schema stamp is absent or
  unsupported.
- The database project catalog is the only workspace authority. Runtime JSON
  cannot revive a deleted project, and recovery uses an explicit closed result.
- Resume requires a persisted `executionTarget.engineId`; it never defaults an
  ambiguous run into the API/Pi lane.
- Terminal and preflight retries are bounded and abortable. MCP scope/roster
  errors remain visible instead of silently projecting an empty result.
- Tauri privileges target only the `main` window. Renderer engine/model
  selection is discriminated, Pi ingress is strict, and Codex runtime version
  and adapter provenance are kept separate.
- Six inert prelaunch tables and their public surfaces were removed from the
  fresh baseline: `task_runs`, `tool_calls`, `handoff_events`,
  `recovery_knowledge`, `file_history`, and `llm_calls`.
- `active_thread_interactions` was reclassified as live after independent
  storage-path review and was deliberately retained.
- Cross-package imports now use an AST gate, the harness manifest validates its
  execution DAG, and the Biome warning baseline is ratcheted by file/rule
  signature. The ratchet is part of the shared CI/release Node gate lane.
- `desktop-agent-runtime.ts` was mechanically reduced by extracting terminal,
  stream checkpoint, engine configuration, execution preparation, and native
  runtime helper modules while preserving its public facade.

## Automated verification

- `pnpm validate`: 23/23 typechecks and 74/74 harness roots passed; the manifest
  covered 92 unique execution nodes and 102 declared harnesses.
- `pnpm lint`: 0 errors; 232/232 grandfathered warning signatures and no
  increase.
- `pnpm check:docs-truth`, `pnpm platform:migration:drift`,
  `pnpm security:harness`, and `pnpm audit:prod`: passed. Production audit
  reported no vulnerabilities.
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`: 505
  unit and 8 integration tests passed.
- `pnpm build`: 13/13 packages passed and produced the arm64 release app.
- `codesign --verify --deep --strict`: passed for the release app. Its Developer
  ID signature has hardened runtime enabled.
- Fable 5 final audit: `PASS`. Its three low findings were then closed
  (fail-closed comment truth, visible marketplace persistence errors, and lint
  release-gate wiring); the one allowed revision re-audit also returned `PASS`
  with no findings.

## Release app verification

Verified with Computer Use against the exact worktree artifact:

`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

- One standard Offisim window was exposed.
- Companies -> Office -> Settings navigation completed in the release app.
- AI Accounts rendered distinct Subscription Engines and API Providers areas.
- Codex CLI and Claude projected their own version/readiness and subscription
  billing boundary. An explicit Refresh completed and advanced `checkedAt`.
- API providers projected only a safe key-saved summary; no credential value was
  exposed.

Screenshot: [AI Accounts release verification](settings-ai-accounts-release.jpeg)

After the final renderer revision, the app was rebuilt, re-signed, re-verified,
and attached again by exact path. The schema-19 prelaunch baseline correctly
rebuilt the disposable local database, so this final launch reached the
first-run company screen in one standard window without creating replacement
business data.

Screenshot: [Final release fresh-baseline verification](final-release-fresh-baseline.jpeg)

## Notarization follow-up

The exact commit `53382424` release app was submitted through the Keychain
profile `offisim-notary`. Apple returned `Accepted` for submission
`7666ec71-016e-444d-9358-bf538c97ff5f`.

- `stapler staple` and `stapler validate`: passed.
- Gatekeeper: `accepted`, source `Notarized Developer ID`.
- Post-staple deep/strict codesign verification: passed.
- Computer Use reattached the exact stapled app and verified one standard
  window plus the interactive fresh-baseline company screen.
- A final ZIP was extracted into a new temporary directory; staple validation,
  Gatekeeper assessment, and deep/strict codesign verification all passed on
  the extracted app.

Screenshot: [Notarized release live verification](notarized-release-live.jpeg)

Local distributable:

`output/release-evidence/notarization-53382424/Offisim_1.1.2_aarch64_notarized.app.zip`

SHA-256:
`176bce5318713045b080999c8910ea65278fa33db484dbcbb45206ccaea9ab23`

No tag, GitHub Release, DMG, merge, deploy, or production state change was
performed.
