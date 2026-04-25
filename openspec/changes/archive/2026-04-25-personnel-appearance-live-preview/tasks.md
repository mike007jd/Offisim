## 1. avatar-seed.ts foundation

- [x] 1.1 Add `HAIR_STYLE_TO_AVATAARS_TOP` table mapping the 8 Offisim `hairStyle` enums to `@dicebear/avataaars` `top` tokens per design Decision 3.
- [x] 1.2 Audit avataaars v9 schema: `skinColor` / `hairColor` accept hex (same as `clothesColor`); no enum-bucket mapping needed. Hair table maps to v9 tokens (`shortFlat`, `bob`, `bun`, `frizzle`, `fro`, `shortCurly`, `straight01`); `bald` pairs its mapped token with `topProbability: 0`.
- [x] 1.3 Add `resolveOutfitColor(employee, appearance?)` and `resolveSkinTone(employee, appearance?)`. When `appearance.<field>` is non-null, return the formatted hex; otherwise delegate to the existing seed-derived helpers.
- [x] 1.4 Add small `numericToHex(n: number): string` helper (zero-padded `#RRGGBB`) used by both resolvers and by the 2D config builder.
- [x] 1.5 Change `createOffisimAvatar(seed, size)` signature to `createOffisimAvatar(seed, size, appearance?)`. When `appearance` is undefined, behavior is byte-equivalent to today (existing seed-only path). When provided, build the `avataaars` config with `clothesColor`, `skinColor`, `hairColor`, and `top` derived per Decisions 2 & 3.
- [x] 1.6 Self-audit: `pnpm --filter @offisim/ui-office build` passes; grep for callers of `outfitColorFromSeed` / `skinToneFromSeed` and confirm the bridge constants stay exported (still needed by the resolvers as the fallback path).

## 2. 2D office canvas cache fingerprint

- [x] 2.1 Extend `office-2d-avatar-cache.ts` cache key from `${companyId}:dicebear:${seed}` to fold in a deterministic appearance fingerprint string (skinColor, hairColor, clothingColor, hairStyle joined with a separator; literal `none` when appearance absent).
- [x] 2.2 Update `getAvatarUri` (and any sibling helpers) to accept an optional `appearance` argument and pass it to `createOffisimAvatar`. Brand path (`:brand:` discriminator) is unchanged.
- [x] 2.3 Wire `use-scene-snapshot.ts` (or whichever caller loads avatars for the 2D canvas) to pass the persisted `EmployeeRow` appearance through.

## 3. AppearanceTab live surface

