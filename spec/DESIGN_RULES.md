# Design Rules

## Design philosophy

Offisim should feel like a polished productivity product with spatial intelligence.

It is **not** a game UI, and it is **not** a generic SaaS dashboard.

The office runtime, editor surfaces, and marketplace pages should feel related, but not identical:

- **Office runtime**: calm, spatial, operational, status-rich
- **Editors / dashboards**: precise, controllable, information-dense
- **Marketplace**: clean, readable, HTML-first, trust-oriented

## Product visual guardrails

Default visual tone:

- clean
- calm
- grounded
- operational
- trustworthy

Avoid defaulting to:

- gamified UI language
- “cyberpunk AI” neon aesthetics
- noisy glassmorphism
- over-decorated gradients
- playful toy-like office visuals
- high-saturation status overload

The office is a semantic metaphor, not a game layer.
Do not add XP bars, rarity frames, loot-like badges, level-up visuals, or other game conventions.

## Token-first rule

All visual decisions should come from shared tokens or documented scene constants, not one-off local tweaks.

Use semantic tokens for:

- color
- typography
- spacing
- radius
- shadow
- border
- motion
- status

For the office scene, use centralized scene token maps rather than ad hoc drawing values sprinkled across feature code.

## Color system

Use semantic roles, not ad hoc component colors.

Core DOM roles:

- `primary`
- `secondary`
- `background`
- `surface`
- `surface-elevated`
- `border`
- `muted`
- `accent`
- `success`
- `warning`
- `destructive`
- `info`

Runtime status roles should be defined separately from brand color roles.

Recommended runtime status tokens:

- `employee.idle`
- `employee.working`
- `employee.searching`
- `employee.meeting`
- `employee.queued`
- `employee.reporting`
- `employee.error`

Rules:

- do not hardcode hex colors inside feature components
- do not invent per-page palettes
- status colors must remain readable and low-noise when many employees are visible at once
- a status color should never be the only signal; pair it with iconography, label, or motion

## Office scene visual rules

The office scene should communicate workflow through space.

Priorities:

- department zoning should be legible
- furniture and partitions should support orientation
- employee presence and state should be quickly scannable
- important activity should be visible without turning the scene into a noisy RTS map

Rules:

- favor simple, reusable furniture and avatar shapes
- keep floor / wall / desk contrast controlled
- use overlays and badges sparingly
- make bubbles readable at typical working zoom levels
- use motion to clarify activity, not to entertain

## Marketplace visual rules

The marketplace is a trust surface first.

Priorities:

- asset title, creator, risk class, compatibility, and installability should be easy to scan
- package / listing / version structure should be legible
- documentation-like readability matters more than visual novelty
- SEO pages should remain HTML-first and text-readable

Rules:

- keep cards sober and comparable
- avoid making every listing look like marketing hero art
- creator identity and provenance should be visually clear
- review/install metadata should not be buried under decoration

## Typography scale

Use a small, stable typography system.

Recommended scale:

- `h1`
- `h2`
- `h3`
- `h4`
- `body`
- `body-sm`
- `caption`
- `mono-sm` for hashes, IDs, or compatibility snippets when needed

Rules:

- hierarchy must come from scale, spacing, and weight together
- body text should optimize readability first
- avoid dense tiny text for operational metadata
- do not rely on color alone to create hierarchy

## Spacing scale

Use a stable spacing system.

Recommended scale:

- 4
- 8
- 12
- 16
- 20
- 24
- 32
- 40
- 48
- 64
- 80

Rules:

- similar surfaces should use similar spacing density
- marketplace cards and office side panels should not feel like different products
- page rhythm matters more than hyper-local micro-adjustments

## Radius and shadow

Keep a compact radius and elevation system.

Recommended radius tokens:

- `sm`
- `md`
- `lg`
- `xl`

Recommended shadow tokens:

- `card`
- `popover`
- `modal`

Rules:

- office chrome, market cards, inputs, and dialogs should feel related
- do not mix ultra-round consumer UI with sharp utilitarian panels unless there is a clear product reason
- avoid heavy, muddy shadows on already complex surfaces

## Icons and status markers

Use Lucide for DOM surfaces by default.

Recommended icon sizes:

- 16
- 18
- 20
- 24

Rules:

- keep icon sizing stable within the same control family
- use status icons consistently across bubbles, cards, tables, and install review
- do not mix multiple icon families without a product reason

## Do not do these by default

- hardcoded feature-level palette logic
- novelty-first gradients across operational UI
- decorative blur on every surface
- dashboard widgets that look unrelated to the office runtime
- visually different buttons that mean the same thing
- per-feature “special” cards that ignore the design system
## Runtime experience reference

If work touches the office scene, runtime feedback, procedural art, or animation choreography,
read `/Docs/04_runtime_experience/SCENE_STATE_MATRIX.md` before making changes.

Use that matrix as the live reference for concrete scene-state mappings.
