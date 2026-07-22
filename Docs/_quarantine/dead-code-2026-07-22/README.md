# Quarantine — dead-code-2026-07-22

Isolated from the renderer bundle by the Dead Code And Docs Cleanup Loop on
2026-07-22 NZST. This candidate remains recoverable here for one release cycle.

## `mission.css`

Legacy Verified Missions list/composer/control styles formerly imported from
`apps/desktop/renderer/src/styles/index.css`.

Evidence:

- 66 of 67 `.off-mission*` selectors had no TS/TSX/JS/config/string consumer.
- The sole name collision, `.off-mission-phase`, is a live Office selector whose
  current `inline-flex` layout was being overwritten by this later legacy import
  with `display: grid`.
- Current Mission UI mounts `.off-loops*` selectors from `mission/loops/loops.css`.
- Static gates cannot prove CSS cascade safety, so the full file is quarantined
  instead of deleted and must be covered by release `.app` visual verification.

Re-delete review: after one release cycle with no restore request.

## `orphan-selectors.css`

Zero-consumer selectors mechanically isolated from production stylesheets:

- Connect deliverable / approvals / contacts: `.off-ws-dlv*`, `.off-ws-oa*`,
  `.off-ws-ct*`.
- Market legacy hero: `.off-mkt-hero*`; live `.off-mkt-state-wrap` stayed in
  `market.css`.
- Personnel legacy per-employee tool permission editor: `.off-pers-toolperm*`,
  `.off-pers-tri*`.

Full prefix search found no TS/TSX/JS/config/string consumer. Static build gates
cannot prove selector reachability, so the payload remains here for one release
cycle and the current release `.app` must receive visual smoke coverage.

Re-delete review: after one release cycle with no restore request.