- [x] 3.1 Implement new `AppearanceTab.tsx` replacing the `PlaceholderTab` body. Read `editor.formData.appearance` and `editor.formData.isExternal` from the active `useEmployeeEditor`.
- [x] 3.2 Render two-region layout: left = `AvatarCustomizer` (existing component, unmodified contract — `config={formData.appearance}`, `onChange={cfg => editor.updateField('appearance', cfg)}`); right = stacked 2D preview + 3D R3F canvas.
- [x] 3.3 2D preview region: render `<DicebearAvatar>` at ~140px sized off `formData.appearance` via the new `createOffisimAvatar` signature. Re-render on `formData.appearance` change.
- [x] 3.4 3D preview region: built a small R3F canvas (256x200, transparent background) with one ambient + one directional light, ground plane, inline static block figure (separate from `office3d-employees`'s animated `LowPolyCharacter` so the preview keeps a true T-pose without breathing/ring animation). `<OrbitControls enableZoom={false} target={[0,0.9,0]} />` so users can orbit.
- [x] 3.5 External-employee branch: render the existing `data-testid="external-avatar-disabled"` banner in the left region; right region shows `BrandAvatar2D` (2D) + brand-variant body (3D) via the same v9-asset3dVariant lookup. Customizer does not mount.
- [x] 3.6 Empty-state branch: when `selectedEmployeeId === null`, render `TabSelectionEmpty` (matches Profile / Memory / History tabs).
- [x] 3.7 `<Suspense fallback={null}>` wraps the canvas children to match the office scene's R3F bootstrap pattern.

## 4. Move AvatarCustomizer out of Profile tab

- [x] 4.1 In `ProfileTab.tsx`, remove the `formData.isExternal ? <banner /> : <AvatarCustomizer />` block from the Identity section.
- [x] 4.2 Remove the `AvatarCustomizer` import from `ProfileTab.tsx`.
- [x] 4.3 Remove the `data-testid="external-avatar-disabled"` banner JSX from `ProfileTab.tsx` (it now lives only in `AppearanceTab`).
- [x] 4.4 Audit: grep `ProfileTab.tsx` for `AvatarCustomizer` / `external-avatar-disabled` — zero matches; the only `external-avatar-disabled` testid in the repo lives in `AppearanceTab.tsx`.

## 5. AvatarCustomizer copy update

- [x] 5.1 Added inline note under the `Clothing accent` `SwatchRow` ("Saved with the employee — visible trim arrives in an upcoming art pass."). Swatch row stays functional.

## 6. Internal-employee 2D rendering uses appearance

- [x] 6.1 `EmployeeAvatar.tsx`: reads `appearance` from `AgentState` (runtime field) or parses `persona_json` for DB-shape rows, and passes it to `DicebearAvatar`.
- [x] 6.2 `DicebearAvatar.tsx`: accepts optional `appearance` prop and forwards to `createOffisimAvatar(seed, size, appearance)`. Existing call sites without appearance keep working unchanged.
- [x] 6.3 `AgentState` now carries `appearance: EmployeeAppearance | null` and `persona_json: string | null`. `buildAgentStateMap` parses persona_json once; the `employee.created` and `employee.updated` event handlers refetch the row to pick up appearance changes after save (the event payload doesn't carry persona).
- [x] 6.4 Existing `<EmployeeAvatar>` call sites all pass a row with `persona_json` (PersonnelPage list rail / DetailHeader, AgentCard, EmployeeInspector, TeamHealthCard); no prop signatures changed.

## 7. Internal-employee 3D rendering uses appearance

- [x] 7.1 `EmployeeMarker` now derives `outfit = resolveOutfitColor(...)` / `skin = resolveSkinTone(...)` from `emp.agent.appearance` — `appearance.clothingColor` / `skinColor` win, seed is fallback.
- [x] 7.2 `AgentState` carries parsed `appearance`; `usePlacedEmployees` passes the agent through unchanged.
- [x] 7.3 Brand-variant branch unchanged — external employees keep brand-variant body, no color props.
- [x] 7.4 No geometry changes for `bodyType` / `hairStyle` / `gender` in 3D; deferred to GPT 5.5 art pass per spec.

## 8. Self-audit

- [x] 8.1 Serial build chain green: `shared-types → ui-core → core → ui-office → web` all pass.
- [x] 8.2 `pnpm typecheck` — 26/26 tasks successful.
- [x] 8.3 `pnpm lint` — no new errors in any file touched by this change (167 pre-existing lint errors live in unrelated files: install / skill / tauri-engine adapters / etc.).
- [x] 8.4 Grep audit clean: zero `AvatarCustomizer` in `ProfileTab.tsx`; only `AvatarCustomizer` import outside the customizer file is in `AppearanceTab.tsx`; only `external-avatar-disabled` testid in repo lives in `AppearanceTab.tsx`.

## 9. Live verify (web)

Use chrome-devtools-mcp on `localhost:5176` after `cd apps/web && pnpm dev`. Each step takes a snapshot or screenshot and observes — no automated assertions.

- [x] 9.1 PASS — Personnel → Alex Chen → Appearance: customizer left, 2D DiceBear (140px naturalWidth, valid data URI), 3D R3F canvas (254×200 native / 508×400 backbuffer @ DPR 2x, WebGL2). 1 canvas mounted total.
- [x] 9.2 PASS — Skin tone Dark click → 2D DiceBear src now contains `6b3f2a`; 3D head pixel reads RGB(48,19,9) — lit ratio 2.5:1:0.5 matches source `#6b3f2a` = (107,63,42). Both surfaces moved together, no save fired.
- [x] 9.3 PASS — Clothing color Red → 2D contains `ef4444`, 3D torso center reads RGB(161,17,30) — lit `#ef4444`. Lockstep update.
- [x] 9.4 PASS — Hair style Bob → 2D SVG length 7021→6403 bytes (different `top` shape); 3D centerline pixel fingerprint byte-identical pre/post Bob. 3D differentiation deferred per spec.
- [x] 9.5 PASS — Body type → Stocky: 2D unchanged (no avataaars body axis), 3D fingerprint byte-identical. Form value persists (Radix combobox shows "Stocky").
- [x] 9.6 PASS — Clothing accent Cyan → 2D src length unchanged (6403→6403), 3D unchanged. Deferred-art note visible: "Saved with the employee — visible trim arrives in an upcoming art pass."
- [x] 9.7 PASS — Save → list rail Alex Chen avatar (32px) contains both `ef4444` and `6b3f2a`; detail header (120px) same. Office 3D scene: 271 red-shirt pixels (R-dominant 3:1) + 3257 dark-skin pixels (warm-brown gradient) found, indicating EmployeeMarker rendered with the new colors via AgentState.appearance refetched by `employee.updated` handler.
- [x] 9.8 PASS — Office 2D toggle: 2d-context canvas readback found 132 red-shirt + 100 dark-skin pixels (raw hex match — 2D DiceBear is unlit). `office-2d-avatar-cache` fingerprint invalidated and regenerated.
- [-] 9.9 DEFERRED — current company seed has no external employees. Code path verified by static inspection: `AppearanceTab.tsx` `isExternal ? <banner /> : <AvatarCustomizer />` + `external-avatar-disabled` testid + `<BrandAvatar2D>` + brand-variant `<HermesBody>` / `<OpenClawBody>` / `<CodexBody>` / `<CustomBody>` 3D fallback wired identically to the C0-archived external-employee dispatch path. Live verify deferred until a brand row is installed (will be re-checked during Tauri release verify or any future external-employee seed).
- [x] 9.10 PARTIAL PASS — Internal Profile (Maya Lin): no `AvatarCustomizer`, no `external-avatar-disabled` banner, identity/persona/config render. External half deferred with 9.9.
- [x] 9.11 PASS for the persisted-render path — Maya Lin (no `appearance` in persona_json): list rail 32px avatar SVG contains `#3b82f6` (seed-derived clothes) + `#d08b5b` (seed-derived skin bucket); does NOT contain `#4a90d9` (DEFAULT_APPEARANCE clothing). 3D preview canvas torso = RGB(20,87,146) (B-dominant, lit `#3b82f6`). The Appearance *preview pane* shows DEFAULT_APPEARANCE colors because `useEmployeeEditor` seeds `formData.appearance = DEFAULT_APPEARANCE` when persona lacks the field — design.md Risk #4 mitigation (appearance-present-wins-after-save), preview shows the proposed save state, persisted surfaces stay seed-derived until save.

## 10. Live verify (desktop release)

- [-] 10.1 DEFERRED — desktop release bundle not built in this session. Web live verify covered the full code path; Tauri shell uses the identical `db-local` repo + `parseEmployeePersona` logic, so persona round-trip is byte-equivalent. Deferred to a follow-up session if smoke-on-Tauri evidence is required before archive.
- [-] 10.2 DEFERRED with 10.1.
- [-] 10.3 OBSERVED clean on web — 1 WebGL2 context per Appearance tab visit, no `crashCountRef` console warning fired. Tauri-specific WebGL stress not retested in this session.

## 11. Sync canonical specs and archive prep

- [ ] 11.1 After live verify passes, run `/opsx:archive` (which copies the change `specs/<capability>/spec.md` deltas into `openspec/specs/<capability>/spec.md` per the gate).
- [ ] 11.2 Run the Archive Gate three checks (CLAUDE.md): (a) spec consistency, (b) tasks consistency (every `[x]` truly done with verify evidence), (c) docs/comments consistency. No changes to `protocols-ledger.md` are expected for this change.
- [ ] 11.3 Update memory: add C1 archive entry to `MEMORY.md` Next Change Queue; update `project_ux_overhaul_queue.md` C1 status to `[x] archived` with the archive commit SHA; flag the GPT 5.5 follow-up (3D differentiation + clothingAccent wiring) explicitly so it's not lost.
