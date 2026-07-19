# PR-A2 evidence — revised-scope harness migration

- Branch: `refactor/A2-all-harness-runner`
- Base: A1 head `2f918532` (merged; includes the audit merge-precondition fixes)
- Scope: roadmap PR-A2 under the §3 (2026-07-19) contract revision.

## Revised scope execution

The §3.1 revision moved the 74 `noLocalRunnerChecks` harnesses out of A2 and
limited migration to the 30 `customSummaryRunnerChecks` files (see
`conflict-classification.json`, baseline `e31aa3a5`).

- The pre-revision worktree held 105 uncommitted drafts (30 custom + 74
  noLocal + `harness-manifest.mjs`). The full pre-classification draft state is
  archived verbatim in `draft-backup-105-files.patch.gz`.
- The 74 out-of-scope drafts (a `sharedRunner: true` manifest flag plus a
  wrapper `createHarness()` + trailing `h.report()` shim that did not replace
  any local check skeleton) were restored to their committed state, together
  with the manifest flag change. Their files are byte-identical to base.
- The 30 in-scope drafts replace the local `check()`/counter skeletons with
  `createHarness()` from `scripts/lib/harness-runner.mjs`, keeping each
  harness's own banner and summary lines.

## Per-file equivalence proof

`draft-verification-results.json` records, for each of the 30 files, a full
run of the manifest command against base (HEAD) and against the draft:

- 30/30: identical ✓/✗ check lines and identical exit codes.
- `harness-dramaturgy-stress.mts` differs only in a measured timing value
  (`per-frame compute < 8ms (got N ms)`); after normalizing the timing number
  and dropping an unrelated intermittent pnpm lockfile notice, the outputs are
  byte-identical.

This satisfies the §3.1 revised oracle: check lines (✓/✗) and exit codes are
byte-identical; legacy custom summary lines were preserved as-is (no runner
standard summary replacement was needed because these harnesses keep their own
summaries and call `h.report()` only as the exit-code authority).

## Gates

- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 gates green
  (includes typecheck and the full validate harness sweep through
  `scripts/run-harnesses.mjs`).

## Recorded plan deviations

- None beyond the §3-approved scope revision itself.

## Takeover audit correction (2026-07-19)

The original plaintext backup intentionally retained the draft's trailing
spaces, which made the PR itself fail `git diff --check`. It is now stored as a
deterministic `gzip -n` artifact so the backup remains byte-exact without
creating a false diff-hygiene failure:

- original patch SHA-256:
  `b4f86fa6966ad02db421428dfdac58360feaa5dfb27eb4ca37b6f67cdc8ae082`
- compressed artifact SHA-256:
  `903b8cb6b5cd4a2b2a29a3e4c659b9d40368d82d87ef53276ef7779a7c29d0b2`
- `gzip -dc draft-backup-105-files.patch.gz | shasum -a 256` reproduces the
  original patch SHA above.
