# onboarding-tour-system Specification

## Purpose
TBD - created by archiving change add-workspace-narrow-tier-and-states. Update Purpose after archive.
## Requirements
### Requirement: `OnboardingTour` SHALL be the SSOT for first-run guidance

`packages/ui-office/src/components/onboarding/OnboardingTour.tsx` SHALL
be the only component that renders first-run guidance hints, the
highlight ring, and the progress indicator. The legacy
`apps/desktop/renderer/src/components/OnboardingController.tsx` SHALL be deleted (or
reduced to a thin shim that mounts `OnboardingTour`); no other
component SHALL render onboarding hints.

The `OnboardingTour` component SHALL accept the active workspace key,
the active company id, and the per-account onboarding state as props
(or read them from existing contexts). It SHALL NOT directly call
`document.querySelector` to locate target elements — target locations
SHALL be supplied via the `useTourTarget(slot)` ref-registration
contract.

The component SHALL render the highlight ring around the registered
target's bounding rect AND a hint card with title, body, progress
indicator, and Back / Next / Skip controls.

#### Scenario: Legacy OnboardingController is removed
- **WHEN** grepping `apps/desktop/renderer/src/components/OnboardingController.tsx`
- **THEN** the file SHALL either not exist or contain only a thin shim
  that imports and renders `<OnboardingTour />`
- **AND** grepping `apps/desktop/renderer/src` for `data-onboarding-target=` SHALL
  return zero matches

#### Scenario: OnboardingTour renders only when active step exists
- **WHEN** the user has dismissed the tour (`tour_dismissed === true`)
  OR has completed all steps
- **THEN** `OnboardingTour` SHALL render `null`
- **AND** SHALL NOT render any highlight ring or hint card

#### Scenario: OnboardingTour reads target via ref registration
- **WHEN** the active step targets slot `'office:chat-input'`
- **THEN** `OnboardingTour` SHALL read the registered ref from the tour
  context's slot map
- **AND** SHALL NOT call `document.querySelector` for the target

### Requirement: `TourStep` SHALL be a typed const list with stable ids

The tour content SHALL be defined as a sealed `readonly TourStep[]`
const exported from
`packages/ui-office/src/components/onboarding/tour-steps.ts`:

```ts
export type TourSlot =
  | 'settings:provider-cta'
  | 'office:project-selector'
  | 'office:chat-input'
  | 'office:tasks-tab'
  | 'personnel:nav-button'
  | 'market:nav-button';

export interface TourStep {
  readonly id: string;
  readonly workspace: WorkspaceKey;
  readonly slot: TourSlot;
  readonly title: string;
  readonly body: string;
  readonly primaryActionLabel?: string;  // overrides default 'Next'
  readonly secondaryActionLabel?: string; // overrides default 'Skip'
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'connect-provider',
    workspace: 'settings',
    slot: 'settings:provider-cta',
    title: 'Connect your AI provider',
    body: 'Open Settings and add an API key so the team can start working. We default to MiniMax — you can swap providers later.',
  },
  {
    id: 'pick-project',
    workspace: 'office',
    slot: 'office:project-selector',
    title: 'Pick or create a project',
    body: 'Projects scope conversations and bind a workspace folder. Pick one or create a new one to focus the team.',
  },
  {
    id: 'send-first-message',
    workspace: 'office',
    slot: 'office:chat-input',
    title: 'Send your first message',
    body: 'Describe the outcome you want. Team chat is the fastest way to kick work off — the boss will route it.',
  },
  {
    id: 'open-tasks',
    workspace: 'office',
    slot: 'office:tasks-tab',
    title: 'Open Tasks to watch progress',
    body: 'Tasks shows live activity, plan progress, and finished deliverables as the team works.',
  },
  {
    id: 'browse-personnel',
    workspace: 'personnel',
    slot: 'personnel:nav-button',
    title: 'Browse Personnel',
    body: 'Personnel is the roster: configure skills, runtime engines, and memory for each employee.',
  },
  {
    id: 'try-marketplace',
    workspace: 'market',
    slot: 'market:nav-button',
    title: 'Try the Marketplace',
    body: 'Market has shareable employees, skills, and templates. Install one to extend your team.',
  },
];
```

