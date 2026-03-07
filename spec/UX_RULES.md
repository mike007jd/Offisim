# UX Rules

## UX philosophy

AICS should feel fast, calm, legible, and trustworthy.

The user is running a company, not playing a game.
The UI should help them understand work distribution, status, and outputs with minimal friction.

There are three primary UX surfaces:

- **Office runtime** — spatial, status-rich, operational
- **Editors / dashboards** — structured, precise, controllable
- **Marketplace website** — discoverable, readable, trust-oriented

## Primary UX priorities

1. Make multi-agent work understandable.
2. Make asset install/import flows trustworthy.
3. Make local-vs-platform boundaries obvious.
4. Preserve calm under high activity.

## Layout rhythm

For DOM surfaces, use a stable page rhythm.

Recommended page padding:

- mobile: 16
- tablet: 24
- desktop: 32

Recommended content widths:

- standard surface: 1200 to 1280
- reading-heavy surface: 720 to 800

Recommended spacing:

- major section gap: 48 to 64
- card/grid gap: 16 to 24
- compact control gap: 8 to 12

Rules:

- do not create cramped operational panels
- do not create giant empty gaps with no hierarchy purpose
- keep marketplace pages readable before decorative

## Office runtime UX rules

The office scene must explain work through space.

Key behaviors:

- the user should quickly see who is working, blocked, queued, in a meeting, or reporting
- dragging or assigning people/items should feel direct and predictable
- inspecting an employee or workstation should reveal context without losing scene orientation
- bubbles, badges, and side panels should complement each other rather than compete

Rules:

- critical runtime actions must not be hidden behind novelty interactions
- scene interactions must have predictable selection and cancel behavior
- important status changes should be visible without requiring log-diving
- use the scene for comprehension, not for decoration

## Install/import UX rules

Install flows must feel explicit and safe.

Before final confirmation, the review surface should clearly show:

- source / publisher
- asset type and risk class
- version and compatibility range
- what will be installed
- declared capabilities / required bindings
- recommended model profile, when applicable
- whether the asset is installable in the current environment

Rules:

- install confirmation is separate from secret binding
- do not hide risk or compatibility details in collapsed advanced panels by default
- failed installs must preserve a useful error explanation
- rollback should be visible and trustworthy, not silent magic

## Marketplace UX rules

Marketplace pages are trust and discovery surfaces.

Rules:

- listing pages must make creator identity and provenance easy to find
- package versioning must be understandable
- public pages should optimize for scanability and SEO readability
- public read flows should not feel gated behind account walls
- authenticated actions should be obvious when they require login

## Responsive behavior

Treat the product surfaces differently:

- **Marketplace and account surfaces** should work at mobile (~390), tablet (~768), and desktop (~1280).
- **Runtime/editor surfaces** should work well on laptop/desktop first, because desktop is the 1.0 reference environment.

Rules:

- do not pretend the full office runtime is equally strong on phone-sized layouts unless it truly is
- do not hide critical actions on tablet/desktop
- avoid overflow and broken wrapping in cards, tables, and inspector panels

## Interaction states

Interactive elements should have clear states.

At minimum, design for:

- default
- hover
- active / pressed
- focus-visible
- disabled
- loading
- error
- success when relevant
- pending binding / pending approval when relevant

Rules:

- focus state must be visible
- disabled state must still explain why the action is unavailable when appropriate
- loading state must preserve layout stability
- runtime queueing / paused / resumed states should not be ambiguous

## Motion rules

Motion should improve comprehension only.

Use the motion system that matches the surface:

- office/runtime motion: PixiJS + GSAP where needed
- DOM surfaces: subtle CSS/native transitions by default

Recommended durations:

- micro feedback: 120ms
- hover / tap feedback: 150ms to 180ms
- popover / dropdown: 180ms to 220ms
- modal: 220ms to 280ms
- larger section transition: 250ms to 320ms

Rules:

- respect reduced motion
- avoid floaty or decorative animation
- avoid running multiple unrelated motion systems on the same surface
- motion should clarify state, responsiveness, or spatial continuity

## Forms and editors

Rules:

- every field needs a visible label
- helper text should explain intent, not repeat the label
- errors should say what to fix
- preserve user input on validation errors where possible
- editor defaults should be usable without “mystery settings”

## Feedback rules

Always design non-happy paths.

Important states:

- loading
- empty
- partial data
- error
- success / confirmation
- validation failure
- binding required
- incompatible environment

Rules:

- do not ship blank states for loading or empty content
- use skeletons for content regions where appropriate
- prefer inline status for primary actions
- use toasts sparingly; they must not be the only source of truth for critical operations

## Accessibility rules

Minimum expectations for DOM surfaces:

- keyboard navigable interactions
- visible focus states
- sufficient contrast
- semantic HTML where possible
- reduced motion support
- tap targets that are not too small

Additional rule for the office scene:

- critical scene actions need an equivalent control path outside pure canvas gestures when practical

## Delight guardrail

Do not add motion or stylistic flourish unless it improves at least one of:

- state clarity
- perceived responsiveness
- spatial continuity
- trust during risky actions such as install/import/publish
## Runtime experience reference

If work touches office-scene choreography, employee state feedback, task presentation,
or install/import review flows inside the runtime shell, read `/Docs/04_runtime_experience/AICS_RUNTIME_EXPERIENCE_GDD.md`.

That file is the source of truth for the richer game-feel layer of the product.
It does not add gameplay systems; it defines presentation systems.

For explicit runtime-state rendering and concrete animation work items, also use:

- `/Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
- `/Docs/04_runtime_experience/ANIMATION_BACKLOG.md`
