# Office Performance V2

Status: implementation source of truth (2026-07-23)

This plan supersedes the performance timing and richness targets in the 2026-07-09 Office Toy plans. The office remains a deterministic presentation of runtime truth: ambient life and local chatter may add character, but they may never invent work, model output, or network activity.

## Product outcome

- Ordinary work reads promptly: the first visible ambient beat happens within seconds, not minutes, and routines do not spend most of their life traversing the floor.
- Fast presentation is capability-driven. Only an explicit trusted engine capability may display or name a fast mode. Observed event cadence may tighten choreography but must stay unlabeled and must never be inferred from a model id.
- Idle employees use real break-area affordances, short desk fidgets, paired conversations, and deterministic local chatter without calling an AI engine.
- Bubbles are concise, playful, localized presentation copy. Their priority is `runtime truth > status explanation > local chatter`, with cooldowns and collision limits.
- Characters retain the original Offisim toy identity with an Animal Crossing-inspired silhouette target: `2.2–2.6` heads tall, target `2.45`, compact torso and limbs, readable hands/props, and furniture contact derived from the canonical `1.62` scene-unit height.
- Action richness comes from semantic variants and transitions, not random clip names. Reduced motion remains truthful and static.

## Frozen contracts

### Pace projection

`PaceSignal` is presentation-only and has two inputs:

1. `declaredMode`: `normal | fast`, where `fast` is accepted only from an explicit engine capability or run configuration returned by the selected lane.
2. `observedCadence`: a bounded neutral multiplier derived from real runtime event intervals. It may shorten beat holds, transition latency, and non-walk animation tempo; it may not change business state, fabricate progress, or expose a fast label.

The projection clamps all multipliers and preserves reduced-motion behavior. Role tempo is flavor and composes after the pace signal; it is not engine speed evidence.

### Ambient V2

- Scheduler stays pure, deterministic, serializable, and clock-injected.
- Busy actors and authoritative scene facts preempt ambient immediately.
- Routines use real anchors and route admission; no teleporting and no geometry-only fake affordances.
- First due and repeat intervals are short enough to keep the scene alive, while per-actor and global concurrency budgets prevent noise.
- Rest-area social, refreshment, library, phone, seated shift, look-around/stretch, and return-to-work variants have bounded dwell and transition timing.

### Local chatter

- Pure deterministic selector; no model call, network request, persistence, or runtime event.
- Copy is keyed and localized through existing renderer i18n. It never claims task progress or tool activity.
- Eligibility requires an idle/ambient actor and a safe visual window. Cooldowns, per-pair rotation, max-visible limits, and priority suppression keep it sparse.

### Character proportions and actions

- Measurement comes before scale changes. The harness records total height, head height, head ratio, shoulder width, hand visibility, seat contact, foot contact, and prop reach for every shipped body variant.
- Do not solve proportion drift with a scene-wide magic scale. Asset geometry, rig, contact metrics, and furniture relationships move as one contract.
- Action selection consumes semantic performance state plus deterministic variant; it never guesses business meaning from clip names.

## Workstreams and ownership

1. Ambient V2: dramaturgy scheduler plus ambient harnesses.
2. Local chatter: pure copy selector, localization keys, presentation integration, and harnesses.
3. Pace projection: runtime capability/cadence projection through scene performance tempo and beat timing.
4. Character proportion pass: asset pipeline, metrics, contact validation, and release-camera evidence.
5. Action richness: semantic variants, transition rules, clip-map coverage, and reduced-motion behavior; begins only after the proportion pass.
6. Integration: full gates, release `.app`, Computer Use recordings/screenshots, and Fable audit.

Hot files have one writer at a time: `packages/dramaturgy/src/index.ts`, shared-type barrels, `OfficeScene3D.tsx`, `GltfCharacter.tsx`, `clip-map.ts`, character asset builders/manifests, and release evidence indexes.

## Required gates

- `pnpm harness:dramaturgy-modes`
- `pnpm harness:office-ambient-p5`
- `pnpm harness:scene-cue`
- `pnpm harness:character-actions-p3`
- `pnpm harness:character-clip-map`
- `pnpm harness:office-diorama-p6`
- `pnpm harness:office-scene-quality`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm validate`
- `pnpm build`
- current-worktree release `.app` build and Computer Use verification at the default office camera, active fast-capable run, idle rest-area sequence, local chatter sequence, reduced motion, and representative character body variants.