The active step is computed as
`TOUR_STEPS.find(s => !completed.has(s.id))` with `tour_dismissed`
short-circuiting to `null`. When all steps are completed, the tour
state SHALL set `tour_dismissed = true` automatically.

#### Scenario: Active step is first incomplete step
- **WHEN** `completed = new Set(['connect-provider'])` and
  `tour_dismissed === false`
- **THEN** the active step SHALL be the step with id `'pick-project'`

#### Scenario: All steps completed dismisses tour
- **WHEN** all `TOUR_STEPS` ids are in `completed`
- **THEN** the tour state SHALL transition to `tour_dismissed === true`
- **AND** `OnboardingTour` SHALL render `null`

#### Scenario: Tour step list is append-only
- **WHEN** a future change adds a new tour step
- **THEN** the new step SHALL be appended to `TOUR_STEPS`, NOT inserted
  in the middle
- **AND** existing user state with completed step ids SHALL remain
  forward-compatible

### Requirement: `useTourTarget(slot)` SHALL register DOM refs without selectors

`packages/ui-office/src/components/onboarding/useTourTarget.ts` SHALL
export:

```ts
export function useTourTarget(slot: TourSlot): (el: HTMLElement | null) => void;
```

The returned ref callback SHALL register the DOM element with the
tour context's slot map under the given slot identifier. When the
component unmounts, the ref callback SHALL receive `null` and remove
the slot registration.

The tour context SHALL be exposed via
`packages/ui-office/src/components/onboarding/tour-context.tsx` and
mounted at App.tsx root. It maintains a Map<TourSlot, HTMLElement | null>
and notifies subscribers (e.g. `OnboardingTour`) when the map mutates.

Workspaces SHALL register exactly one element per slot. If two
components register against the same slot simultaneously (e.g.
narrow-tier hamburger overlay AND inline header both have a peer-
nav-button instance), the most recently mounted element wins — this
SHALL be deterministic (insertion order).

#### Scenario: useTourTarget returns stable callback per slot
- **WHEN** `useTourTarget('office:chat-input')` is called twice in the
  same component render
- **THEN** the two returned callbacks SHALL be reference-equal (the
  hook memoizes per slot identifier)

#### Scenario: Slot registration cleared on unmount
- **WHEN** a component using `useTourTarget(slot)` unmounts
- **THEN** the slot map SHALL no longer contain that slot's element
  (or contain a more recently registered element from another mount)

#### Scenario: Tour skips step when slot unregistered
- **WHEN** the active step targets slot `'office:chat-input'` but no
  element is registered for that slot (e.g. office workspace not
  mounted)
- **THEN** `OnboardingTour` SHALL render the hint card centered with
  text indicating the user needs to switch to the relevant workspace
- **AND** SHALL NOT crash or render a null-rect ring

### Requirement: Tour SHALL provide Back / Next / Skip controls and progress indicator

The tour hint card SHALL render:

- A progress indicator `Step N of M` where `N` is 1-based index of the
  active step in `TOUR_STEPS` and `M` is `TOUR_STEPS.length`.
- A `Back` button (disabled when `N === 1`) that moves to the previous
  step (mark current step incomplete, set previous step as active).
- A `Next` button that marks the current step complete and advances.
  Label defaults to "Next" but the last step's button label SHALL be
  "Done" instead.
- A `Skip` button that sets `tour_dismissed = true`.

Back navigation SHALL be implemented by removing the previous step's
id from the `completed` set so `find(!completed.has(...))` resolves to
it. This means a user can navigate freely backward and forward; the
"completed" set is the navigation cursor, not a strict history.

#### Scenario: Progress indicator shows current and total steps
- **WHEN** the active step is the third step (`open-tasks`) of 6
- **THEN** the hint card SHALL render text containing `Step 3 of 6`

#### Scenario: Back disabled on first step
- **WHEN** the active step is the first step (`connect-provider`)
- **THEN** the `Back` button SHALL be disabled (or hidden)

#### Scenario: Next on last step says Done and dismisses tour
- **WHEN** the active step is the last step (`try-marketplace`) and the
  user clicks the primary action
