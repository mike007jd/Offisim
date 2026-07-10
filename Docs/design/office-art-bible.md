# Offisim Office Art Bible

Source of truth for the desktop office's toy-performance visual language. P1 owns character, palette,
shape and indicator tokens; P4 owns state-system application; P6 owns environment, lighting and prop
density. Do not create parallel visual constants outside these tokens. Checked at 2026-07-10.

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

Faces use two dark eye marks and no mouth. Hair is a clear silhouette cap outside the head surface; brows,
lashes and realistic facial texture are excluded. Garments must add readable outer geometry rather than only
changing body color.

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

P4 consumes these exact semantics when consolidating legacy rings, bubbles and markers.

## 6. Environment handoff for P6

The scene becomes an open, thick, bevel-edged display plinth with rugs and furniture clusters defining zones;
walls and glass partitions are excluded. P6 derives all chair/desk/obstacle metrics from the canonical toy
character, extends the low-saturation palette to furniture, calibrates fog/light/post-processing, and records
the final 50–100 prop density and batching rules in this section.
