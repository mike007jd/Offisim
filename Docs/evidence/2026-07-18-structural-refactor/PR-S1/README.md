# PR-S1 evidence — dramaturgy split and prefab rename

Checked at: `2026-07-19T01:09:35+1200` (NZST)

Base: `origin/main` at `f105efc28bcfc171adb21dd62c40fcd4a532c434`

Branch: `refactor/S1-package-split-rename`

## Scope proof

- Added `@offisim/dramaturgy` and moved the dramaturgy runtime owner surface out
  of `@offisim/shared-types`.
- `packages/shared-types/src/dramaturgy`: `0` exported runtime functions.
- `packages/dramaturgy/src`: `21` exported runtime functions and `11` exported
  runtime constants.
- All `73` top-level runtime function bodies/variable initializers, including
  the `32` exported declarations, are textually identical to `origin/main`; see
  `runtime-move-proof.json`.
- Renamed `packages/renderer` / `@offisim/renderer` to `packages/prefab` /
  `@offisim/prefab`. The five prefab implementation files and `tsconfig.json`
  are byte-identical to `origin/main`; see `prefab-rename-proof.json`.
- Updated six real source import sites and the two consuming dependency
  manifests. No stale old package/path reference remains in code, configuration,
  or product documentation; the structural-refactor contract and this evidence
  deliberately name the old side of the rename.
- No S2 repository split or unrelated behavioral work is included.

## Gate proof

- `pnpm exec turbo run clean && pnpm exec turbo run build --concurrency=1`:
  PASS, `13/13` tasks, `0` cached.
- `node scripts/release-gates.mjs --lane=node`: PASS, `4/4` gates green.
- Typecheck within the node lane: PASS, `23/23` tasks.
- `node scripts/check-cross-package-src-imports.mjs`: PASS,
  `87 grandfathered, 0 new`.
- Production dependency audit: PASS, no known high-severity vulnerabilities.
- `git diff --check`: PASS.
- GitNexus pre-commit `detect_changes(scope=all)`: LOW; no affected execution
  flow detected. Pre-edit moved-symbol impacts peaked at MEDIUM (`composeBeats`,
  seven direct callers); no HIGH or CRITICAL result. The independent reviewer
  additionally classified `repairCompanyPrefabLayout` as HIGH impact, then
  verified that its function body is unchanged and only its package import path
  moved; build, typecheck, and focused harnesses remained green.

## Release artifact proof

S1 is a package-boundary-only mechanical PR, so its per-PR acceptance contract
does not require a live UI interaction. The mandatory serial build nevertheless
produced the current-worktree release app:

`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

- `codesign --verify --deep --strict`: PASS.
- Signing identity: `Developer ID Application: Haosheng Li (9MP925J67C)`.
- Binary SHA-256:
  `9ca78d02703918dac0f82963845a504beff1324832dbe4e7275b2e40d088918e`.
- Binary build time: `2026-07-19T01:03:02+1200`.

## Recorded plan deviations

1. The plan says five prefab reference points; the current tree has six real
   source import sites: platform seed x2, desktop static imports x2, and desktop
   lazy imports x2. All six were updated rather than leaving two stale runtime
   imports.
2. The plan's whole-package phrase "shared-types zero logic" conflicts with the
   enumerated S1 owner surface and the current repository: after all 21
   dramaturgy runtime functions move, `@offisim/shared-types` still has 51
   exported functions in unrelated domains. Per the clarified S1 contract, this
   PR makes `shared-types/src/dramaturgy` pure type contracts and does not absorb
   unrelated domains or expand into S2.
3. Live UI screenshots/recordings are not applicable to this zero-behavior
   package-boundary PR; the signed release artifact above is the build evidence.

## Independent fresh review

APPROVE: `0` blocker, `0` important finding, `0` actionable nit; reviewer made
no file edits.

The reviewer independently confirmed:

- `32/32` moved exported function bodies/constant initializers exact, with no
  mismatch.
- Exported type/interface surface across all nine original dramaturgy files is
  unchanged, and `shared-types/src/dramaturgy` has zero exported functions.
- No stale shared-types runtime import remains for the 32 moved runtime symbols.
- Five prefab implementation files plus `tsconfig.json` are byte-identical; the
  root index changes only its package-name comment.
- Focused dramaturgy/scene/ambient harness group passed, including beat
  `69/69`, staging `34/34`, office visual language `50/50`, and ambient `66/66`.
- Documentation, lockfile, and dependency diffs match the package boundary.
