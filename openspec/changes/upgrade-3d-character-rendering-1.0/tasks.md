## 1. Palette + hash + helper foundation (`avatar-seed.ts`)

- [ ] 1.1 In `packages/ui-office/src/lib/avatar-seed.ts`, expand the `OUTFIT_PALETTE` tuple from 8 to 16 entries — add `[hex, label]` pairs for brick `#dc2626`, violet `#7c3aed`, pink `#ec4899`, teal `#14b8a6`, lime `#84cc16`, rose `#f43f5e`, ocean `#0891b2`, ochre `#ca8a04`. Order chosen so `OUTFIT_COLORS_NUMERIC` and `OUTFIT_LABELS` extend cleanly.
- [ ] 1.2 Replace the 7-entry `SKIN_TONES` const with an 18-entry array spanning very-light → very-dark with warm/cool shifts. Use perceptual lightness `L*` from ~95 down to ~25 in roughly equal steps. Document in inline comment that the array is the seed-derived palette and is independent from `AvatarCustomizer.tsx`'s 5-entry manual `SKIN_COLORS`.
- [ ] 1.3 Add `HAIR_COLORS_SEED_PALETTE: readonly string[]` of 8 entries: black `#1a1a1a`, dark-brown `#3e2723`, brown `#6b3f1e`, light-brown `#a47148`, blonde `#d4a843`, red `#b03020`, gray `#9e9e9e`, blue `#3d6bce`. Document that the first 6 mirror `AvatarCustomizer.tsx`'s manual `HAIR_COLORS` palette so 2D ↔ 3D byte-equality holds when seed-derived hair is consumed.
- [ ] 1.4 Add `KNUTH_PRIME = 2654435761` constant and `paletteIndex(seed: string, paletteLength: number): number` helper that returns `Math.abs((hashSeed(seed) * KNUTH_PRIME) >>> 0) % paletteLength`. Replace the three modulo lookups (`outfitColorFromSeed`, `skinToneFromSeed`, the new `hairColorFromSeed`) with `paletteIndex` calls.
- [ ] 1.5 Add `hairColorFromSeed(seed: string): string` that returns `HAIR_COLORS_SEED_PALETTE[paletteIndex('hair:' + seed, HAIR_COLORS_SEED_PALETTE.length)] ?? '#1a1a1a'`. Prefix `'hair:'` on the seed input so hair-color hash bucket is independent from skin and outfit hash buckets (otherwise a deterministic correlation appears in seed-derived rosters).
- [ ] 1.6 Add `resolveHairColor(seed: string, appearance?: EmployeeAppearance | null): string` mirroring `resolveOutfitColor` / `resolveSkinTone` exactly. When `appearance.hairColor` is a number, return `numericToHex(appearance.hairColor)`; else return `hairColorFromSeed(seed)`.
- [ ] 1.7 Verify `createOffisimAvatar` already passes `hairColor` to DiceBear (`avatar-seed.ts:123`) — no change needed there since avataaars v9 accepts hex strings.
- [ ] 1.8 Build: `pnpm --filter @offisim/ui-office typecheck` to confirm the helper signatures compile; no consumer wired in yet (those come in Section 4).

## 2. `<BlockCharacter>` SSOT (`character-mesh-builder.ts`)

- [ ] 2.1 Create `packages/ui-office/src/components/scene/character-mesh-builder.ts` exporting:
  - `interface BlockCharacterParams { skinColor: string; hairColor: string; outfitColor: string; accentColor: string; bodyType: 'slim' | 'normal' | 'stocky'; gender: 'masculine' | 'feminine' | 'neutral'; hairStyle: 'short' | 'long' | 'ponytail' | 'curly' | 'bald' | 'bob' | 'spiky' | 'braids'; accentVariant?: 'vest' | 'jacket' | 'scarf'; state: string; isBlocked: boolean }`
  - `STATE_TO_EYE_EMISSIVE: Record<string, { color: string; intensity: number }>` const with the table from `design.md` Decision 4
  - `BODY_TYPE_FACTORS: Record<bodyType, { torso: number; arm: number; leg: number; head: number }>` const with table from Decision 5
  - `GENDER_FACTORS: Record<gender, { shoulder: number; hip: number; aspect: number }>` const with table from Decision 6
  - The `<BlockCharacter params={...} variant='default' | 'shared-rig-only' limbRefs={...} children?>` component
