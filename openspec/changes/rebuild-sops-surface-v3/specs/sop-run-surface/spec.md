## MODIFIED Requirements

### Requirement: Run progress strip surfaces the in-flight run

The SOP workspace SHALL render a run-progress strip between `SopLibraryBar` and `SopDagCanvas` whenever a plan whose `sopTemplateId` matches the currently selected SOP is in flight or has finished within the last 3 seconds. The strip SHALL surface: a running indicator (pulse dot), the current step's label, a `step N of M` counter, and a `<completed>/<total>` task tally. It MUST NOT be a toast or modal — it lives in the same column as the canvas and persists across pan / zoom / selection.

The strip SHALL render using status-tinted surfaces driven by semantic tokens (no hard-coded hex), migrating off the legacy `--info` / `--success` / `--error` families to the V3 status families: run → `--accent-surface` background with `--accent-ring` border and `--accent` text (V3 DNA §2/§3 aliases `--info` to `--accent`, so there is no separate info token); done → `--ok-surface` background with an ok-tone border and ok-tone text; fail → `--danger-surface` background with a danger-tone border and danger-tone text. The pulse dot follows the same family per state (`--accent` while running, `--ok` on success, `--danger` on failure). This is a token-family migration of the existing strip, not a no-op — the source today uses `border-info bg-info-muted text-info` / `bg-success`, which MUST become the `--accent` / `--ok` / `--danger` families above.

#### Scenario: Run starts and strip mounts
- **WHEN** the user clicks Run on a SOP and the dispatched plan emits `plan.created` with a matching `sopTemplateId`
- **THEN** the strip mounts above the canvas with the running indicator pulsing, current step label = the first step's label (or empty until `plan.step.started` arrives), counter `step 1 of N`, task tally `0/<total>`
- **AND** the strip renders on the `--accent-surface` status tint with `--accent-ring` border and `--accent` text (no hard hex)

#### Scenario: Strip updates as steps progress
- **WHEN** `plan.step.started` fires for step index 2 of 5
- **THEN** the strip updates to `step 3 of 5` (1-indexed display) with the step's label

#### Scenario: Run completes, strip enters "just finished" mode
- **WHEN** `plan.completed` fires
- **THEN** the strip stops pulsing, the running indicator becomes a static check or cross (depending on whether any step ended `'failed'`), and the strip remains visible for 3 seconds before unmounting
- **AND** the strip uses the `--ok-surface` (success) or `--danger-surface` (failure) status tint with its matching semantic-token border and text

#### Scenario: Strip auto-clears after run completion
- **WHEN** 3 seconds have elapsed since `plan.completed` (or `useSopRuntimeState` returned `null`)
- **THEN** the strip unmounts and the canvas reclaims the vertical space

#### Scenario: Strip is scoped to the selected SOP
- **WHEN** a plan is in flight whose `sopTemplateId` does not match `selectedSop.sopTemplateId`
- **THEN** the strip does NOT mount on the current SOP view (the run is visible in chat / Tasks / Activity, but the SOP surface is silent)
