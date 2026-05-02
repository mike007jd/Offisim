## Why

The 3D block-figure renderer is the load-bearing visual surface for "process is value" — the entire selling point of Offisim is that the user can look at the 3D office and identify each employee at a glance. Today the renderer fails this contract on six independent fronts and they all compound:

1. **Geometry ignores schema.** `packages/ui-office/src/components/scene/office3d-brand-variants.tsx:22-54` (`DefaultBlockBody`) renders the same 5 boxes for every internal employee. `EmployeeAppearance.bodyType`, `gender`, `clothingAccent`, and `hairStyle` (defined in `packages/shared-types/src/json-field-parsers.ts:5-12` and exposed in `AvatarCustomizer.tsx`) persist to disk on save but the 3D figure ignores all four — the customizer's "Body type", "Gender presentation", "Hair style", "Clothing accent" rows are write-only sinks. The current copy literally tells the user the trim "arrives in an upcoming art pass" (`AvatarCustomizer.tsx:122`) and the C1 spec acknowledges this: `personnel-appearance-live-preview` says hair/body/gender/accent "persist in `persona_json.appearance` but SHALL NOT alter the 3D figure's geometry, proportions, or color in this change."

2. **Headless faces.** `office3d-brand-variants.tsx:45-52` renders the head as a 0.3³ skin-colored cube plus a 0.32×0.16×0.32 black hair cube on top — no eyes, no mouth, no nose. Meanwhile the 2D DiceBear avatar (`createOffisimAvatar` in `avatar-seed.ts:102-127`) is a full cartoon face. The same employee looks like Pixar in 2D and a faceless mannequin in 3D. The user cannot read who is who in a populated office because every figure has the same blank head.

3. **Hair color is hardcoded.** `office3d-brand-variants.tsx:51` writes `color="#1a1a1a"` (`HermesBody:60` writes `'#312e81'`, `CodexBody` has none at all). `appearance.hairColor` is a numeric `EmployeeAppearance` field, persisted, surfaced in `AvatarCustomizer` as a 6-color swatch, and consumed correctly in 2D — and dropped on the floor in 3D. There is no `resolveHairColor` helper in `packages/ui-office/src/lib/avatar-seed.ts` to mirror `resolveOutfitColor` / `resolveSkinTone`.

4. **Color palettes too small.** `avatar-seed.ts:26-34` `SKIN_TONES` has 7 entries, mostly pale; `OUTFIT_COLORS` has 8 cool-leaning entries (`avatar-seed.ts:7-16`). With 100 employees per company the modulo bucketing repeats every 7th / 8th employee — a population sweep visibly clones. The seed-derived palette is the *only* differentiator for legacy / unedited employees, and it's too small for the population scale we sell.

5. **Per-brand geometry duplication.** `office3d-brand-variants.tsx` ships `DefaultBlockBody` (legs/torso/arms/head/hair) and three brand variants (`HermesBody`, `OpenClawBody`, `CodexBody`) that each redeclare the same `<mesh>`/`<boxGeometry>` skeleton with different colors. `CustomBody` is yet another copy. There is no parameterized `block-character-mesh-builder` SSOT, so any geometry change (new appearance dimension, new attach point, animation rig) ships as a 4-way edit and brand variants drift.

6. **HTML overlay overload.** `office3d-employees.tsx:401-415, 418-422, 254-287` mounts up to three `<Html>` overlays per employee (selection name pill, drag badge, status bubble). At 100 employees this is 300 absolutely-positioned HTML nodes recomputed every frame — measurable jank on populated offices, and the underlying scene-orchestrator does not gate them by camera distance.

These are not separable enhancements. The user sees one 3D office; either every employee looks individuated, faced, palette-distinct, and geometrically schema-driven, or none of them do. Half-shipping (e.g. faces but no body geometry, or body geometry but no hair color) leaves the same "everyone looks the same" UX failure. **The user has explicitly forbidden deferring any of this to "a future GPT 5.5 art pass" — the entire 1.0 visual contract ships in this change.**

We are pre-launch — no back-compat shims for legacy 3D figures, no fallback paths, no deferred items.

## What Changes

