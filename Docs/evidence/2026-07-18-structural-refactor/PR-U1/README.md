# PR-U1 evidence — query-key factory

Checked at: 2026-07-19 NZST

## Scope and §0 audit

- Branch: `refactor/U1-query-key-factory`
- Base: `f105efc28bcfc171adb21dd62c40fcd4a532c434`
- Change is mechanical: centralize existing TanStack Query keys and the two existing deletion invalidation groups. No product copy, persistence contract, deletion semantics, or runtime behavior changed.
- No migration, compatibility layer, fallback, new runtime abstraction, or safety-boundary change was introduced.
- Full-app merge is intentionally not performed; merge remains user-controlled.

## Static and release gates

- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 gates green.
- `pnpm --filter @offisim/desktop build`: PASS; signed release `.app` rebuilt.
- `git diff --check`: PASS.
- Repository oracle `rg -n 'queryKey:\\s*\\[|invalidateQueries\\(\\{\\s*queryKey:\\s*\\[|setQueryData\\(\\s*\\[' apps/desktop/renderer/src`: zero matches.
- Release app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Live-tested release binary SHA-256: `c27078929963cbd912e59bf8347373fc9772e1d9f5a28edc2f60114c76614b3b`.
- Final rebuilt release binary SHA-256: `2709ea68c654fb75fcfe8736848f8674bf56d599a29efdb6adaa67954108fdd5`. No source file changed between the live deletion tests and this final rebuild; only evidence files were added afterward.
- Build warning: notarization was skipped because notarization credentials were not present; bundle compilation and Developer ID signing passed. Notarization is not a PR-U1 acceptance gate.

## Release `.app` live verification

The exact U1 worktree release app was launched by path and attached through Computer Use after resolving the target window by PID, window id, title, bounds, and AX URL. The live-tested binary hash is recorded above; the same source tree was rebuilt once more after the live tests. No localhost/dev-webview result is used as evidence.

### Company deletion and query refresh

- Test company: `U1 QueryKey QA 2026-07-18` (`e9f9909f-d9cd-4cfe-93f6-5c1170d41661`), with zero projects and zero threads before deletion.
- The release UI's Company Actions → Delete flow displayed the destructive confirmation and completed successfully.
- The company disappeared from the live company list without app reload.
- Toast: `Company deleted` / `U1 QueryKey QA 2026-07-18 and its Offisim-managed local history were cleared.`
- Direct post-check: `companies` contains zero rows for the test company id.
- Images: `01-delete-company-confirmation.jpeg`, `02-company-deleted-list-refreshed.jpeg`.

### Conversation deletion and query refresh

- Isolated test conversation: `U1 Conversation Delete QA 2026-07-19` (`thread-u1-delete-qa-20260719`), created only as test data and with no run.
- Before deletion the project list showed 17 conversations; after the release UI's Delete flow it showed 16 without app reload.
- Toast: `Conversation deleted`.
- Direct post-check: `chat_threads` contains zero rows for the test thread id.
- Images: `03-delete-conversation-confirmation.jpeg`, `04-conversation-deleted-list-refreshed.jpeg`.

### Clean shutdown and test-data cleanup

- The release app was closed through Computer Use after verification.
- Three stale B2 live-test threads were discarded in the release UI, then deleted using the product deletion statement order while the app was closed. The user explicitly authorized deletion of all test data.
- Final database checks: U1 company `0`; U1 conversation `0`; three B2 test conversations `0`; active agent runs `0`; active thread interactions `0`.
- No project workspace files or non-test conversations were deleted.

## Evidence integrity

Image hashes and live window identities are recorded in `manifest.json` and `live-observations.txt`.

GitNexus staged-scope audit reported 137 changed symbols, 45 changed files, 40 affected execution flows, and aggregate `CRITICAL` risk due to the intentionally broad renderer query-key touch surface. It did not identify a concrete safety-boundary change; independent reviewer sign-off is required before commit.

Independent fresh review: APPROVE, no blocker or actionable finding. The reviewer independently established that main and U1 both contain exactly 122 `invalidateQueries`/`setQueryData` operations; all 122 U1 operations route through `queryKeys` (including two local variables created by `queryKeys.officeLayout`). It also verified 165/165 `queryKey` properties route through the factory, the company helper preserves the original five invalidations and order, the conversation helper preserves the original six invalidations and order, all four image hashes match, renderer typecheck passes, and `pnpm harness:conversation-deletion` passes.
