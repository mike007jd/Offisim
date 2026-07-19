# PR-A1 — harness runner pilot and validate manifest evidence

Checked at: 2026-07-19 NZST

Branch: `refactor/A1-harness-runner-pilot`
Scope: tooling-only mechanical refactor; no renderer/runtime/Rust product behavior changed.

## Contract clarification

The shared `h.report()` contract necessarily appends its fixed summary, so the
roadmap's literal “entire log byte-identical” sentence cannot coexist with its
mandatory `h.report()` requirement. The enforced oracle is stricter about the
successful path: each migrated harness's complete legacy success body remains
byte-identical, and only the new fixed `h.report()` plus aggregate runner summary
are appended. Assertions, command bodies, ordering, fail-fast behavior, and
non-zero failure semantics remain unchanged.

Two async pilots have one unavoidable failure-log deviation from adopting the
fixed anchor unchanged: `mission-service` and `loop-mission-adapter` previously
printed `✗ name`, a newline, and `error.stack ?? error.message`; shared
`checkAsync` prints `✗ name — error.message` on one line. The roadmap forbids
rewriting the supplied anchor, so this PR records the exact deviation rather
than claiming failure-log byte identity. The failure oracle below proves both
still report the failed check and exit nonzero.

The current root package contains exactly 100 `harness:*` ids. Thirteen are
ordered composites, including the one Cargo entry; these are represented with
explicit `composite`, `steps`, and `runner: "cargo"` metadata. This preserves the
real commands without inventing another scheduler.

## Manifest oracle

| Fact | Result |
| --- | --- |
| package `harness:*` ids | 100 |
| unique manifest ids | 100 |
| legacy command strings vs manifest | byte-identical, same order |
| composite entries | 13 |
| Cargo entries | 1 |
| shared-runner pilot entries | 10 |
| legacy validate harness roots | 73, same order |
| tooling-only private-source import exceptions | 85, now manifest-owned |
| package single-id entries routed through `--only` | 100/100 |

The loader special case is explicit on `chat-persistence` via
`nodeOptions: "--import $PWD/scripts/harness-chat-persistence.loader-register.mjs"`.
`node scripts/run-harnesses.mjs --only chat-persistence` passed all 18 persistence
scenarios plus the chained 50-interleaving semantic-title repository gate.

## Before/after log oracle

For each successful pilot invocation, the package command banner and the two new
fixed runner summaries were removed from the comparison. The remaining complete
legacy success log body was byte-equal before and after:

| Harness | Legacy body SHA-256 | Byte-equal |
| --- | --- | --- |
| `studio-placement` | `8804d6fa0181869e69aa2818d4ea467df110d36c4973fe01e27255cc14a29635` | yes |
| `motion-tokens` | `6a7e0aa33ab05debf630ec2b4c34301a91febf5e65524465d9019b249bff8a91` | yes |
| `activity-data` | `1cfcf789fa3056018f41dcd64df90e8c6debd92b08df8a40f8591c02d1db48b0` | yes |
| `agent-run-projection` | `d18325b31a045822000484fe7e7a9b6cb84b2d0f5b99879940cfb58889f0026b` | yes |
| `artifact-claim` | `eb1a9ffb2a57fb7df81cbdee9c863eef778832e816d411000dd5881df7652f2f` | yes |
| `beat-composer` | `e00dccc868819c8199b082b09f7b375bc91f2aa6bd05522614df55c3a5643fd8` | yes |
| `dramaturgy-modes` | `4fc2672a2885059b782026a2cf2b506679614274f17011bf5d9ae777255ade91` | yes |
| `workload-chips` | `fae8daef1b30fe0602a09cb9e99ea0b44420066414ba593071f77c9cfb8a3130` | yes |
| `loop-mission-adapter` | `131dbd97b55bd37d67ba6b888eb6e7d9606b58ddf45e3882357acbf9b718ba09` | yes |
| `mission-service` | `d30730dd6dfc2cf52c50e3b1c748eba9f250be999ccdee6301a99bbde79ef657` | yes |

The pilot covers synchronous boolean checks, asynchronous throwing checks,
plain Node, filtered `tsx`, renderer tsconfig injection, and shared repo-root use.

## Failure and success evidence

- Deliberate failure: temporarily replaced the first validate harness command
  (`conversation-deletion`) with `node -e "process.exit(23)"`; `pnpm validate`
  returned exit 1, stopped at that first harness, and reported the exact failed
  id. The temporary injection was then reverted and is absent from the diff.
- Direct async runner failure oracle threw `A1_FAILURE_ORACLE` inside
  `checkAsync`; the runner printed `1/1 checks failed` and returned exit 1.
  This validates the new fixed async failure format and exit semantics; it is
  not presented as a byte oracle for the two legacy stack-printing wrappers.
- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 gates green.
- Manifest-backed `pnpm validate`: PASS, 73/73 harness roots green.
- `node scripts/run-harnesses.mjs --only codex-runtime-conformance`: PASS,
  Cargo command preserved; 46 Codex host tests passed, 410 filtered out.
- `node scripts/check-cross-package-src-imports.mjs`: PASS, 85 grandfathered,
  zero new private-source imports.
- GitNexus pre-impact: all ten migrated local `check` symbols LOW, one direct
  in-file dependent each, zero affected execution flows; manifest/cross-package
  tooling also LOW.
- GitNexus `detect_changes(scope: all, worktree: ...)`: LOW, 28 indexed tooling
  symbols touched, zero affected production execution flows. New untracked
  manifest/runner files are outside the pre-change index and were audited by the
  explicit 100-id contract oracle above.
- Fresh diff review (`reuse`, `quality`, `efficiency`): three lanes complete;
  zero blocking, zero important, zero actionable nit findings. Review confirmed
  the duplicate summary is the required byte-oracle trade-off, raw legacy
  command strings are deliberate execution truth, and serial fail-fast remains
  the original validate behavior.
- `git diff --check`: PASS.

No release `.app` live proof is required for this tooling-only A1 PR under §0.3;
no desktop renderer or runtime source changed.
