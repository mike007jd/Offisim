## MODIFIED Requirements

### Requirement: Kanban transitions are atomic compare-and-update operations

Kanban state transitions SHALL be enforced with an atomic compare-and-update against the card's current state. A caller that read an old state SHALL NOT be able to overwrite a newer state with a stale transition.

The TypeScript repository storage contract and the Rust desktop command SHALL both update a card with a predicate on `id` and the expected current state. A zero-row update SHALL be reported as a stale or invalid transition, not as success.

#### Scenario: Stale concurrent transition is rejected
- **WHEN** two concurrent transition attempts start from the same observed `todo` card
- **THEN** exactly one transition succeeds
- **AND** the other returns a stale-transition error instead of silently applying last-write-wins

### Requirement: Kanban transition table has one source of truth

Allowed kanban transitions SHALL be defined in `packages/shared-types/src/kanban-state-machine.json`. TypeScript SHALL import this JSON directly, and Rust SHALL use constants generated from this JSON at build time.

The deterministic harness contract SHALL fail if the TypeScript or Rust transition table drifts from the JSON source.

#### Scenario: Transition tables match shared JSON
- **WHEN** the harness contract loads
- **THEN** the TypeScript transition table and Rust generated table match `kanban-state-machine.json` exactly

### Requirement: Kanban UI exposes only allowed next transitions

Kanban UI controls SHALL be derived from the shared transition table. A card SHALL only render actions for states that are allowed from its current state. Terminal `done` cards SHALL render a terminal-state affordance and SHALL NOT render controls that could ask for `todo`, `doing`, `blocked`, or `review`.

The backend rejection remains the final guard, but the release UI SHALL NOT present known-invalid state actions as normal user choices.

#### Scenario: Done card renders no invalid actions
- **WHEN** a card has state `done`
- **THEN** the board renders the card as terminal
- **AND** it does not render transition buttons to any other state.
