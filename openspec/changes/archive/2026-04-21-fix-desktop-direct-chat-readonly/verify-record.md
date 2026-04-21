# Verify Record

## Build

- `pnpm --filter @offisim/shared-types build`
- `pnpm --filter @offisim/core build`
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/web build`
- `pnpm --filter @offisim/desktop build`

All completed successfully after the final patch set.

## Code changes verified

- Patched `@langchain/langgraph@1.2.1` via pnpm patch so `pregel/retry` no longer hard-fails when attaching `pregelTaskId` to a readonly / non-extensible caught error.
- Normalized newly-created `task_runs.status` values from invalid `pending` / `planned` to valid `queued` in direct chat, planner persistence, and planner replan paths.
- Kept the temporary richer error formatting in the desktop UI so release-bundle failures expose actionable stack details instead of a flattened message.

## Live evidence

### Direct chat

- Release bundle reopened after rebuild.
- Selected `Maya Lin` direct chat and sent `hi`.
- Result after fixes:
  - message was accepted
  - employee state changed to `executing`
  - a direct-chat task run was created and surfaced in the inspector (`tr-dc-...`)
  - UI showed `Employee / Working` instead of the old immediate readonly crash
- Final outcome in the current environment: provider returned `LLM_CALL_FAILED: Connection error`, so no natural-language employee reply was produced.

### Team chat regression check

- Release bundle team chat sent `Hi`.
- Boss path entered `ANALYZING` / `Drafting`, proving execution still reaches LLM call setup.
- Final outcome in the current environment: `LlmError: Connection error`.

## Conclusion

- The original `Attempted to assign to readonly property.` desktop direct-chat blocker is fixed.
- The remaining runtime failure is a provider / transport connection error that reproduces in both direct chat and team chat, so it is not the same desktop direct-chat readonly bug.