- [ ] 2.2 Implement shared rig: 2 leg meshes + 2 arm meshes parameterized by `bodyType` factors. Limb-ref attachment via `limbRefs?.leftLeg` etc. — preserve current `castShadow` and `boxGeometry` shape, only width factor changes per body type.
- [ ] 2.3 Implement upper torso (`y` from 0.62 to 0.87): `boxGeometry args={[0.36 × bodyTypeFactor.torso × genderFactor.shoulder, 0.25 × genderFactor.aspect, 0.20]}` at `(0, 0.74, 0)`, color = `outfitColor`.
- [ ] 2.4 Implement lower torso (`y` from 0.50 to 0.75): `boxGeometry args={[0.36 × bodyTypeFactor.torso × genderFactor.hip, 0.25, 0.20]}` at `(0, 0.62, 0)`, color = `outfitColor`. Two-half torso replaces today's single-box torso to enable shoulder/hip width independence.
- [ ] 2.5 Implement head: `boxGeometry args={[0.30, 0.30, 0.30]}` at `(0, 1.25, 0)` color = `skinColor`. Head SHALL NOT scale with bodyType (per Decision 5) so eye/mouth positions remain valid.
- [ ] 2.6 Implement eyes: 2 `sphereGeometry args={[0.025, 8, 6]}` at `(±0.07, 1.30, 0.16)`, color `#222222`, emissive resolved from `STATE_TO_EYE_EMISSIVE[state]` (or red for `isBlocked`), `emissiveIntensity` likewise.
- [ ] 2.7 Implement mouth: `boxGeometry args={[0.06, 0.012, 0.005]}` at `(0, 1.21, 0.155)`, color `#7a3a3a`, no emissive.
- [ ] 2.8 Implement hairStyle dispatch — switch on `params.hairStyle`, render the geometry composition from Decision 7's table. All hair meshes share one `meshStandardMaterial` instance with color `hairColor`. `bald` returns `null` (no hair group).
- [ ] 2.9 Implement clothingAccent vest: `boxGeometry args={[0.32 × bodyTypeFactor.torso × genderFactor.shoulder, 0.40, 0.005]}` at `(0, 0.78, 0.105)`, color = `accentColor`, hidden (`null` early return) when `accentColor === outfitColor`.
- [ ] 2.10 Implement `variant='shared-rig-only'` branch: render only legs + arms (limb-ref bearing meshes), do NOT render torso / head / hair / accent. Brand body components mount their own torso/head alongside.
- [ ] 2.11 Wire `children` prop so brand variants can pass extra meshes that render alongside the shared rig.
- [ ] 2.12 Build: `pnpm --filter @offisim/ui-office typecheck` to confirm component signature.

## 3. Refactor brand variants to consume SSOT (`office3d-brand-variants.tsx`)

