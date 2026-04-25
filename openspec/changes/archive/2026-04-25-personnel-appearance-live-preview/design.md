## Context

`AvatarCustomizer` was wired into the C0 Personnel Profile tab one-for-one from the retired `EmployeeEditorDialog`. It writes seven appearance fields (`skinColor`, `hairColor`, `hairStyle`, `clothingColor`, `clothingAccent`, `gender`, `bodyType`) into `formData.appearance` → `persona_json.appearance`, which the editor save path persists. **No renderer reads any of these fields.** Two pipes drive every employee avatar today:

- 2D: `createOffisimAvatar(seed, size)` in `packages/ui-office/src/lib/avatar-seed.ts` — calls `createAvatar(avataaars, { seed, size, clothesColor: [outfitColorFromSeed(seed).slice(1)] })`. Skin / hair / gender are randomized by DiceBear from the seed.
- 3D: `EmployeeMarker` in `packages/ui-office/src/components/scene/office3d-employees.tsx` — calls `outfitColorFromSeed(emp.seed)` and `skinToneFromSeed(emp.seed)` and feeds them to the `default` variant `LowPolyCharacter`. External brand variants (Hermes / OpenClaw / Codex / Custom) take no color props.

CLAUDE.md describes `outfitColorFromSeed(seed)` as the SSOT bridge between the two engines and the canonical spec `avatar-seed-resolution` enforces it. C1 changes that contract: appearance fields, when present, become the source of truth, and the seed-derived value becomes the fallback. The bridge stays — it just has a higher priority layer in front of it.

The Appearance tab itself is currently a `PlaceholderTab`. C0 explicitly deferred this surface to C1.

External employees (`is_external === 1`) keep their brand renderers (`BrandAvatar2D`, brand-variant 3D bodies). Their Profile tab already shows a read-only "brand-managed avatar" banner — that branch stays unchanged in this change.

## Goals / Non-Goals

**Goals:**

- Appearance customization actually changes how an employee looks, everywhere they appear (Personnel list rail, detail header, Office 2D canvas, Office 3D scene, chat avatars, any other `EmployeeAvatar` consumer).
- The Appearance tab gives a left-controls / right-preview surface that updates the 2D and 3D preview live as the user moves swatches, without saving — so the user sees the result before committing.
- Save round-trip stays the same (`useEmployeeEditor.save()` writes `persona_json.appearance`, `employee.*` events fan out, downstream consumers re-render from the new persisted row).
- The seed-only contract in `avatar-seed-resolution` becomes a fallback; existing employees with no `appearance` field render byte-identical to today.

**Non-Goals:**

- 3D block-figure differentiation by `hairStyle` / `bodyType` / `gender` / `clothingAccent`. The schema fields persist; their 3D visual is delivered by a follow-up art pass (GPT 5.5).
- Reworking external brand renderers. Brand avatars stay opaque.
- Schema / DB migration. `persona_json.appearance` already round-trips through `parseEmployeePersona` and the editor.
- Adding any new appearance fields. Existing seven stay.
- Animating the preview canvas idle (no walking / breathing). Static T-pose with mouse orbit on hover is sufficient.

## Decisions

### Decision 1: appearance fields become primary, seed becomes fallback (Q1=b)

`avatar-seed.ts` grows two helper functions that wrap the existing seed math:

```
resolveOutfitColor(employee, appearance?)
  → appearance?.clothingColor
       ? hexFromNumeric(appearance.clothingColor)
       : outfitColorFromSeed(resolveAvatarSeed(employee))

resolveSkinTone(employee, appearance?)
  → appearance?.skinColor
       ? hexFromNumeric(appearance.skinColor)
       : skinToneFromSeed(resolveAvatarSeed(employee))
```

`outfitColorFromSeed` / `skinToneFromSeed` stay exported (still used as the fallback path). Direct seed-only call sites in `EmployeeMarker`, `office-2d-avatar-cache`, `use-scene-snapshot` migrate to the new resolvers. The two-engine bridge stays — when an employee has no appearance saved (legacy data, freshly created), 2D shirt and 3D body still match byte-for-byte from the same seed.