- **THEN** the button label SHALL be "Done"
- **AND** clicking it SHALL mark the step complete AND
  `tour_dismissed` SHALL transition to `true`

#### Scenario: Skip dismisses tour entirely
- **WHEN** the user clicks `Skip` on any step
- **THEN** `tour_dismissed` SHALL transition to `true`
- **AND** `OnboardingTour` SHALL stop rendering

#### Scenario: Back navigation re-opens previous step
- **WHEN** the user has completed `connect-provider` and `pick-project`
  (active step is `send-first-message`) and clicks `Back`
- **THEN** `pick-project` SHALL be removed from `completed`
- **AND** the active step SHALL transition to `pick-project`

### Requirement: Tour SHALL auto-switch workspace when step targets a different workspace

`OnboardingTour` SHALL trigger a workspace switch via the existing
`setActiveWorkspace` (or equivalent) callback when the user clicks
`Next` and the next step targets a different `workspace` than the
current active workspace.

The tour SHALL NOT switch workspace silently in the background — the
user always initiates step transitions via Next/Back/Skip clicks. The
auto-switch happens AFTER the click so the workspace transition is
visible to the user.

#### Scenario: Next from settings step switches to office
- **WHEN** the active step is `connect-provider` (workspace
  `'settings'`) and the user clicks `Next`
- **THEN** the step SHALL be marked complete
- **AND** the active workspace SHALL transition to `'office'`
- **AND** the next active step (`pick-project`) SHALL render once the
  office workspace mounts and registers its slot

#### Scenario: Back across workspaces switches workspace
- **WHEN** the active step is `browse-personnel` (workspace
  `'personnel'`) and the user clicks `Back`
- **THEN** the previous step (`open-tasks`, workspace `'office'`)
  SHALL become active
- **AND** the active workspace SHALL transition to `'office'`

### Requirement: First-run welcome screen SHALL precede the tour

The first-run welcome screen SHALL render as a full-viewport modal
(using the existing `Dialog` primitive at `xl` size) when ALL of the
following hold. The component lives at
`packages/ui-office/src/components/onboarding/FirstRunWelcomeScreen.tsx`.
Render conditions:

- `account.welcome_seen === false`
- `account.provider_configured === false`
- `companies.length === 0` (no companies exist yet)
- `tour_dismissed === false`

The screen SHALL contain:

- Product name and a one-line tagline ("Your AI office")
- A 2–3 sentence intro explaining: pick a project → describe what you
  want → watch the team execute
- A primary CTA `Get started` that sets `welcome_seen = true` and lets
  the tour proceed to step 1
- A secondary CTA `Skip and explore` that sets `welcome_seen = true`
  AND `tour_dismissed = true`
- An optional "View docs" link (omitted in first iteration)

The screen SHALL NOT show provider configuration UI inline — it routes
the user to the existing Settings flow via the tour's first step.

#### Scenario: Welcome screen renders for first-run user
- **WHEN** a user opens the app for the first time (all four
  conditions hold)
- **THEN** the welcome screen SHALL render as a centered modal
- **AND** the rest of the app SHALL be visually dimmed beneath the modal

#### Scenario: Welcome screen does not re-render after seen
- **WHEN** the user has clicked `Get started` once
- **THEN** `account.welcome_seen` SHALL be `true`
- **AND** subsequent app loads SHALL NOT re-render the welcome screen
  even if `provider_configured` is still false (the tour handles
  ongoing guidance)

#### Scenario: Skip and explore dismisses both welcome and tour
- **WHEN** the user clicks `Skip and explore`
- **THEN** `account.welcome_seen` SHALL be `true`
- **AND** `tour_dismissed` SHALL be `true`
- **AND** neither the welcome screen nor the tour SHALL render in
  subsequent app loads

#### Scenario: Welcome screen suppressed when companies exist
- **WHEN** `account.welcome_seen === false` but `companies.length > 0`
- **THEN** the welcome screen SHALL NOT render (the user is past the
  fresh-install state, e.g. mid-flow refresh)

### Requirement: Tour state SHALL migrate from legacy onboarding slots

`apps/desktop/renderer/src/lib/onboarding-store.ts` SHALL contain a one-shot
migration that runs at module init:

- If `account.provider_configured === true`, mark
  `connect-provider` as completed.
- If for any company, `company.first_task_sent === true`, mark
  `send-first-message` as completed in account-level state.
- If for any company, `company.first_deliverable_seen === true`, mark
  `open-tasks` as completed in account-level state.

The legacy `account.provider_configured` slot and the company-level
`first_task_sent` / `first_deliverable_seen` slots SHALL remain in the
store schema for the migration to read; subsequent reads SHALL go
through the new `tour_step_completed` set.

After migration the legacy slots become read-only history (kept for
diagnostic purposes) and SHALL NOT be written to by new code.

#### Scenario: Migration completes provider step from legacy slot
- **WHEN** a user has `account.provider_configured === true` from a
  previous app version and the new tour state is empty
- **THEN** after store init, `tour_step_completed` SHALL contain
  `'connect-provider'`
- **AND** the active tour step SHALL be `pick-project` (or null if all
  three legacy slots map onto completion)

#### Scenario: Migration is idempotent
- **WHEN** the store init runs twice (e.g. dev hot reload)
- **THEN** the resulting `tour_step_completed` set SHALL be identical
  to the single-run result (no duplicate entries, no overwrites)

### Requirement: Tour SHALL persist state across app reloads

The tour state SHALL persist via the existing `onboarding-store.ts`
state mechanism, written through to `localStorage` under the existing
onboarding key prefix. The persisted slots SHALL include
`tour_step_completed: Set<string>` and `tour_dismissed: boolean`.

`account.welcome_seen: boolean` SHALL persist alongside the existing
account-level slots.

State updates SHALL fire synchronously when the user clicks a control
so reload reflects the latest state.

#### Scenario: Tour completion persists across reload
- **WHEN** the user completes step 1, then reloads the app
- **THEN** the active step SHALL still be step 2 (the post-step-1 cursor)
- **AND** `localStorage` SHALL contain the completed set

#### Scenario: Tour dismissal persists across reload
- **WHEN** the user clicks `Skip` and reloads
- **THEN** `OnboardingTour` SHALL render `null`
- **AND** the welcome screen SHALL NOT render

### Requirement: Tour hint card SHALL position relative to the registered target

The tour hint card SHALL position itself relative to the active step's
registered target element using the same logic as the existing
`computeHintPosition()` (place above when target is in lower half,
below when target is in upper half, clamp to viewport edges with
8px padding).

The highlight ring SHALL render at the target's bounding rect with 4px
inset padding.

When the target's rect is unavailable (slot unregistered) the hint
SHALL render centered in the viewport with no ring.

#### Scenario: Hint placed above when target is in lower viewport half
- **WHEN** the active step's target rect has `top > viewportHeight / 2`
- **THEN** the hint card SHALL render above the target
  (`bottom = viewportHeight - rect.top + gap`)

#### Scenario: Hint placed below when target is in upper viewport half
- **WHEN** the active step's target rect has `top <= viewportHeight / 2`
- **THEN** the hint card SHALL render below the target
  (`top = rect.top + rect.height + gap`)

#### Scenario: Hint centered when slot unregistered
- **WHEN** the active step's slot is not registered in the tour
  context's slot map
- **THEN** the hint card SHALL render centered in the viewport
- **AND** no highlight ring SHALL render
- **AND** the body text SHALL include guidance to switch to the
  relevant workspace

### Requirement: Tour SHALL NOT fire when overlays are open

The tour SHALL suppress its hint and ring rendering whenever any
overlay is open (`employee-creator`, `office-editor`, `company-select`,
`studio`) OR a modal dialog is open. This prevents the highlight ring
from competing with overlay focus or rendering atop a backdrop that
hides the target.

When overlays close, the tour SHALL resume rendering at the same active
step (no auto-advance).

#### Scenario: Tour suppressed during overlay
- **WHEN** an overlay is open (`anyOverlayOpen === true`)
- **THEN** `OnboardingTour` SHALL render `null` for the duration of
  the overlay
- **AND** the active step SHALL not change

#### Scenario: Tour resumes after overlay closes
- **WHEN** an overlay closes and the active step's slot is registered
- **THEN** the hint card and ring SHALL render again at the same step

