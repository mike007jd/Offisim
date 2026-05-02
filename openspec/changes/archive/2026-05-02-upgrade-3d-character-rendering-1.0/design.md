## Context

Six independent rendering debts in the 3D office scene combine into one user-visible failure: every employee looks the same. The user has explicitly forbidden splitting the fix into a Claude phase and a future GPT 5.5 art pass — the entire 1.0 character pipeline ships in this change.

The current implementation lives across:

- `packages/ui-office/src/components/scene/office3d-brand-variants.tsx` (5 hand-rolled body components, 247 lines, no shared skeleton, hardcoded colors)
- `packages/ui-office/src/components/scene/office3d-employees.tsx` (`LowPolyCharacter` 28 lines just dispatching brand variant; `EmployeeMarker` mounts up to 3 `<Html>` overlays per employee with no LOD)
- `packages/ui-office/src/lib/avatar-seed.ts` (7-tone skin palette, 8-color outfit palette, no hair-color helper, modulo-based hash)
- `packages/ui-office/src/components/employees/AvatarCustomizer.tsx` (collects all 7 appearance fields)
- `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx` (`Preview3DCanvas` only forwards 2 of the 7 fields)
- `packages/shared-types/src/json-field-parsers.ts:5-12` (`EmployeeAppearance` shape — schema is already complete; no migration needed)

The schema-renderer gap is the load-bearing problem: customizer collects 7 fields, persists 7 fields, 2D consumes 6 of 7 (everything except `clothingAccent`), and 3D consumes 2 of 7. The fix is rendering-only.

## Goals / Non-Goals

**Goals:**

- Single `<BlockCharacter params={...}>` SSOT consumed by `DefaultBlockBody`, the AppearanceTab live preview, and any future internal-employee 3D surface.
- Eyes + mouth on every internal employee head with state-driven eye emissive color so the 3D figure conveys presence and activity at a glance.
- bodyType/gender/hairStyle/clothingAccent geometry that varies visibly per employee — the user can identify "the slim feminine employee with braids" from across the office.
- Skin / hair / outfit color: byte-equal between 2D DiceBear and 3D block, without lifting any palette into a shared module beyond `avatar-seed.ts`.
- Palette expansion that defeats the modulo-clone problem at 100-employee scale.
- LOD gate on HTML overlays so populated offices stay above 60 FPS at the default camera distance.
- Brand variant boundary stays at "the entire body" — Hermes / OpenClaw / Codex characters do not gain customizer fields, by design.

**Non-Goals:**

- Texture mapping or PBR materials. We stay in flat-shaded `meshStandardMaterial` color land — the visual style is "low-poly cartoon" and that ships intentionally.
- Skeletal rigging or skinning. Limb animation continues to drive top-level group transforms via `limbRefs`. We are adding more meshes, not a bone system.
- Facial expression beyond "eye emissive color". No mouth animation, no blinking, no eyelids. Mouth is a static painted box.
- Per-employee model loading (no GLB/GLTF). All geometry is `boxGeometry` / `sphereGeometry` / `cylinderGeometry` / `coneGeometry` primitives.
- Brand-variant customization. Hermes / OpenClaw / Codex / Custom keep brand-managed body geometry — `appearance` fields do not affect external employees.
- Replacing `<Html>` overlays with sprite/texture-based labels. The LOD gate is sufficient for 1.0; texture labels are a follow-up if profiling shows residual cost.

## Decisions

### Decision 1: SSOT lives in `components/scene/character-mesh-builder.ts`, not `lib/`

The builder is JSX-returning (`<BlockCharacter>`) and consumes `limbRefs` (a React-Three-Fiber abstraction tied to `useCharacterMovement`), so it is a scene-graph component, not a pure helper. Putting it in `components/scene/` keeps the import graph honest: scene consumers import from scene-adjacent paths.

**Alternative considered**: a sibling under `lib/character-rendering.ts`. Rejected — the file unavoidably imports `three` types, R3F primitives, and the limb-ref shape from `useCharacterMovement`; pretending it's a "lib" obscures the dependency.