- **Replace `office3d-brand-variants.tsx` with a parameterized SSOT.** Introduce `packages/ui-office/src/components/scene/character-mesh-builder.ts` exporting a `BlockCharacterParams` interface (skin, outfit, hair color; bodyType, gender, hairStyle, clothingAccent geometry parameters; eye/mouth descriptor) plus `<BlockCharacter params={...} limbRefs={...} />`. The four legacy bodies (`DefaultBlockBody`, `HermesBody`, `OpenClawBody`, `CodexBody`, `CustomBody`) become thin wrappers: brand variants declare ONLY their differences (override layer mesh group), the shared skeleton geometry comes from the builder.

- **Render eyes and a mouth on every internal employee head.** Two small `sphereGeometry` eyes (radius 0.025) at `(±0.07, 1.30, 0.16)`, color `#222222`, and a flat `boxGeometry` mouth (0.06×0.012×0.005) at `(0, 1.21, 0.155)`, color `#7a3a3a`. Eyes use `<meshStandardMaterial emissive={state-driven-color} emissiveIntensity={state-driven-intensity}>` so eye color signals presence/working/blocked state. External brand bodies keep their brand-specific head — they are not subject to the eye+mouth contract.

- **Drive bodyType geometry parametrically.** `bodyType: 'slim' | 'normal' | 'stocky'` maps to torso width / arm width / hip width / shoulder width factors at `0.85x / 1.0x / 1.15x` of base, with arm-radius scaled at `0.85x / 1.0x / 1.18x`. (Field name in `EmployeeAppearance` is the literal `bodyType`; `AvatarCustomizer.tsx:46` uses values `['normal', 'slim', 'stocky']`.) Numbers are codified in `design.md` decision table.

- **Drive gender geometry parametrically.** `gender: 'masculine' | 'feminine' | 'neutral'` maps to shoulder-width factor (`1.05x / 0.85x / 1.0x`), hip-width factor (`0.95x / 1.10x / 1.0x`), and torso aspect (`1.0x / 0.95x / 1.0x`). Default `neutral` is geometrically equivalent to today's silhouette so unedited employees do not visually shift.