- [ ] 3.1 Rewrite `DefaultBlockBody` as a thin wrapper: takes `outfitColor`, `skinTone`, `hairColor`, `accentColor`, `bodyType`, `gender`, `hairStyle`, `state`, `isBlocked`, `limbRefs`. Returns `<BlockCharacter params={...} variant='default' limbRefs={limbRefs} />`. Update all consumers' import paths if needed (export stays at the same named export).
- [ ] 3.2 Rewrite `HermesBody`: render `<BlockCharacter params={...} variant='shared-rig-only' limbRefs={limbRefs}>` wrapping the existing torso (`0.30 × 0.50 × 0.18` at y=0.75) + emblem strip + arms (already rig) + head + hood + halo. Brand variant arms have width `0.08`; pass `bodyType: 'slim'` factor to the shared rig OR keep brand-explicit arm meshes (decision: keep brand-explicit arm meshes inside `children`, set `variant='shared-rig-only'` to skip the SSOT's leg meshes, pass `limbRefs` to brand-authored arm meshes — this means HermesBody opts out of bodyType scaling entirely, matching today's behavior).
- [ ] 3.3 Rewrite `OpenClawBody`: same pattern. OpenClaw has invisible leg placeholders (`OpenClawBody:113-120`) — `variant='shared-rig-only'` plus brand-authored placeholders inside `children` keeps current behavior.
- [ ] 3.4 Rewrite `CodexBody`: same pattern. Codex has emissive ear pieces — keep them as `children`.
- [ ] 3.5 Rewrite `CustomBody`: same pattern. Custom is the catch-all external brand silhouette — keep it as today's mesh set, just nested inside `<BlockCharacter variant='shared-rig-only'>`.
- [ ] 3.6 Verify all 5 exports (`DefaultBlockBody`, `HermesBody`, `OpenClawBody`, `CodexBody`, `CustomBody`) keep their current named-export signature so no downstream import updates are needed in `office3d-employees.tsx` or `AppearanceTab.tsx`.
- [ ] 3.7 Add `// @ts-expect-error` only if R3F prop types complain on `children` passed to a JSX-producing component — should not be needed but covers an R3F edge case.

## 4. Wire renderers (`office3d-employees.tsx`)

