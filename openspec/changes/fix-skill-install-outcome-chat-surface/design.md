## Context

Outcome shape lived at `packages/core/src/services/interaction-service.ts:50-56`:
```ts
export type SkillInstallConfirmOutcome =
  | { kind: 'installed'; skillId: string; wasExisting: boolean }
  | { kind: 'created'; skillId: string; wasExisting: boolean }
  | { kind: 'edited'; skillId: string }
  | { kind: 'cancelled' }
  | { kind: 'staging-expired' }
  | { kind: 'error'; errorKind: string; message: string };
```

Two surfaces show outcome copy and they were inconsistent:

1. **Chat assistant message** — `apps/web/src/runtime/interaction-follow-up.ts` returns a string that becomes a chat bubble. Already kind-aware with action-specific cancellation copy ("Skill creation cancelled." vs "Skill install cancelled."), missing slug, slightly different per-kind wording than the rest.
2. **Activity rail** — `packages/ui-office/src/runtime/runtime-activity-formatters.ts:147` (a small "what's happening" widget at the top of `ChatPanel`, fed by event mappers consuming `interaction.resolved`) collapsed everything into `selectedOptionId === 'confirm' ? 'Skill install confirmed' : 'Skill install cancelled'` — 6 outcome kinds → 2 strings, slug never shown.

`InteractionResolveResult.skillInstallOutcome` carries the typed outcome on the resolver side, so the data is already there — the gap is in surface plumbing.

## Goals / Non-Goals

**Goals**:
- Single SSOT for outcome copy — both surfaces return identical strings for the same outcome.
- Surface every outcome kind with copy that's distinguishable in chat AND activity rail.
- Slug shown on success variants without an async DB roundtrip at render time.

**Non-Goals**:
- Retry CTA wiring on `staging-expired` / `error` (deferred — text-only this change).
- Reworking interaction-service resolver internals.
- Live-verifying every outcome kind — `error` requires fault injection, `staging-expired` requires TTL waiting; both are code-covered via shared SSOT.

## Decisions

### Decision 1 — Move outcome shape + label SSOT into shared-types

`SkillInstallOutcomeKind` lives in `packages/shared-types/src/events/install.ts`. Core re-aliases it as `SkillInstallConfirmOutcome` to keep the existing public name. `skillInstallOutcomeLabel(outcome): string` lives next to it (pure function over the discriminated union, zero runtime deps).

Both `apps/web/src/runtime/interaction-follow-up.ts` (chat assistant message) and `packages/ui-office/src/runtime/activity-feed/mappers/interaction-mappers.ts` (activity rail) import the function. One change to copy ⇒ both surfaces update.

### Decision 2 — Per-kind copy table

| outcome.kind | copy |
|---|---|
| `installed` | `Skill {skillSlug} installed.` |
| `created` | `Skill {skillSlug} created from scratch.` |
| `edited` | `Skill body updated.` |
| `cancelled` | `Skill action cancelled.` (single copy regardless of action — simpler, satisfies "same story across surfaces") |
| `staging-expired` | `Skill staging timed out — try again.` |
| `error` | `Skill action failed: {errorKind}: {message}` (truncate `message` at 120 UTF-16 chars) |

### Decision 3 — Slug bundled with outcome at commit time, not looked up at render

`SkillInstallCommitter` populates `skillSlug: row.slug` on `installed` / `created` / `edited` outcomes (it has the row inline; no extra query). The outcome carries it forward through `interaction-service.resolve()` → `respondToInteraction()` → `getInteractionFollowUp()` and through the new `skill.install.outcome` event payload to the activity rail mapper.

This drops the original async lookup-with-budget plan (no race, no clearTimeout, no repo plumbing into mappers) and avoids DB roundtrip + re-render churn.

### Decision 4 — New event `skill.install.outcome`, not extending `interaction.resolved`

Adding a narrow event keeps the existing `interaction.resolved` contract stable for other subscribers and keeps the activity-rail mapper from having to disambiguate by interaction kind. Type constant: `SKILL_INSTALL_OUTCOME = 'skill.install.outcome' as const` (mirrors `TASK_ASSIGNMENT_REROUTED` pattern). Activity rail mapper SHALL skip `skill_install_confirm` in its `interaction.resolved` handler to avoid double-logging.

The chat assistant message does NOT subscribe to this event — it consumes the outcome directly from `InteractionResolveResult.skillInstallOutcome` returned by `respondToInteraction()`. The event exists purely so the activity rail (which is event-driven) can branch on outcome kind.

## Risks / Trade-offs

- **Risk**: `wasExisting` semantics for "installed" outcome — for now we don't surface it in copy. If it matters later, extend the table (e.g., "Skill already installed."). Out of scope.
- **Trade-off**: Action-specific cancellation copy ("Skill creation cancelled." vs "Skill install cancelled.") is replaced by a single "Skill action cancelled." string. Reduces information slightly; the user just confirmed/cancelled a specific bubble so context is fresh. Net win for cross-surface consistency.
- **Risk**: outcome shape change adds required `skillSlug` field. Any code paths constructing outcome literals (other than the committer) must be updated. `interaction-service.ts.applySkillInstallConfirm` error-wrapping still uses `{ kind: 'error', ... }` (no skillSlug needed) and `{ kind: 'cancelled' }` synthesis in `interaction-follow-up.ts` is fine. Verified: no other construction sites.
