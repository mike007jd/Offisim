## Why

C0 promoted Personnel to a peer workspace with an `Appearance` tab as a placeholder. Today the `AvatarCustomizer` form already writes `formData.appearance` (skinColor / hairColor / hairStyle / clothingColor / clothingAccent / gender / bodyType) to `persona_json` and persists it — but **nothing reads those fields**. 2D DiceBear renders only from `seed`; 3D `LowPolyCharacter` reads `outfitColorFromSeed(seed)` / `skinToneFromSeed(seed)`. The customization UI is dead: users change colors, save, see no effect anywhere. C1 closes this loop and gives the Appearance tab a live 2D + 3D preview surface.

## What Changes

- Move `AvatarCustomizer` from the `Profile` tab Identity section into the `Appearance` tab as the left rail.
- Add a right rail in `Appearance` tab with two stacked previews: live 2D DiceBear avatar (top) and live 3D `LowPolyCharacter` R3F canvas (bottom). Both subscribe to `formData.appearance` and re-render on every field change without round-tripping through save.
- Rewrite `createOffisimAvatar(seed, size)` → `createOffisimAvatar(seed, size, appearance?)`. When `appearance` is provided, DiceBear `avataaars` consumes its `skinColor`, `hairColor`, `clothesColor`, and a `hairStyle → topType` mapping. When absent, falls back to current seed-only behavior.
- Rewrite outfit / skin color resolution: introduce `resolveOutfitColor(employee, appearance?)` and `resolveSkinTone(employee, appearance?)` in `avatar-seed.ts`. Appearance values win when present; seed-derived value is the fallback. Existing callers (`outfitColorFromSeed` / `skinToneFromSeed` / direct seed math in `EmployeeMarker`, `office-2d-avatar-cache`) migrate to the new helpers.
- 3D `LowPolyCharacter` (`default` variant only) consumes resolved `skinTone` + `outfitColor`; `hairStyle` / `bodyType` / `gender` differentiation in 3D is **explicitly out of scope** — flagged as follow-up for GPT 5.5 to do as block-figure art work. External brand-variant bodies (Hermes / OpenClaw / Codex / Custom) stay untouched.
- `clothingAccent` field stays in schema but is **not** wired to renderers in this change (3D trim / 2D accessory color is part of the same GPT 5.5 art follow-up). Customizer keeps the swatch, with copy noting it lands with the 3D art pass.
- `office-2d-avatar-cache` cache key extends from `${companyId}:${seed}` to a deterministic key that folds in the appearance fields actually consumed (skin / hair / clothes / hairStyle); cache invalidates when an employee's appearance changes.
- All employee surfaces (`EmployeeAvatar` 2D, `EmployeeMarker` 3D, list rows in PersonnelPage, `DetailHeader`, Office 2D canvas, chat avatars) feed `appearance` through to the renderers — appearance changes propagate everywhere immediately, not just inside the preview tab.
- External employee branch (`is_external === 1`) is unchanged — brand SVG / brand-variant 3D body are byte-identical pre/post.
- `personnel-workspace-surface` "Appearance tab is placeholder shell" requirement is split out: Appearance is now functional; Runtime + Skills remain placeholders.

## Capabilities

### New Capabilities

- `personnel-appearance-live-preview`: Live 2D + 3D preview pair inside the Appearance tab, the contract for `formData.appearance` being the authoritative customization source, and the cross-surface propagation rule.

### Modified Capabilities

- `avatar-seed-resolution`: Color-resolution requirements move from "derive from seed" to "appearance fields win, seed is fallback". `createOffisimAvatar` signature gains an optional `appearance` parameter. Avatar cache key extends to fold in consumed appearance fields.
- `personnel-workspace-surface`: "Appearance, Runtime, Skills tabs are placeholder shells" requirement is narrowed — Appearance is now functional, Runtime / Skills remain placeholders. Profile tab no longer hosts `AvatarCustomizer`; the customizer lives only in the Appearance tab.

## Impact

- **Code touched**:
  - `packages/ui-office/src/lib/avatar-seed.ts` — signature changes, two new resolver helpers
  - `packages/ui-office/src/components/employees/AvatarCustomizer.tsx` — copy update for `clothingAccent` (deferred-to-art note)
  - `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx` — placeholder → real surface
  - `packages/ui-office/src/components/employees/personnel-tabs/ProfileTab.tsx` — remove AvatarCustomizer block
  - `packages/ui-office/src/components/shared/EmployeeAvatar.tsx` + `DicebearAvatar.tsx` — pass appearance through
  - `packages/ui-office/src/components/scene/office3d-employees.tsx` — `EmployeeMarker` reads appearance
  - `packages/ui-office/src/lib/office-2d-avatar-cache.ts` — cache key extension
  - Possibly `packages/ui-office/src/components/scene/use-scene-snapshot.ts` (2D canvas avatar load path)
- **Schema**: no DB migration. `persona_json.appearance` already persists.
- **External employees**: unaffected — external branch keeps brand renderers.
- **Performance**: 2D DiceBear regeneration on appearance change is sub-frame for a single employee (preview); office 2D canvas cache invalidation runs once per save, not per keystroke (debounced or save-gated to keep the office scene calm during edits).
- **Out of scope (follow-up for GPT 5.5)**: 3D block-figure hairStyle / bodyType / gender / clothingAccent visual differentiation. Schema fields persist today; renderers will start consuming them in that follow-up change.