- [ ] 4.1 In `office3d-employees.tsx`, update `LowPolyCharacter` to accept `params: BlockCharacterParams` instead of just `outfitColor` / `skinTone`. The `default` branch passes `params` through to `DefaultBlockBody`; brand branches discard most of `params` (brand variants don't customize per employee).
- [ ] 4.2 In `EmployeeMarker`, resolve all 3 colors via the helper trio: `outfit = resolveOutfitColor(seed, appearance)`, `skin = resolveSkinTone(seed, appearance)`, `hair = resolveHairColor(seed, appearance)`. Resolve `accent = resolveAccentColor(seed, appearance)` — add `resolveAccentColor` helper to `avatar-seed.ts` returning `numericToHex(appearance.clothingAccent)` if appearance present, else `outfitColorFromSeed('accent:' + seed)` (so seed-derived accent differs from outfit, giving unedited employees a deliberate accent).
- [ ] 4.3 Build the `BlockCharacterParams` from `appearance` (defaults: bodyType `'normal'`, gender `'neutral'`, hairStyle `'short'` if appearance is null) plus `state` from `agent.state` plus `isBlocked = isEmployeeBlocked(agent.state)`. Pass `params` to `LowPolyCharacter`.
- [ ] 4.4 In `office3d-brand-variants.tsx`, ensure `DefaultBlockBody` consumes `accentColor` from props — it was previously not in the signature.

## 5. LOD gate for HTML overlays (`useCharacterLod.ts`)

- [ ] 5.1 Create `packages/ui-office/src/hooks/useCharacterLod.ts` exporting `useCharacterLod(worldPos: [number, number, number], threshold?: number): { isFar: boolean }`. Default threshold `20`.
- [ ] 5.2 Implementation: `useThree()` for camera; `useState<boolean>(true)` for `isFar`; `useFrame()` body computes `camera.position.distanceTo(...)` and calls `setIsFar(d > threshold)` only on transitions (read previous state via ref to avoid setState every frame).
- [ ] 5.3 In `EmployeeMarker`, call `const { isFar } = useCharacterLod(emp.position)`. Gate three `<Html>` overlays:
  - selection name pill at `position={[0, 1.85, 0]}` — `{!isFar && isSelected && (<Html ...>{emp.agent.name}</Html>)}`
  - badge at `position={[0.48, 2.05, 0]}` — `{!isFar && badge && (<Html ...>...)}`
  - status bubble — `{!isFar && agent.state !== 'idle' && !isDragSource && (<StatusBubble3D .../>)}`
- [ ] 5.4 Verify: in 50-employee Office overview at default zoom, dev tools shows ≤5 mounted `<Html>` divs in DOM (typical: 0 since default zoom > 20 units away from all employees in standard plot).

## 6. AppearanceTab live preview (`AppearanceTab.tsx`)

- [ ] 6.1 Update `Preview3DCanvas` props interface from `{ isExternal, brandKey, outfitColor, skinTone }` to `{ isExternal, brandKey, appearance: AvatarAppearance, seed: string }`.
- [ ] 6.2 Inside `Preview3DCanvas`, resolve `outfit/skin/hair/accent` colors via the helper trio + `resolveAccentColor`. Build `BlockCharacterParams` with `state: 'idle'` (preview is always idle), `isBlocked: false`, full appearance fields.
- [ ] 6.3 Update `PreviewFigure` to take `BlockCharacterParams` and pass to `DefaultBlockBody` (which now requires the full param set per Section 3.1).
- [ ] 6.4 Update the call site in `AppearanceTab` to pass `appearance={formData.appearance}` and `seed={formData.name || 'preview'}`. Drop the now-unused `outfitColor` / `skinTone` resolution at the JSX call site (they happen inside `Preview3DCanvas`).
- [ ] 6.5 Increase preview canvas size from `256 × 200` to `280 × 220` to accommodate stocky body type without clipping. Update both `style={{ width, height }}` on `<Canvas>` and the parent `PreviewCard`'s flex `<div>` height (currently `200px`, bump to `220px`).
- [ ] 6.6 Verify scrubbing each customizer field flips the 3D preview within one frame: skin swatch → head/arms color, hair swatch → hair color, hair-style dropdown → hair geometry, body-type dropdown → torso/arm width, gender toggle → shoulder/hip ratio, clothing swatch → torso color, clothing accent swatch → vest color (or no vest if accent === clothing).

## 7. Customizer copy + ordering (`AvatarCustomizer.tsx`)

- [ ] 7.1 Remove the inline copy line at `AvatarCustomizer.tsx:121-123`: `<p className="mt-1 text-[10px] text-slate-500">Saved with the employee — visible trim arrives in an upcoming art pass.</p>`. Replace with empty (no message) since the accent now renders.
- [ ] 7.2 Optionally add a single-line label clarifier: `<p className="mt-1 text-[10px] text-slate-500">Renders as a vest accent panel.</p>` so the user knows where the color appears.
- [ ] 7.3 Confirm the customizer's `HAIR_STYLES` const at `AvatarCustomizer.tsx:35-44` matches the 8 styles in `BlockCharacterParams.hairStyle` — they should already match (`short, long, ponytail, curly, bald, bob, spiky, braids`).
- [ ] 7.4 Confirm `BODY_TYPES` at `AvatarCustomizer.tsx:46` is `['normal', 'slim', 'stocky']` — matches `BlockCharacterParams.bodyType`.
- [ ] 7.5 Confirm `GENDER_OPTIONS` at `AvatarCustomizer.tsx:48-52` produces values `'neutral' | 'masculine' | 'feminine'` — matches `BlockCharacterParams.gender`.

## 8. Spec sync within the change

- [ ] 8.1 Confirm `specs/character-3d-rendering/spec.md` (NEW) covers: SSOT `<BlockCharacter>` location and parameter set, the 3 helper `resolveOutfitColor` / `resolveSkinTone` / `resolveHairColor` / `resolveAccentColor` contract for 3D, eye+mouth presence on internal employees only, eye emissive state mapping, bodyType/gender/hairStyle/accent geometry rules, brand-variant boundary (variant `shared-rig-only`), LOD threshold, 2D ↔ 3D consistency contract.
- [ ] 8.2 Confirm `specs/personnel-appearance-live-preview/spec.md` (MODIFIED) replaces the "C1 scope is skin and clothing color only" requirement with a full-schema parity requirement and removes the "art pass" copy assertion.
- [ ] 8.3 Confirm `specs/avatar-seed-resolution/spec.md` (MODIFIED) updates `SKIN_TONES` count to ≥18, `OUTFIT_COLORS` count to ≥16, adds `HAIR_COLORS_SEED_PALETTE` ≥8, adds `resolveHairColor` requirement, updates the hash distribution requirement.

## 9. Build + verify gates (serial per CLAUDE.md)

- [ ] 9.1 `pnpm --filter @offisim/shared-types build` (no schema change but rebuild for hygiene).
- [ ] 9.2 `pnpm --filter @offisim/ui-core build`.
- [ ] 9.3 `pnpm --filter @offisim/core build`.
- [ ] 9.4 `pnpm --filter @offisim/ui-office build` — main change site; check for unused-import / unused-variable warnings related to brand variant rewrites.
- [ ] 9.5 `pnpm --filter @offisim/web typecheck`.
- [ ] 9.6 `pnpm --filter @offisim/web build`.
- [ ] 9.7 `pnpm --filter @offisim/ui-office typecheck` — strict check after main build, catch any post-build typing regressions.
- [ ] 9.8 `npx biome check .` — zero NEW errors (palette expansion adds large arrays — wrap with `// biome-ignore lint/...` if a Biome rule trips on the literal-heavy palette declarations; no other lint relaxation).
- [ ] 9.9 `pnpm --filter @offisim/desktop build` — release `.app` bundles with new figures. Confirm dist size delta vs main is in the `+30 KB to +60 KB` range as estimated.

## 10. Live verification (release `.app` only — main session does not drive Tauri)

> **Coverage status**: 3D rendering is a UI-layer concern. The harness layer (`packages/core/harness/`) covers graph / runtime invariants and does NOT cover R3F scene graph; therefore there is no harness scenario for this change. Live verification is mandatory.

- [ ] 10.1 Build release `.app` (Section 9.9). Open the bundle.
- [ ] 10.2 In Personnel page, create 6 employees with these explicit appearance combinations:
  | # | name | bodyType | gender | hairStyle | hairColor | clothingColor | clothingAccent | skinColor |
  |---|------|----------|--------|-----------|-----------|---------------|----------------|-----------|
  | 1 | Slim Masc Short | slim | masculine | short | black | blue | blue (= clothing → vest hidden) | light |
  | 2 | Slim Fem Braids | slim | feminine | braids | brown | red | amber | tan |
  | 3 | Norm Neut Bald | normal | neutral | bald | n/a | green | cyan | medium |
  | 4 | Stocky Masc Spiky | stocky | masculine | spiky | blue | orange | violet | dark |
  | 5 | Stocky Fem Bob | stocky | feminine | bob | blonde | purple | pink | fair |
  | 6 | Norm Masc Pony | normal | masculine | ponytail | gray | indigo | indigo (= clothing → vest hidden) | medium |
- [ ] 10.3 For each employee, in AppearanceTab observe the 3D preview shows the geometry/color combination matches the customizer state within one frame after each swatch/select change.
- [ ] 10.4 Switch to Office workspace. Observe all 6 employees in the rest zone (idle state). Confirm:
  - All 6 are visually distinguishable from a default overview camera distance.
  - Body type is readable from 25 units (slim torso visibly narrower than stocky).
  - Hair style is readable from 25 units (braids hang to sides, spiky points up, bob has wider sides).
  - Vest accent is visible on employees 2/4/5; hidden on 1/3/6 (3 has no vest because bald and accent=cyan ≠ outfit=green, so vest renders cyan and IS visible — adjust this row in the script).
  - Eye color is dim grey (idle state).
- [ ] 10.5 Trigger a task on employee #2 via boss-proxy chat (e.g. "Slim Fem Braids, please draft a memo"). When her state transitions to `executing`, observe her eyes light up with the cool blue emissive (`#1e88e5 @ 0.4`).
- [ ] 10.6 Wait for her state to transition to `reporting`. Observe eyes shift to cyan emissive (`#06b6d4 @ 0.5`).
- [ ] 10.7 Block an employee (block scenario via runtime if available; otherwise skip and flag as unverifiable in this build). When blocked, eyes should turn red (`#ef4444 @ 0.5`).
- [ ] 10.8 Compare 2D personnel rail row avatar vs 3D figure for each of the 6 employees. Confirm:
  - Skin color byte-equal (use Tauri dev tools color-picker on the rail avatar's skin region and on the 3D head; same `#RRGGBB`).
  - Hair color byte-equal in 2D and 3D (except bald in 3D, which has no hair to compare).
  - Outfit color byte-equal.
  - Eye axis: 2D DiceBear's eyes are symmetric about vertical center; 3D figure's eyes are at `±0.07` (also symmetric). Visual: yes, both look "looking forward."
- [ ] 10.9 Performance: with 50 employees in the office, default camera, open Tauri dev tools → Performance → record 5s. Confirm avg frame time ≤ 16.6ms (≥ 60 FPS). Zoom to 8-unit distance from a single employee (overlays visible), record again. Confirm ≥ 55 FPS. Note: on Apple Silicon Battery mode, 30+ FPS is acceptable per Decision 14.
- [ ] 10.10 Brand variant regression check: in Personnel, set one employee `is_external = true` with `brandKey = 'hermes'`. AppearanceTab should show the read-only "brand-managed" banner (no customizer). Office workspace: HermesBody should render in its full brand silhouette (hood, halo, narrow torso) — no eye/mouth additions, no vest accent, no schema-driven hair geometry.
- [ ] 10.11 Repeat 10.10 for `brandKey = 'openclaw'` and `brandKey = 'codex'` and `brandKey = 'custom'` (or a Hermes-style brand entry that exists). Confirm each brand variant renders unchanged from current main.
- [ ] 10.12 Hash distribution sanity check: create 16 employees with sequential names `Employee 1` through `Employee 16` using only seed-derived appearance (no manual customizer). Visually confirm all 16 have visibly distinct outfit colors (the new 16-entry palette + Knuth-prime hash should give 16 unique buckets in the no-collision case). If 2 collide, accept up to 2 collisions; >2 is a regression.

## 11. Spec / docs / memory sync (archive prep)

- [ ] 11.1 `openspec/CLAUDE.md` (this change's archive gate spec list) — confirm capability count: 1 NEW, 2 MODIFIED.
- [ ] 11.2 `packages/ui-office/CLAUDE.md` `UI / Scene / 3D` section — add a line referencing `character-mesh-builder.ts` as the SSOT for internal-employee block-character geometry; note that brand variants render `<BlockCharacter variant='shared-rig-only'>` and provide their own torso/head.
- [ ] 11.3 If the change is archived (`/opsx:archive`), fold `specs/character-3d-rendering/spec.md` into `openspec/specs/character-3d-rendering/spec.md` (NEW capability folder) and update the `personnel-appearance-live-preview` + `avatar-seed-resolution` canonical specs to reflect the modified requirements. Remove the deferred-art line from the canonical `personnel-appearance-live-preview`.
- [ ] 11.4 `MEMORY.md` — remove the "B1 Office 3D art pass" entry from "Open Issues (deferred)" section since this change covers it. Add an entry to "Active Backlog" only if any 1.0 limitation surfaces that we accept (none expected).
- [ ] 11.5 `openspec/protocols-ledger.md` — no protocol touch (R3F / Three.js are not protocol-tracked). Skip ledger update.
- [ ] 11.6 Commit message: `feat(scene): ship 3D character rendering 1.0 with full appearance schema`.
