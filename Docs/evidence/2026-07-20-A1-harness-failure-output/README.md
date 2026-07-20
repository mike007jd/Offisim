# A1 harness failure-output correction

Checked at: 2026-07-20 16:32:01 NZST (+1200)

## Finding

PR #94 changed `checkAsync` failures from the legacy one-line format
`  ✗ name — message` to an indented multi-line stack trace. That contradicted
the A1 contract that migrated harness output remain byte-compatible.

## Correction

The shared runner again emits the original one-line error message. Success
output, counters, reporting, exit codes, and all harness assertions are unchanged.

## Verification

- Direct failing async assertion oracle: exact output passed.
- Representative async harness (`eval-suite`): passed.
- Biome check for the runner: passed.
- Node release gates: 4/4 green, including 73/73 harnesses and the production dependency audit.
- GitNexus pre-edit impact: low risk, no production execution flow affected.
