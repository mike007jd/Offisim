# Offisim Office Art Bible

Source of truth for the desktop office's toy-performance visual language. P1 owns character, palette,
shape and indicator tokens; P4 owns state-system application; P6 owns environment, lighting and prop
density. Do not create parallel visual constants outside these tokens. Checked at 2026-07-16.

## 1. North star

The office reads as a premium desk-toy diorama: calm, tactile, concise and legible at the default camera.
Characters are friendly work figures, not miniature realistic adults and not children. Work is communicated
first by pose + prop + eyes, then confirmed by a restrained indicator.

## 2. Character proportions

| Token | Value | Rule |
|---|---:|---|
| character height | `1.62` scene units | All furniture contact metrics derive from this canonical height. |
| head ratio | `2.2–2.6` heads, target `2.45` | Oversized head, short torso and limbs. |
| body girth | `0.84 / 1.00 / 1.18` | Slim/normal/stocky scale X/Z only; never scale Y. |
| head round | `[1, 1, 1]` | Neutral toy head. |
| head soft-square | `[1.10, 0.94, 0.98]` | Wider, slightly shorter silhouette; all edges remain soft. |
| head capsule | `[0.90, 1.12, 0.94]` | Taller, narrower silhouette. |
| edge language | radius or bevel `6–14%` of shortest dimension | No knife edges on character garments or authored props. |

`toy-performance-metrics.json` is the sole numeric source for body geometry, garment shell proportions and
silhouette gates. The asset builder derives the bind-space envelopes and the complete 3 girths × 3 head shapes
matrix from that contract; P0 independently samples shipped GLB landmarks, workstation contacts and every prop
attach, while P1 rejects manifest/metrics drift. This document describes the rule and deliberately does not
repeat the numeric thresholds.

Faces use two dark eye marks plus one minimal mouth mark per expression state (small smile / wide smile /
frown / flat line) — the mouth is a decal in the same dark tone as the eyes, never lips or texture. Hair is a
clear silhouette cap that visibly wraps OUTSIDE the head surface with a front hairline over the forehead
(hair geometry buried inside the skull reads as bald from the office camera); brows, lashes and realistic
facial texture are excluded. Garments must add readable outer geometry rather than only changing body color.

## 3. Palette and material

Core surfaces are low-saturation and warm-neutral. Character identity may use one clothing color plus one
smaller accent; the accent must not cover more visual area than the clothing base. Materials are matte with
soft highlights (`roughness 0.68–0.94`, `metalness 0` except tiny hardware accents).

Skin UI names are neutral and ordered only by tone:

| UI token | Label | Hex |
|---|---|---|
| `tone-01` | Tone 01 · Light neutral | `#F2D2BD` |
| `tone-02` | Tone 02 · Light warm | `#E5B48A` |
| `tone-03` | Tone 03 · Medium warm | `#C9875A` |
| `tone-04` | Tone 04 · Medium deep | `#A95F38` |
| `tone-05` | Tone 05 · Deep neutral | `#68483C` |
| `tone-06` | Tone 06 · Deep warm | `#4A3029` |

Role auxiliaries are small badge/prop cues, never skin or full outfit assignments:

| Role family | Auxiliary | Default prop |
|---|---|---|
| Engineering | blue `#5C7FA3` | laptop |
| Design | violet `#8A739B` | swatch |
| Product / PM | amber `#B38A4A` | clipboard |
| QA | teal `#4F8A82` | checklist |
| Research | indigo `#6877A0` | tablet |
| Operations | slate `#65727A` | headset / keycard |
| Unknown | neutral `#77736C` | clipboard |

## 4. Expression and motion

| Expression | Eye construction | Meaning |
|---|---|---|
| neutral | round dots | available / ordinary work |
| happy | upward arc pair | success / celebration |
| worried | inward descending diagonal pair | blocked / failure |
| focus | short horizontal capsules | concentrated work |
| blink | short horizontal closed pair | 120ms, deterministic 2–6s phase interval |

Blink phase may desynchronise employees but must never affect identity. Reduced motion disables blink and all
decorative eye interpolation; the correct expression remains visible as a static state.

## 5. Indicator hierarchy

Order of evidence is fixed: `pose/action → held prop → eyes → role badge → overlay`. Overlays are compact,
soft-edged and never obscure the face or prop.

| State token | Color | Shape / motion |
|---|---|---|
| working | muted blue-teal `#5C9A96` | low halo + three restrained typing dots |
| approval | amber `#D09A45` | steady badge/halo; never red |
| blocked | muted red `#C65F5A` | warning confirmation + worried eyes |
| selected | cool highlight `#7FA9D8` | crisp outer ring + nameplate |