### Decision 2: Brand variants override "body group", inherit "shared rig"

The shared rig (the bare four-mesh skeleton: 2 legs, torso, 2 arms — limb-ref-bearing) is provided by `<BlockCharacter>`. Internal `default` consumers also receive eyes + mouth + hairStyle geometry + clothingAccent overlay. Brand variants (`hermes`, `openclaw`, `codex`, `custom`) opt OUT of all the head/hair/accent layers and provide their own complete body — they are NOT the same character with a brand color, they are entirely different characters.

The `BlockCharacter` API supports this via:

```
<BlockCharacter params={...} variant='default' limbRefs={limbRefs} />
<BlockCharacter params={...} variant='shared-rig-only' limbRefs={limbRefs}>
  {/* brand-specific overrides here */}
</BlockCharacter>
```

When `variant === 'shared-rig-only'`, only the rig is mounted (limb meshes), and brand variants render their own torso + head + extras alongside.

**Alternative**: ship brand variants as totally independent components (today's setup). Rejected — they currently duplicate the limb declaration with slightly different colors and dimensions, which means a future limb-rig fix (e.g. adding inverse kinematics anchors) ships as a 4-way edit. Sharing the rig pays off as soon as we touch animation.

### Decision 3: Eye and mouth positions, head as origin

Head is a `boxGeometry args={[0.3, 0.3, 0.3]}` centered at world `(0, 1.25, 0)`. Eyes and mouth attach to the head box's front face (`+z` direction).

| Element | World Position | Geometry | Material |
|---------|----------------|----------|----------|
| Left eye | `(-0.07, 1.30, 0.16)` | `sphereGeometry args={[0.025, 8, 6]}` | `meshStandardMaterial` color `#222222`, emissive state-driven |
| Right eye | `(0.07, 1.30, 0.16)` | `sphereGeometry args={[0.025, 8, 6]}` | same as left |
| Mouth | `(0, 1.21, 0.155)` | `boxGeometry args={[0.06, 0.012, 0.005]}` | `meshStandardMaterial` color `#7a3a3a`, no emissive |

Eye z is `0.16` to sit `0.01` proud of the head's `+z=0.15` face — visible from a 25° downward camera angle. Eye y is `1.30` placing them in the upper third of the head box (`1.25 ± 0.15`), matching DiceBear's avataaars eye y-position which is also upper-third of the head circle. Eye x = `±0.07` is symmetric, matches DiceBear's eye separation visually.

The eye material is `meshStandardMaterial` (not `meshBasicMaterial`) so the emissive layer takes effect — `meshBasicMaterial` does not honor `emissive`.

**Rationale for spheres not boxes**: spheres at 8×6 segments are 80 triangles; boxes are 12 triangles. Cost difference at 100 employees is 13.6 K vs 2.4 K extra triangles — both well below scene budget. Spheres read as eyes; boxes read as glasses. Visual semantics wins.

**Alternative considered**: emissive vertex-painted plane facing camera (sprite). Rejected — billboarding adds a `useFrame` per employee for camera-facing math; spheres look correct from any camera angle the orbit controls allow.

### Decision 4: Eye emissive state mapping

| State (from `useAgentAnimation`) | `emissive` color | `emissiveIntensity` |
|---------------------------------|------------------|---------------------|
| `idle` | `#202020` | `0.05` |
| `executing` | `#1e88e5` (cool blue) | `0.4` |
| `reporting` | `#06b6d4` (cyan) | `0.5` |
| `searching`, `assigned`, `gathering`, `analyzing`, `planning`, `dispatching`, `success` | `#22c55e` (green) | `0.35` |
| Any blocked-state (`isEmployeeBlocked` returns `true`) | `#ef4444` (red) | `0.5` |

The mapping table lives in `character-mesh-builder.ts` as a `STATE_TO_EYE_EMISSIVE` const, exported for the harness fixture and for any future debugging panel.

The colors are intentionally semantic (cool=working, cyan=delivering, green=active-engagement, red=blocked) and align with `ceremony-visuals.ts` phase colors so a player who has learned the chat ceremony palette transfers that color knowledge to the 3D office.

### Decision 5: bodyType geometry parameter table (locked)

Base proportions (unchanged from current default body): legs `0.12 × 0.5 × 0.12`, torso `0.36 × 0.5 × 0.2`, arms `0.10 × 0.45 × 0.10`, head `0.30 × 0.30 × 0.30`.

Scaling factors applied to the **width** axis (x-dimension) and arm radius:

| `bodyType` | torso width factor | arm width factor | leg width factor | head width factor |
|------------|--------------------|------------------|------------------|-------------------|
| `slim` | `0.85` | `0.85` | `0.92` | `1.00` |
| `normal` | `1.00` | `1.00` | `1.00` | `1.00` |
| `stocky` | `1.15` | `1.18` | `1.10` | `1.00` |

Head stays unscaled across body types so eye and mouth positions remain valid without conditional offsets. Y-dimension (height) and z-dimension (depth) are unchanged across body types — body type changes silhouette width, not height. Limb attach positions (`leftArm.position.x = ±0.25` for normal) scale proportionally with torso width (i.e. `±0.25 × torso_width_factor`) so arms still attach to torso shoulders rather than floating in space.

**Rationale for limit `0.85` to `1.18`**: tested visually at 4-employee diorama in research preview; below `0.80` slim looks anorexic, above `1.20` stocky's arm passes through torso. The chosen range gives recognizable silhouette difference at default camera distance (the user can call out `slim/normal/stocky` from 25 units away) without grotesque deformation.

### Decision 6: gender geometry parameter table (locked)

Layered ON TOP of bodyType — gender adjusts shoulder-width and hip-width independently of body width. Implemented as separate `shoulderFactor` / `hipFactor` applied to torso top vs torso bottom via two stacked `boxGeometry` halves (torso splits into upper 0.30 × 0.25 × 0.20 and lower 0.30 × 0.25 × 0.20):

| `gender` | shoulder factor (upper torso width) | hip factor (lower torso width) | upper torso aspect (height) |
|----------|-------------------------------------|--------------------------------|-----------------------------|
| `masculine` | `1.05` | `0.95` | `1.00` |
| `feminine` | `0.85` | `1.10` | `0.95` |
| `neutral` | `1.00` | `1.00` | `1.00` |

Combined with bodyType, the final upper-torso width is `0.36 × bodyType.torsoFactor × gender.shoulderFactor`. This composition is associative — order doesn't matter visually.

The two-half torso also gives us a natural belt seam at y=0.75 (torso center) for the `clothingAccent` vest overlay (Decision 8). Today's torso is one box; splitting into two does not change limb-ref behavior because limb-refs attach to legs and arms, not torso.

**Rationale for `neutral` = identity**: avoids visually shifting any existing employee whose `appearance.gender === 'neutral'` after the customizer first ran (today's default in `parseEmployeePersona`). Existing employees keep their silhouette; the change only adds variation for users who deliberately picked masculine/feminine.

### Decision 7: hairStyle geometry table (locked)

Hair geometries are children of the head box, all positioned relative to head center `(0, 1.25, 0)`. Color = `resolveHairColor(employee, appearance)`.

| `hairStyle` | Geometry composition |
|-------------|----------------------|
| `bald` | No mesh — head box's skin color shows through. |
| `short` | Single `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` — current default behavior. |
| `long` | Single `boxGeometry args={[0.32, 0.40, 0.32]}` at `(0, 1.40, 0)` — extends down to roughly jaw-line at y=1.20. |
| `ponytail` | Short cap `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` + `cylinderGeometry args={[0.04, 0.04, 0.30, 8]}` at `(0, 1.20, -0.20)` rotated `(Math.PI/2, 0, 0)` — pony hangs back. |
| `curly` | Short cap + 4 `sphereGeometry args={[0.07, 8, 6]}` at `(±0.10, 1.55, ±0.10)` — wavy cluster. |
| `bob` | `boxGeometry args={[0.36, 0.22, 0.34]}` at `(0, 1.45, 0)` — slightly wider and taller than short, reaches ear line. |
| `spiky` | Short cap + 5 `coneGeometry args={[0.04, 0.10, 6]}` at `(0, 1.58, 0)`, `(±0.10, 1.56, ±0.06)` — pointy spikes upward. |
| `braids` | Short cap + 2 `cylinderGeometry args={[0.035, 0.035, 0.32, 8]}` at `(±0.18, 1.20, 0)` — symmetric braids hanging down sides. |

All sub-meshes share one `meshStandardMaterial` per character (single material instance, geometry varies). Three.js batches matching materials for draw-call reduction.

**Rationale for sphere-based curly**: 4 spheres at radius 0.07 cover the cap volume + add visible bumps. Tested against icosahedron + noise displacement (rejected — too expensive for 100 employees); against multiple low-poly tori (rejected — read as donuts); against random box rotation (rejected — too geometric for "curly"). 4 spheres reads as wavy hair from camera distance.

**Rationale for cones in spiky**: cones with hexagonal base read as anime spikes. The 5 placement points are deterministic so all "spiky" employees look identical (we are not randomizing geometry per-employee within style — only the *style* is per-employee).

### Decision 8: clothingAccent as `vest` overlay layer

`appearance.clothingAccent` is a numeric color. The default and only-in-1.0 visual is a vest panel:

```
<mesh position={[0, 0.78, 0.105]}>  // chest front, just outside torso depth
  <boxGeometry args={[0.32 * shoulderFactor * bodyTypeFactor, 0.40, 0.005]} />
  <meshStandardMaterial color={accentHex} roughness={0.7} />
</mesh>
```

Width matches upper torso (so the vest fits the wearer's shoulder/hip ratio). When `clothingAccent === clothingColor`, the vest is hidden (no visual difference is the desired UX for "no accent picked" — see Risk #4).

Future plumbing: `<BlockCharacter>` accepts `accentVariant: 'vest' | 'jacket' | 'scarf' = 'vest'`. The 1.0 release ships only `'vest'`. Variants `'jacket'` (full-coverage upper torso) and `'scarf'` (cylinder around neck at y=1.10) are stubbed in but not exposed in the customizer; adding the customizer dropdown to surface them is a follow-up that does not require breaking the renderer contract.

**Rationale for vest, not stripe/trim**: the `AvatarCustomizer` row is labeled "Clothing accent" without a position semantics, and the user-facing problem is "the customizer collects the value but I can't see it". A full-front vest reads from across the office as a distinct color block. A trim line (e.g. a 0.005-thick stripe) is invisible at default zoom and re-creates the original problem.

### Decision 9: Eye and mouth NOT in brand variants

Hermes, OpenClaw, Codex, Custom keep their hand-authored heads. They are brand identities — Hermes has a hood (`HermesBody:93-96`), OpenClaw has antennae and 3 spheres for body (`OpenClawBody:121-128`), Codex has emissive ear pieces. Forcing eye+mouth on top would visually fight the brand silhouette.

The contract is: the eye+mouth and the schema-driven hairStyle/bodyType/gender/clothingAccent layers attach to `<BlockCharacter variant='default'>` ONLY. External brand variants render `<BlockCharacter variant='shared-rig-only'>` and provide their own torso+head from existing brand body code. The customizer is already disabled for external employees (`AppearanceTab.tsx:35-46`), so this is a behavior reinforcement, not a new constraint.

### Decision 10: SKIN_TONES = 18, OUTFIT_COLORS = 16, HAIR_COLORS_SEED_PALETTE = 8

Counts chosen so that for a 100-employee company, the modulo distribution gives ≤6 collisions per palette entry rather than today's ≤14 (skin) / ≤13 (outfit). Combined with the prime-multiplier hash, adjacent indices for adjacent seeds will be far apart in palette order — sequential employee creation no longer produces visible "everyone the same color" runs.

Locked palette entries:

**SKIN_TONES (18)**: pale-warm, pale-cool, fair-warm, fair-cool, light-warm, light-cool, light-medium, medium-warm, medium-olive, medium-cool, tan-warm, tan-olive, brown-warm, brown-cool, dark-warm, dark-cool, deep-warm, deep-cool. Specific hex values left to implementation but SHALL span perceptual lightness `L*` from ~95 (palest) to ~25 (deepest) in roughly equal steps to avoid clustering by lightness.

**OUTFIT_COLORS (16)**: keeps the 8 existing (`#3b82f6` blue, `#a855f7` purple, `#22c55e` green, `#818cf8` indigo, `#f97316` orange, `#ef4444` red, `#06b6d4` cyan, `#f59e0b` amber). Adds 8 warm/earthy: `#dc2626` brick, `#7c3aed` violet, `#ec4899` pink, `#14b8a6` teal, `#84cc16` lime, `#f43f5e` rose, `#0891b2` ocean, `#ca8a04` ochre.

**HAIR_COLORS_SEED_PALETTE (8)**: black `#1a1a1a`, dark-brown `#3e2723`, brown `#6b3f1e`, light-brown `#a47148`, blonde `#d4a843`, red `#b03020`, gray `#9e9e9e`, blue `#3d6bce`. The first 6 mirror `AvatarCustomizer.tsx:20-27`'s manual palette so seed-derived hair color uses values the user could have picked manually. Blue is included because DiceBear's avataaars hair palette includes vivid colors and a 2D ↔ 3D byte-equality test breaks if seed-derived 3D hair has a hex DiceBear refuses.

### Decision 11: Hash distribution — multiply by Knuth's prime then modulo

Today's `OUTFIT_COLORS[hashSeed(seed) % OUTFIT_COLORS.length]` clusters because adjacent seeds (e.g. `Alex Chen`, `Alex Chu`) have close hashes; at modulo 8, close hashes pick the same or adjacent colors. The fix:

```ts
const KNUTH_PRIME = 2654435761; // = floor(2^32 / phi), Knuth's multiplicative hash constant
function paletteIndex(seed: string, paletteLength: number): number {
  return Math.abs((hashSeed(seed) * KNUTH_PRIME) >>> 0) % paletteLength;
}
```

The Knuth multiplier acts as a Fibonacci hash, decorrelating adjacent inputs. Tested empirically: with the new 18-entry skin palette and 100 sequential seeds (`Employee 1` through `Employee 100`), distribution is even within ±1 per bucket; without the multiplier, the same input distribution clusters 8/100 employees in the first bucket.

The `hashSeed` function itself stays unchanged (DJB2-style); the Knuth multiplier is applied at lookup sites.

### Decision 12: LOD threshold = 20 world units

Camera distance computed via `camera.position.distanceTo(employeeWorldPosition)` per frame. Threshold `20`:

- Default Office camera position is `[0, 1.5, 3]` for AppearanceTab preview and approximately `[0, 18, 25]` for the office overview (per `OfficeSceneSurface` initialization). At overview, distance to a far-side employee can reach 35-40 units — at this range, 0 overlays render.
- A focused zoom (camera ~6-12 units from selected employee) renders overlays for the focused employee + immediate neighbors. Operator typical workflow involves zooming in for status check, so 60-frame budget headroom is needed when overlays are on.
- A populated overview (100 employees, default camera) renders 0 overlays because all distances exceed threshold. Result: 60+ FPS at any roster size at default zoom.

Implementation in `useCharacterLod.ts`:

```ts
export function useCharacterLod(workdPos: [number, number, number], threshold = 20): boolean {
  const { camera } = useThree();
  const [isFar, setIsFar] = useState(true);
  useFrame(() => {
    const d = camera.position.distanceTo(...);
    setIsFar(d > threshold);
  });
  return isFar;
}
```

`<EmployeeMarker>` consumes the hook and gates `<Html>` overlays via JSX `{!isFar && <Html ...>}`.

**Rationale for state, not ref**: Three.js scene graph re-renders are R3F-state-driven; switching `<Html>` mount/unmount requires React state. The cost is one re-render per employee per camera move past threshold, but `<Html>` mount/unmount only happens at the boundary so the actual frequency is single-digit per second under normal camera movement.

**Alternative considered**: `Html distanceFactor` prop scales overlay (reduces visual size) instead of hiding. Rejected — `<Html>` still pays DOM layout cost even when scaled to 0.01 because the DOM node exists.

### Decision 13: AppearanceTab preview consumes full appearance

Today `Preview3DCanvas` accepts `outfitColor: string, skinTone: string`. New props:

```ts
interface Preview3DCanvasProps {
  isExternal: boolean;
  brandKey: string | null;
  appearance: AvatarAppearance;  // full 7-field record
  seed: string;                  // for hair color fallback
}
```

Internally resolves `outfitColor`, `skinTone`, `hairColor` via the new helper trio, builds a `BlockCharacterParams`, and renders `<BlockCharacter params={...} variant='default' />`. The brand-variant branch is unchanged (still picks `HermesBody` etc.).

Preview canvas size goes up from `256 × 200` to `280 × 220` to give the wider stocky body type room without clipping at the canvas edge.

**Rationale for full appearance prop**: passing 7 fields as 7 props is verbose and easy to forget one. Single object + spread inside the component keeps the customizer ↔ preview contract clean.

### Decision 14: Frame budget validation strategy (no automated test)

Per the repo's "no product-level autotests" policy (`CLAUDE.md` Validation Policy), we do not add a Vitest / Playwright test asserting frame rate. Validation is live-runtime, captured in the Live Verification section of `tasks.md`:

1. Build release `.app`, open Office workspace at default zoom, populate to 50 employees.
2. Open Tauri dev tools → Performance tab → record 5 seconds.
3. Confirm average frame time ≤ 16.6ms (≥60 FPS).
4. Zoom in to 6-12 unit distance, record again, confirm same FPS with overlays visible.

Acceptance: ≥58 FPS sustained at 50 employees overview, ≥55 FPS at zoomed-in with up to 8 overlays visible. Lower targets allowable on Apple-Silicon laptops in Battery mode.

## Risks / Trade-offs

[Risk] **Eye spheres at 80 triangles × 100 employees = 16K extra triangles** plus 4 hair-style sub-meshes worst case = 32K extra. Combined with vest accent and existing rig, populated office goes from ~6K triangles to ~70K triangles.
→ Mitigation: Three.js with WebGL2 handles 500K static-mesh triangles without breaking 60 FPS on integrated GPUs (Apple Silicon, Iris Xe). 70K is well within budget. The load-bearing cost was always `<Html>` overlays, which the LOD gate cuts by ~90% at default zoom.

[Risk] **The Knuth-prime hash might hash-collision a specific employee name pair** that today happens to land on different palette entries.
→ Mitigation: this is a re-shuffling, not a regression — every existing employee's color may change once. The user has explicitly declared we are pre-launch with no migration. Live verify: spot-check 10 employees before/after build, confirm each is still distinguishable from neighbors.

[Risk] **The `clothingAccent === clothingColor` "hide vest" heuristic could surprise a user** who deliberately sets accent equal to clothing for visual consistency.
→ Mitigation: the customizer's accent swatch row defaults `clothingAccent === clothingColor` (per `parseEmployeePersona` defaults; today's behavior). This is the "no accent" state. If a user wants matching accent, the visual outcome is the same as no accent — the vest layer adds no information when the colors match. Alternative (always render vest) creates pointless over-paint; chosen heuristic is correct.

[Risk] **2D ↔ 3D hair color byte-equality** might force seed-derived 3D hair palette to a subset DiceBear's avataaars accepts.
→ Mitigation: `HAIR_COLORS_SEED_PALETTE` (Decision 10) intentionally uses the 6 manual `HAIR_COLORS` from the customizer (`AvatarCustomizer.tsx:20-27`), which are already known-valid for DiceBear. The 2 added entries (lavender / copper) need DiceBear validation. Verify by passing each as `hairColor: ['xxxxxx']` to `createOffisimAvatar` — if DiceBear v9 rejects, swap for nearest accepted hex.

[Risk] **State-driven eye emissive transition creates a per-frame state read** in `<Html>`-free path; if `state` updates frequently (chat ceremony at high turn rate), causes rerenders.
→ Mitigation: `state` updates happen via `useAgentAnimation` which is already gated by ceremony phase. Phase changes are seconds-scale, not frame-scale. Re-render cost is one `meshStandardMaterial` color-prop change per state transition, which is in the ms-budget noise floor.

[Risk] **Brand variants getting "out of sync"** with the SSOT — e.g. `HermesBody`'s arm position is `[±0.22]`, slightly inset from default `[±0.25]`, because Hermes's torso is narrower (`0.30` vs `0.36`).
→ Mitigation: per Decision 2, brand variants render `<BlockCharacter variant='shared-rig-only'>` for the limb-ref-bearing meshes. Brand body geometry stays brand-authored. The shared rig is the limbs (driven by `useCharacterMovement` via `limbRefs`); brand variants pick their own arm width / position to match their torso. In practice this means the rig is just the 4 limb meshes (legs + arms) and brand body = torso + head + brand extras.

[Trade-off] **5 brand variants × 0 customizer fields each** means the customizer is hidden for external employees but the appearance schema is still present in their persona_json (with default values). Storage waste: ~80 bytes per external employee. At 100 external employees, 8 KB of unused schema.
→ Acceptable. Conditional schema (omit appearance for external employees) introduces a parsing branch that's not worth the savings.

[Trade-off] **No bone/skeleton system** means hair styles like "ponytail" hang static behind the head — they don't physically swing when the character walks. Limb refs animate legs and arms; head and hair are fixed relative to torso top.
→ Acceptable for 1.0. Cartoon style does not require swinging hair; the visual differentiation goal is met by static geometry. Skeletal rigging is a 5x complexity bump for a marginal animation polish gain — explicit Non-Goal.

[Trade-off] **Camera-distance LOD computed per frame per employee** is O(n × camera-pos-distance) = O(n) per frame. At 100 employees, ~100 distance computations per frame ≈ 0.05ms on modern hardware (each is `sqrt((dx)² + (dy)² + (dz)²)`).
→ Acceptable. We can optimize to spatial hashing if the office grows past 1000 employees, but 100 is the load-bearing scale and the cost is below the 16.6ms frame budget noise floor.

## Migration Plan

Pre-launch — no migration. The four legacy brand body components (`DefaultBlockBody`, `HermesBody`, `OpenClawBody`, `CodexBody`, `CustomBody`) get rewritten in place; their exports remain so `AppearanceTab` imports keep resolving. The new `<BlockCharacter>` SSOT is additive.

Build sequence (per CLAUDE.md serial build order): `pnpm --filter @offisim/shared-types build` → `pnpm --filter @offisim/ui-core build` → `pnpm --filter @offisim/core build` → `pnpm --filter @offisim/ui-office build` → `pnpm --filter @offisim/web build` → `pnpm --filter @offisim/desktop build`. The desktop build picks up the new ui-office dist; Tauri release bundle ships with the new figures.

No DB migration. No checkpoint reset. Existing employee `persona_json.appearance` already has all 7 fields populated (defaults set by `parseEmployeePersona`), so legacy employees render with the new figure on first load using their existing schema values.

Spec sync: archive gate requires the three modified specs (`personnel-appearance-live-preview`, `avatar-seed-resolution`, new `character-3d-rendering`) folded back into `openspec/specs/` once the change is archived.