**Alternative considered:** keep the seed-derived value as a hidden default INSIDE `formData.appearance` (i.e. seed each new employee's `appearance.clothingColor` to `outfitColorFromSeed(seed)` at create time). Rejected: writes bytes into the DB that the user didn't choose, makes it impossible to tell "no preference" from "explicitly blue", and double-locks the seed bridge. The "appearance present → win, absent → fall through" rule is cleaner.

### Decision 2: `createOffisimAvatar(seed, size, appearance?)` signature change

The 2D entry point gains an optional appearance parameter. When provided, the `avataaars` config gets:

- `clothesColor: [hex(appearance.clothingColor).slice(1)]` (existing path; just sourced from appearance instead of seed)
- `skinColor: [hex(appearance.skinColor).slice(1)]` (new — `avataaars` v9 accepts a 6-char hex array)
- `hairColor: [hex(appearance.hairColor).slice(1)]` (new — same hex pattern)
- `top: [mapHairStyleToAvataaarsTop(appearance.hairStyle)]` (new — see Decision 3) and `topProbability: 0` when `appearance.hairStyle === 'bald'`

When `appearance` is omitted, behavior is byte-equivalent to today.

**Note (avataaars 9.x reality):** Earlier drafts assumed `skinColor` was an enum (`pale`/`darkBrown`/etc.). The shipped library version accepts a hex pattern (`^[a-fA-F0-9]{6}$`) for `skinColor` *and* `hairColor`, the same way `clothesColor` already does. So no enum-bucket mapping is needed — the three numeric appearance fields fold to hex via a single shared helper.

`top` *does* take an enum (34 v9 tokens: `bob`, `bun`, `curly`, `frizzle`, `fro`, `shortFlat`, `shortCurly`, `straight01`, …). There is no `noHair` token; "bald" is expressed by setting `topProbability: 0`.

**Alternative considered:** overlay color via inline SVG post-processing. Rejected: brittle and fights the library; v9's hex acceptance for `skinColor` / `hairColor` makes overlay unnecessary.

### Decision 3: `hairStyle` enum mapping (Q1 in pre-propose dialogue)

Existing 8 enum values: `short / long / ponytail / curly / bald / bob / spiky / braids`.

`avataaars` v9 `top` enum (subset relevant to us): `bob`, `bun`, `curly`, `curvy`, `dreads`, `fro`, `froBand`, `longButNotTooLong`, `straight01`, `straight02`, `straightAndStrand`, `frizzle`, `shortCurly`, `shortFlat`, `shortRound`, `shortWaved`, `theCaesar`, `bigHair`, etc. There is no `noHair`; bald is `topProbability: 0`.

Mapping (kept in a single `HAIR_STYLE_TO_AVATAARS_TOP` table in `avatar-seed.ts`):

| Offisim `hairStyle` | `avataaars` v9 `top` |
| --- | --- |
| `short`     | `shortFlat` |
| `long`      | `straight01` |
| `ponytail`  | `bun` |
| `curly`     | `shortCurly` |
| `bald`      | `shortFlat` (paired with `topProbability: 0`) |
| `bob`       | `bob` |
| `spiky`     | `frizzle` |
| `braids`    | `fro` |

The mapping is a pure function. Easy to swap entries later without breaking the surface. `gender` is not consumed by 2D (DiceBear avataaars has no gender axis — outfit/hair already cover the perceived signal); keeping the field in schema only.

**Alternative considered:** drop the Offisim enum and store the `avataaars` `top` token directly. Rejected: ties our DB schema to a vendor enum that may change versions; mapping layer is the right level of indirection.

### Decision 4: 3D consumes only `skinColor` + `clothingColor` in C1 (Q2)

`LowPolyCharacter` `default` variant receives `outfitColor` + `skinTone` props from the resolved values. `hairStyle`, `bodyType`, `gender`, `clothingAccent` are not visualized by C1's 3D path. They persist; the GPT 5.5 art follow-up will revisit the block figure to add hair geometry, body proportions, and trim color.

The `CustomBody` / brand-variant bodies stay frozen — they're external-employee surfaces and have no relationship to internal employee customization.

### Decision 5: Live preview surface in `AppearanceTab`

`AppearanceTab` becomes a real component with this layout (right pane of the Personnel page):

```
┌───────────── Appearance tab ─────────────┐
│ ┌── left controls ──┐ ┌── right preview ─┐│
│ │ AvatarCustomizer  │ │ 2D DiceBear (~140)││
│ │ (existing form,   │ │ ────────────────  ││
│ │  unmodified)      │ │ 3D R3F canvas     ││
│ │                   │ │ (orbit camera,    ││
│ │                   │ │  static T-pose)   ││
│ └───────────────────┘ └───────────────────┘│
└────────────────────────────────────────────┘
```

The customizer drives `editor.formData.appearance` via `editor.updateField('appearance', cfg)` — same writes it does today inside Profile. Both preview panes subscribe to `editor.formData.appearance` and re-render synchronously on each change. **No save round-trip** for the preview to reflect changes — the live read is from the in-memory edit buffer, not the persisted row.

When `formData.isExternal` is true, the customizer is replaced by the existing `data-testid="external-avatar-disabled"` banner copy and the right pane shows the brand-managed avatar (read-only). This matches the Profile-tab branch we replace.

The existing AvatarCustomizer block in `ProfileTab.tsx` is removed (Identity section's `formData.isExternal ? banner : <AvatarCustomizer />` block goes). External-employee read-only banner *also* moves out of Profile (since it was the appearance branch). Profile keeps name / role / status / workstation / persona / config / tools — i.e. all *non-appearance* fields.

### Decision 6: 2D office canvas cache key extension

`office-2d-avatar-cache.ts` currently keys cached SVGs by `${companyId}:${seed}` (and a `:dicebear:` / `:brand:` discriminator from a prior change). Once the SVG can vary per employee's appearance, the cache key SHALL fold in the consumed appearance bytes:

```
key = `${companyId}:dicebear:${seed}:${appearanceFingerprint}`
appearanceFingerprint = `${skinColor}-${hairColor}-${clothesColor}-${hairStyle}` (or `none` when appearance is absent)
```

That keeps cache hits high for an employee whose appearance hasn't changed, and invalidates only when the actual consumed bytes shift. Brand keys are unaffected.

When an employee saves new appearance bytes, the cache entry under the old fingerprint is left to GC; the new fingerprint cold-loads once. Office canvas re-renders on `employee.*` event subscription as today.

### Decision 7: live propagation strategy — preview reads buffer, scenes read row

- The Appearance tab preview reads from `editor.formData.appearance` (live, every keystroke).
- The Personnel list rail / detail header / 2D canvas / 3D scene read from the persisted `EmployeeRow.persona_json` (post-save), the way they read every other employee field today. They subscribe to `eventBus.on('employee', ...)` exactly as they do today.

So the user's experience is: change a swatch → preview updates instantly; click Save → list / detail / scenes update on the next event tick.

**Alternative considered:** push the unsaved appearance into a global "live preview" channel so the office scene also previews mid-edit. Rejected: too much surface area; dirties the SSOT model; the preview pane already shows the live result.

### Decision 8: clothingAccent stays in schema, not wired in C1 (Q3)

Customizer keeps the `Clothing accent` swatch row. Renderers (2D + 3D) ignore it for now. We tag the row with copy noting "applied to trim in upcoming art pass" so users don't think it's broken. Schema field persists. GPT 5.5 art follow-up wires it (3D belt / trim / hat band, 2D `clothesGraphicType` or `accessoriesType`).

**Alternative considered:** delete the swatch and the field. Rejected: would require a migration to strip the field from existing `persona_json` blobs, and re-introducing it later costs another migration. Cheaper to keep it dormant.

## Risks / Trade-offs

- [DiceBear enum mapping is opinionated] → 5 numeric `SKIN_COLORS` can't perfectly cover `avataaars`'s skin enum buckets, and the `hairStyle` table is a judgment call. **Mitigation:** centralize both maps in `avatar-seed.ts`; add scenarios in spec asserting the canonical mapping; if a user reports a mismatch, edit the table in one place and the change propagates.
- [3D preview canvas perf] → mounting a separate R3F canvas in the Appearance tab is a second WebGL context. Most browsers cap at 8–16 contexts; users with the 3D office scene already mounted are at 1; the preview makes 2. **Mitigation:** the preview canvas is small (256x320), uses a minimal scene (one ambient light, one directional, ground plane, the figure), and unmounts when the user leaves the Appearance tab. The 3D office scene already has a `crashCountRef` 2D fallback if WebGL contexts run out — that safety net protects the office, not the preview.
- [appearance change re-renders 2D office canvas] → on save, the `office-2d-avatar-cache` invalidates one entry; the canvas redraws that single employee. No global blast radius. **Mitigation:** cache key is per-employee-fingerprint, so other employees' cache entries are untouched.
- [legacy employees show as "blue/light" by default] → existing rows have `appearance: DEFAULT_APPEARANCE` baked in (the editor seeds it). That default's hardcoded `clothingColor: 0x3b82f6` may not match seed-derived blue for every employee. **Mitigation:** the resolver checks **whether the employee's `persona_json` has an `appearance` field at all**, not whether it's set to defaults. Strategy: a `persona_json` whose serialized form is missing the `appearance` key uses seed-fallback; one with an `appearance` key (even if all fields equal the defaults) uses appearance values. The `parseEmployeePersona` helper preserves this distinction. New employees created after C1 explicitly carry the user's chosen colors.
- [external employee branch double-disables] → the customizer + preview both need to know `isExternal`. **Mitigation:** `AppearanceTab` reads `editor.formData.isExternal` (existing field) and renders the disabled banner + brand SVG preview accordingly. Single source.
- [test coverage] → repo has no automated tests; live verify is the only gate. **Mitigation:** tasks.md defines per-surface live-verify steps for desktop release + web dev (chrome-devtools-mcp): change each field, observe each surface, screenshot diffs.

## Migration Plan

No DB migration. Pure code refactor + new component. Steps:

1. Land `avatar-seed.ts` resolvers + signature change + enum maps. Existing call sites pass `undefined` appearance — byte-equivalent behavior.
2. Build new `AppearanceTab` surface and remove `AvatarCustomizer` from `ProfileTab`. Personnel surface lights up the new tab.
3. Migrate `EmployeeMarker`, `EmployeeAvatar`, `office-2d-avatar-cache`, list rows, detail header, chat avatar to feed appearance through to the resolvers.
4. Live verify per tasks.md.

Rollback: revert the change set (single-PR scope). DB rows that were saved during C1 will still parse — the appearance bytes are valid on the previous code path; they'll just be ignored again.

## Open Questions

- None blocking. The GPT 5.5 art follow-up captures the deferred 3D differentiation; clothingAccent wiring is owned by that work.