- **Render hairStyle as 6 distinct geometries.** `short` (today's flat cap), `long` (extended box reaching jaw line), `ponytail` (short cap + back-pointing cylinder), `curly` (cap + 4 small spheres clustered on top), `bald` (no hair mesh, scalp uses skinTone), `bob` (cap with extended sides reaching ear), `spiky` (cap + 5 small `coneGeometry` spikes), `braids` (cap + 2 down-pointing cylinders on the sides). Geometry parameters codified in `design.md` decision table — no placeholders.

- **Render clothingAccent as a parametric layer mesh.** Default rendering is a vest panel: a thin (`0.005`) `boxGeometry` overlay at chest front, full torso width, color = `appearance.clothingAccent` resolved through `numericToHex`. When `clothingAccent === clothingColor` the overlay is hidden (no visual difference is the desired UX for "no accent picked"). Future variants (jacket / scarf) are plumbed via a `accentVariant` field default `'vest'` — `'vest'` is the only one rendered in 1.0 but the dispatch is in place.

- **Add `resolveHairColor(employee, appearance?)` and a default seed-derived palette.** Mirrors `resolveOutfitColor` / `resolveSkinTone` exactly. New `HAIR_COLOR_PALETTE` in `avatar-seed.ts` of 8 colors (black, brown, blonde, red, gray, blue, lavender, copper) — matches the 6 manual `HAIR_COLORS` in `AvatarCustomizer.tsx:20-27` plus 2 extras to meet the modulo-rotation rule (≥ 8 to outpace the 7-employee `SKIN_TONES` clone). Updated `office3d-brand-variants.tsx` and `character-mesh-builder.ts` consume `resolveHairColor(...)` instead of literal `'#1a1a1a'`.

- **Expand `SKIN_TONES` to 18 entries** spanning very-light → very-dark with warm/cool shifts, and **expand `OUTFIT_COLORS` to 16 entries** adding warm tones (amber → terracotta → maroon → olive → teal → fuchsia → slate → coral). Replace the `hashSeed % 7` pattern with a non-clustering hash distribution — multiply by a large prime before modulo (`(hash * 2654435761) % palette.length`) so the first 18 employees in a roster never collide on two adjacent palette indices. `OUTFIT_PALETTE` tuple structure (`avatar-seed.ts:7-16`) stays — the new entries just append.

- **Visual consistency contract: 2D ↔ 3D.** Same seed + appearance MUST produce a recognizable identity across DiceBear and 3D block. The four mandatory matching axes are: **eye-position** (3D eye centers within 5% of head box symmetric to vertical axis matching DiceBear face's symmetric eyes), **skinColor** (byte-equal hex), **hairColor** (byte-equal hex), **clothingColor** (byte-equal hex). Hair *style* is allowed to diverge (DiceBear's 8 `top` tokens vs 3D's 8 geometries are visually thematic, not byte-equal).

- **LOD for HTML overlays.** `<Html>` overlays in `EmployeeMarker` (selection name pill, status bubble, badge) gain a `lodVisible` gate — when `cameraDistance > 20` units, hide. Implementation uses `useFrame` reading the camera from `useThree()` and a per-marker `isFar` state, pulled to a `useCharacterLod` hook to avoid per-marker subscription cost. Threshold `20` chosen so a default zoom showing the whole office (camera ~25-30 units back) shows zero overlay HTML, and a focused zoom (camera ~6-12 units) shows everything.

- **AppearanceTab live preview parity.** `AppearanceTab.tsx` `Preview3DCanvas` consumes the new `<BlockCharacter>` SSOT with all 7 appearance fields (skinColor, hairColor, hairStyle, clothingColor, clothingAccent, bodyType, gender) so swatch/select changes flip 3D geometry within one frame. Today only `outfitColor` and `skinTone` are passed (`AppearanceTab.tsx:69-78`).

- **Eye emissive state mapping.** Eye `emissive` color/intensity is keyed to `state` from `useAgentAnimation`: `idle` → `#202020 / 0.05`, `executing` → `#1e88e5 / 0.4` (cool blue working glow), `reporting` → `#06b6d4 / 0.5` (cyan delivery glow), `searching|assigned|gathering|analyzing|planning|dispatching` → `#22c55e / 0.35` (green active), blocked states → `#ef4444 / 0.5` (red).

- **Production validation harness coverage.** Add deterministic harness invariant: when an employee with appearance `(skinColor=A, hairColor=B, hairStyle='braids', bodyType='slim', gender='feminine', clothingColor=C, clothingAccent=D)` is rendered, the captured 3D scene graph SHALL contain the corresponding hair-style mesh group, the slim torso width factor, the feminine hip ratio, and accent overlay material color D. Scene-graph snapshot captured via a test renderer pass; assertion file in `packages/core/harness/scenarios/` is N/A (3D-rendering scope is UI not core graph), so the validation lives as a Vitest-free assertion in the live verification protocol below.

## Capabilities

### New Capabilities

- `character-3d-rendering`: Defines the contract for how `EmployeeAppearance` schema fields drive 3D block-figure geometry, materials, and overlays. Owns: the SSOT `<BlockCharacter>` builder, the bodyType/gender/hairStyle/clothingAccent → geometry parameter table, the 2D ↔ 3D visual consistency contract (skin/hair/outfit color byte-equality, eye-axis symmetry), the eye/mouth presence contract, the eye emissive-state mapping, the LOD threshold for HTML overlays, and the brand-variant override boundary (which mesh layers brand bodies replace, which they inherit).

### Modified Capabilities

- `personnel-appearance-live-preview`: All 7 appearance fields (skin/hair/clothing color + hairStyle/bodyType/gender/clothingAccent) SHALL flip the 3D preview live. The "C1 scope is skin and clothing color only" requirement is REPLACED — the new contract is full schema parity. The customizer copy line "Saved with the employee — visible trim arrives in an upcoming art pass" SHALL be removed; `clothingAccent` is now visible.

- `avatar-seed-resolution`: `SKIN_TONES` SHALL have at least 18 entries; `OUTFIT_COLORS` SHALL have at least 16 entries; a new `HAIR_COLORS_SEED_PALETTE` of at least 8 entries SHALL exist for seed-derived hair color. A new `resolveHairColor(employee, appearance?)` helper SHALL exist mirroring the `resolveOutfitColor` / `resolveSkinTone` shape. Hash distribution SHALL multiply by a large prime before modulo to avoid adjacent clustering on small populations.

## Impact

- **Code (new files)**:
  - `packages/ui-office/src/components/scene/character-mesh-builder.ts` (parameterized `<BlockCharacter>` SSOT)
  - `packages/ui-office/src/components/scene/character-mesh-parts/` (eyes, mouth, hair-style geometries — one file per topology family for tree-shaking)
  - `packages/ui-office/src/hooks/useCharacterLod.ts` (camera-distance gate for `<Html>` overlays)

- **Code (modified)**:
  - `packages/ui-office/src/components/scene/office3d-brand-variants.tsx` — `DefaultBlockBody` becomes a thin wrapper around `<BlockCharacter>`; `HermesBody` / `OpenClawBody` / `CodexBody` / `CustomBody` consume the SSOT for shared rig + override their distinct mesh layers.
  - `packages/ui-office/src/components/scene/office3d-employees.tsx` — `LowPolyCharacter` accepts the full `BlockCharacterParams`; `EmployeeMarker` resolves the params from `appearance` + seed; `<Html>` overlays gated by `useCharacterLod`.
  - `packages/ui-office/src/lib/avatar-seed.ts` — palette expansion, prime-hash, `resolveHairColor`, `HAIR_COLORS_SEED_PALETTE`, `outfitColorFromSeed` / `skinToneFromSeed` / `hairColorFromSeed` use the new hash.
  - `packages/ui-office/src/components/employees/AvatarCustomizer.tsx` — remove the "art pass" copy line; clothing accent swatch label clarifies "Visible vest accent overlay".
  - `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx` — `Preview3DCanvas` receives full appearance prop, not just outfit+skin.

- **Schema**: NO migration. All seven `EmployeeAppearance` fields already exist in `packages/shared-types/src/json-field-parsers.ts:5-12` and are already persisted by the customizer. This change is rendering only.

- **Specs**:
  - NEW capability: `character-3d-rendering` (one new spec file)
  - MODIFIED: `personnel-appearance-live-preview` (Requirement "3D scope in C1 is skin and clothing color only" replaced)
  - MODIFIED: `avatar-seed-resolution` (palette size requirements modified, new `resolveHairColor` requirement)

- **Bundle size**: New geometry primitives are all primitives (box/sphere/cylinder/cone) — no model files, no textures. Estimated +3 KB minified per geometry family × 8 hair styles ≈ +25 KB total in `office3d-employees.js` chunk. Acceptable.

- **Frame budget**: Per employee adds 2 eye spheres + 1 mouth box + up to 4 hair-style sub-meshes + 1 accent overlay = up to 7 extra meshes. At 100 employees that's 700 meshes added on top of the existing ~500 (5 base meshes × 100). Total scene mesh count goes from ~500 to ~1200. Three.js handles 5000+ static meshes easily on baseline hardware; the load-bearing cost is the `<Html>` HTML overlays, which we are *cutting* from up to 300 to roughly 30 (only the camera-near employees) via the new LOD gate. Net frame budget improves.

- **Brand-variant compatibility**: External brand bodies (Hermes, OpenClaw, Codex) keep their distinct full-body geometry — they SHALL NOT inherit eye+mouth+hairStyle from the internal contract. Brand variants are *brand identity*, not customizable employees; the C1 contract that brand variants override the entire body still holds. Only `DefaultBlockBody` gains the new schema-driven layers.

- **No back-compat**: pre-launch — `DefaultBlockBody`'s old box-only geometry is replaced, not aliased. Existing in-flight employee data renders with the new figure on first load (their persisted `appearance` already covers all 7 fields if the customizer was used; defaults from `parseEmployeePersona` cover the rest).

- **Live verification**: in release `.app`, create 6 employees covering the visual axes — `(slim, masculine, short, vest=match)`, `(slim, feminine, braids, vest=red)`, `(normal, neutral, bald, vest=accent)`, `(stocky, masculine, spiky, vest=match)`, `(stocky, feminine, bob, vest=accent)`, `(normal, masculine, ponytail, vest=accent)`. Open Office workspace; visually confirm all 6 are distinguishable from across the office at default zoom, and at zoomed-in view the eye color reflects employee state. Confirm 2D personnel rail avatar and 3D figure are identifiable as the same employee for each (matched skin/hair/outfit color, mirrored eye axis position).
