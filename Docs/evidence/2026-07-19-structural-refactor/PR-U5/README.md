# PR-U5 release live evidence — 2026-07-19

## Artifact identity

- Worktree: `/Users/haoshengli/worktrees/offisim-refactor-u5`
- Branch: `refactor/U5-data-layer`
- Exact release app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Implementation commit built and verified: `c41ad86d1b94034742f39c2f37fc8e986d52f30c`
- Final release build time: `2026-07-19 05:52:40 +1200`
- Executable SHA-256 / size: `22a354afc9904d5358c9595321d111f6030af1d20464f971ecc5ecdac32b804a` / `33,940,032` bytes
- Executable PID during verification: `87258`
- Resolved window: `CGWindowNumber=33661`, title `Offisim`, bounds `36,33,1440x884`
- Signature: `Developer ID Application: Haosheng Li (9MP925J67C)`; `codesign --verify --deep --strict` passed.

## Automated gates

- `pnpm typecheck` — 21/21 tasks passed.
- `pnpm --filter @offisim/desktop-renderer build` — 5,714 modules transformed; production build passed.
- `pnpm harness:market-surface` — 10/10 passed.
- `pnpm harness:activity-data` — 51/51 passed.
- `pnpm harness:task-board-child-tree` — passed.
- `pnpm check:ui-hygiene` — passed, including 13/13 motion-token checks.
- `node scripts/release-gates.mjs --lane=node` — passed.
- `pnpm --filter @offisim/desktop build` — signed release `.app` built successfully.

## Mechanical ownership boundary

- Market types, registry connection storage/client construction, and registry/install/publish queries now live under `@/data/market/`.
- Board task/activity query models now live under `@/data/board/`.
- Activity icons, levels, labels, grouping, relative time, and checkpoint path display mapping remain in `activity-presentation.ts`.
- `displayActorName` and Market's internal `shortDate` remain in the data projection because those functions construct query view models; moving them would create a surface-to-data dependency or change the existing view-model contract.
- Every moved query key continues to use the PR-U1 `queryKeys` factory; no literal query-key array was introduced.

## Live verification

### Market install — passed

Created a real local skill package with `@offisim/install-core`, package id
`u5.refactor.live.skill`, version `1.0.0`, archive SHA-256
`f143333d1105a9b4ed120f273f670f314615880a96cb5c669009ae8ca7fd4b34`.
The signed release app imported the `.offisimpkg`, materialized it into the
selected company, showed `Installed`, and returned it from the Installed query
when searching `u5.refactor`.

- [Install success](market-install-live.png)
- [Installed query result](market-installed-live.png)

After the screenshots were captured and the release app was closed, the exact
verification package, installed asset, skill row, vault file, and temporary
archive were removed. Reverse checks returned zero matching package, asset, and
skill rows; no unrelated prelaunch data was touched.

### Market publish — externally blocked, not claimed complete

The signed release app loaded all eight real company employees as publish
sources, switched the source to Maya Lin, and accepted valid summary/details.
The final `Submit for review` action remained disabled because the configured
catalog endpoint is deliberately unreachable: `https://market.example.invalid`.
The release UI reported `Online catalog unavailable`; therefore no remote draft
was created and PR-U5's remote publish live acceptance remains blocked on a
reachable catalog plus valid creator account.

- [Publish source and completed form](market-publish-blocked-live.png)
- [Exact unavailable banner and Recent drafts blocker](market-publish-blocker-copy-live.png)
- [Configured unreachable endpoint](market-connection-blocker-live.png)

### Board — passed

Opened Office → Board in the signed release app. The Board query rendered the
current company state (`Requests and review`, `21 requests`) without an error.

- [Board live](board-live.png)

### Activity — passed

Opened Office → Timeline in the signed release app. The activity query returned
331 records and the surface-side presentation mappings rendered topic labels,
time buckets (`Today 5`, `Yesterday 76`) and relative timestamps.

- [Activity live](activity-live.png)

## Acceptance status

Typecheck, production build, node release gate, Market local install, Board, and
Activity are complete. Remote Market publish is **not complete** because the
only configured endpoint is intentionally non-routable; this is recorded as an
external live-environment blocker rather than being replaced by a mock or a
localhost/browser result.
