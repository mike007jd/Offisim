# PR-S2 evidence — repository contracts split by domain

Checked at: `2026-07-19T01:41:06+1200` (NZST)

Base: `refactor/S1-package-split-rename` at
`00f1cbe099ab94043c9ac3b13e223557e9683aba`

Branch: `refactor/S2-repositories-domain-split`

## Scope proof

- Split `packages/core/src/runtime/repositories.ts` into the nine contracted
  domain modules: `company`, `thread`, `run`, `mission`, `loop`,
  `collaboration`, `mcp`, `memory`, and `settings`.
- `repositories.ts` now retains only external repository type imports, the
  unchanged `RuntimeRepositories` aggregate, and re-exports of all nine domain
  modules.
- TypeScript AST comparison found all `192/192` original top-level
  declarations accounted for: `191` moved declarations are exact source-text
  matches and the root aggregate is exact. The `202/202` public names are
  preserved. See `declaration-move-proof.json`.
- All `69` existing consumer files still import the root facade; no consumer
  imports a new domain module directly.
- Domain ownership is: company/employee/template/workstation/project in
  `company`; graph/chat/interactions/file history/Pi messages in `thread`;
  task/agent/draft/tool/handoff/meeting/event/LLM/deliverable in `run`; the
  corresponding mission, loop, collaboration, MCP, memory/recovery, and
  settings/skills contracts in their named modules.
- No S1 package-boundary file or unrelated behavior is changed.

## Mechanical behavior proof

- The current file is not literally interface-only: it contains four exported
  functions, one private helper, and three exported runtime constants. Their
  complete bodies/initializers moved with exact source text; no branch,
  condition, value, or call changed.
- The compiled root facade contains only the nine `export *` statements. Pure
  type declarations/imports emit no JavaScript; this was checked against the
  current TypeScript `5.9.3` compiler and the official TypeScript Modules
  Reference on `2026-07-19`:
  <https://www.typescriptlang.org/docs/handbook/modules/reference.html#type-only-imports-and-exports>.
- GitNexus pre-edit impact was CRITICAL for `RuntimeRepositories` and
  `decodeFreshSessionContext`, HIGH for
  `isResettableNativeSessionPrestartCode` and `trimmedString`, MEDIUM for
  `coerceDeliverableKind`, and LOW for the remaining function/constants. The
  exact-declaration proof above is the zero-behavior control for that blast
  radius.

## Gate proof

- `pnpm exec turbo run typecheck --concurrency=1`: PASS, `23/23` tasks.
- `node scripts/release-gates.mjs --lane=node`: PASS, `4/4` gates green.
- Typecheck inside the node lane: PASS, `23/23` tasks.
- `pnpm exec turbo run clean && pnpm exec turbo run build --concurrency=1`:
  PASS, `13/13` tasks.
- `node scripts/check-cross-package-src-imports.mjs`: PASS,
  `87 grandfathered, 0 new`.
- Production dependency audit: PASS, no known vulnerabilities.
- `git diff --check`: PASS.
- GitNexus pre-commit `detect_changes(scope=all)` and the final staged-scope
  rerun: LOW, all `12` changed files observed, no affected execution flow
  detected.

The first post-clean default-concurrency typecheck exposed the repository's
generated-file ordering hazard: the asset-schema validator disappeared while
parallel tasks were running, so `21/23` tasks completed. Regenerating the
validator and running the same graph serially passed `23/23`; the subsequent
full node release gate also passed its normal typecheck `23/23`. No product
source change was made for this unrelated pre-existing build-order issue.

## Release artifact proof

S2 is a type-contract location-only mechanical PR, so its per-PR acceptance
contract requires whole-repository typecheck and no live UI interaction. The
mandatory serial build nevertheless produced the current-worktree release app:

`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

- `codesign --verify --deep --strict`: PASS.
- Signing identity: `Developer ID Application: Haosheng Li (9MP925J67C)`.
- Binary SHA-256:
  `51ae503cb11da61491c61b7b6cc23606a1011992eb29964e0046d3679f0c44cf`.
- Binary build time: `2026-07-19T01:38:21+1200`.

## Recorded plan deviations

1. The plan describes the original file as pure interfaces, but current S1
   head has four exported functions, one private helper, and three runtime
   constants interleaved with the contracts. Leaving them at the facade would
   violate the "only aggregate and re-export" requirement. They were therefore
   assigned to the existing `run` and `mcp` domains and moved byte-for-byte at
   declaration level, without inventing a tenth module or widening scope.
2. Live UI screenshots/recordings are not applicable to this zero-behavior
   type-contract relocation; the signed release artifact and exact declaration
   oracle are the relevant evidence.

## Independent fresh review

APPROVE: `0` blocker, `0` important finding, `0` actionable nit; reviewer made
no file edits.

The reviewer independently confirmed:

- `192/192` declarations and `202/202` public names are exact, with no missing,
  extra, or duplicate declaration.
- The seven runtime exports are the same set as S1; the private helper, function
  bodies, and constant initializers are covered by the exact-source oracle.
- `RuntimeRepositories` is exact, all nine contracted domains are present, and
  no existing consumer imports a domain module directly.
- Core typecheck/build, compiled-facade inspection, cross-package source-import
  gate, diff check, and staged GitNexus review are green.
- The pure-interface plan conflict and release-live applicability are recorded
  accurately above.