### P4 application contract

Business-state precedence is `blocked > approval > working > idle`; selection is an orthogonal interaction
layer and never rewrites business state. The production indicator owns one vocabulary only:

- idle: low-contrast base disc;
- working: muted teal disc plus exactly three restrained dots;
- approval: amber ring plus one head confirmation;
- blocked: muted-red segmented ring plus one head confirmation; a typed `T/B/P/C/R/X` resource marker
  replaces the generic blocked marker instead of stacking with it;
- selected: one cool outer ring outside the business-state treatment.

Diegetic evidence remains primary. Approval uses `approval.wait` + clipboard, blocked uses worried eyes +
headshake, and artifact delivery uses carry/handoff + document while walking to a real, uniquely reserved
delivery-shelf anchor. Non-blocking resource warnings stay slate; only blocked/exhausted resource states may
use muted red. The 2D scene consumes the same status/ink source without a P4 visual redesign. Workload,
marker, chip, shelf and flow treatments use compact toy bevels; blocked nameplates state the actor identity
explicitly and do not repeat the failure phrase on the flow lane.

## 6. P6 final environment contract

The production Office is an open display model, never a room. A `42 × 42` warm-neutral floor sits on a
`0.52`-unit thick wood-edged plinth with a rounded top lip; three walls, side windows, wall art, interior glass
and ceiling-dependent lights are excluded from the Office render path. Thick rounded rugs, furniture clusters,
low planters and marker posts define the seven zones. The Studio editor may retain its preview luminaire, but
that component must not be mounted by `OfficeScene3D`.

The backdrop is a closed three-stop studio gradient, so every legal orbit angle remains intentional. Fog begins
beyond the main furnishing span (`46 → 118`), not over the characters. Lighting stays static and broad: warm
key, cool fill, restrained rim. N8AO runs half-resolution with SMAA retained; bloom and vignette remain subtle
enough that material and state ink stay readable. Full Game View keeps continuous animation and DPR
`[1, 2]`; expanded PiP renders on a bounded 4fps demand loop at DPR `1`, and collapsed PiP unmounts the
scene until it is expanded or Game View resumes.

Furniture contact metrics are one contract with the `1.62`-unit toy body. Chair top is `0.42`, desk top is
`0.768`, and laptop width is `0.40`; workstation widths, chair envelope, seat anchors and pathfinding radii all
derive from `toy-performance-metrics.json`. Runtime obstacle radius is the rendered desk/chair footprint times
`SCENE_CONTENT_SCALE`, plus `0.08` navigation clearance; every non-workstation radius derives from the public
shared world-space prefab footprint contract instead of a renderer-only table. The P6 oracle rejects scale drift that
overlaps the system workspace layout or pushes a canonical zone beyond the plinth.

The canonical seven-zone office contains 33 semantic prefab instances plus four low edge props per zone, for
61 active floor props—inside the `50–100` budget. Repeated pots, foliage, marker bodies and caps use four
`InstancedMesh` draw calls independent of zone count. Decorative dressing stays low, has no affordance or
interaction anchor, and cannot become a second source for navigation or dramaturgy.

Environment palette remains low-saturation: warm wood/plastic for the plinth, archetype tint only on rugs,
muted green foliage, and small warm/cool accents on dressing. Environment bevel radius stays `6–14%` of the
shortest visible prop dimension; rugs use a broader `0.19–0.28` soft edge because they are zone-scale forms.

## 7. Scene depth and prefab surface quality

Office and Studio share one finite depth budget: perspective near plane `0.75`, far plane `180`, with no
logarithmic- or reversed-depth fallback. This covers the complete legal orbit, camera-follow backdrop and fog
while keeping the far/near ratio at `240:1`. Both production canvases must pass the shared values explicitly;
renderer defaults are not part of the product contract.

Visible surfaces have semantic ownership instead of ad-hoc millimetre offsets:

- structural layers are opaque geometry with real thickness and non-intersecting volumes;
- rugs are physically stacked slabs whose adjacent faces meet but never overlap;
- screens, labels, panel marks and other decals use the shared decal material contract: `depthWrite=false`,
  controlled polygon offset and stable render order;
- glass/translucent overlays never become an invisible depth occluder;
- floor bands and grid marks render as one deterministic overlay treatment, not several competing floor planes;
- prefab ground details sit on the declared rug top or are removed when they duplicate the zone surface.

Procedural normal and baked panel textures use linear magnification, trilinear mipmapped minification and
bounded anisotropic sampling. Normal maps stay in non-colour data space; baked colour panels use sRGB. Tiny
remote details must collapse into a stable material/texture read rather than remain sub-pixel geometry that
shimmers during orbit or zoom.
