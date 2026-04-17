## 1. Phase 0 — DiceBear option schema verification

- [ ] 1.1 Read `node_modules/@dicebear/avataaars@9.4.2` schema / types (search for `clothingColor` option declaration in `lib/schema.json` or equivalent types file); confirm option exists, typed as `string[]`, and documented as lockable via single-element array
- [ ] 1.2 **Live probe**: boot web dev (`apps/web` @ port 5176) + Chrome DevTools MCP; in page context call `createAvatar(avataaars, { seed: 'test-probe', size: 64, clothingColor: ['3b82f6'] }).toDataUri()` and decode the generated SVG to verify the shirt fill is `#3b82f6` (single-element array = locked color)
- [ ] 1.3 If Phase 0 probes confirm `clothingColor` lockable → proceed Phase 1+2 full scope; if option unavailable or behavior divergent → **降级 scope** to Phase 2 (palette merge) + Phase 3 (docs) only, note降级 in verification.md

## 2. Phase 1 — 2D DiceBear `clothingColor` bridge

- [ ] 2.1 Add `OUTFIT_COLORS_NUMERIC: readonly number[]` and `OUTFIT_LABELS: readonly string[]` exports to `packages/ui-office/src/lib/avatar-seed.ts`; `OUTFIT_COLORS_NUMERIC` = `OUTFIT_COLORS.map(hex => parseInt(hex.slice(1), 16))`; `OUTFIT_LABELS` = `['Blue', 'Purple', 'Green', 'Indigo', 'Orange', 'Red', 'Cyan', 'Amber']` (matching `OUTFIT_COLORS` index order)
- [ ] 2.2 Update `packages/ui-office/src/components/scene/office-2d-avatar-cache.ts`: import `outfitColorFromSeed` from `avatar-seed`; in `getAvatarUri(seed, companyId)` pass `clothingColor: [outfitColorFromSeed(seed).slice(1)]` as a 4th option to `createAvatar(avataaars, {...})`
- [ ] 2.3 Update `packages/ui-office/src/components/shared/DicebearAvatar.tsx`: import `outfitColorFromSeed` from `avatar-seed`; in the `useMemo` compute `const clothingHex = outfitColorFromSeed(seed).slice(1)` and pass `clothingColor: [clothingHex]` to `createAvatar`
- [ ] 2.4 Verify `resolveAvatarSeed` contract is used (not raw `agent.name`): `Office2DCanvasView.tsx:140,382` already calls `resolveAvatarSeed(agent)` and hands the resolved seed to `getAvatarUri`; `DicebearAvatar` callers pass `seed: resolveAvatarSeed(employee)` where applicable (grep callers in `ChatPanel` / `TeamHealthCard` / `EmployeeInspector` / `AgentCard` / `EmployeeCreatorOverlay` / `company-creation-wizard-data` and fix any that pass raw `.name`)

## 3. Phase 2 — AvatarCustomizer palette cleanup

- [ ] 3.1 Update `packages/ui-office/src/components/employees/AvatarCustomizer.tsx`: replace the hard-coded `CLOTHING_COLORS` array with a derivation from the newly exported `OUTFIT_COLORS_NUMERIC` + `OUTFIT_LABELS`:
      ```ts
      const CLOTHING_COLORS: { value: number; label: string }[] =
        OUTFIT_COLORS_NUMERIC.map((value, i) => ({ value, label: OUTFIT_LABELS[i] ?? `Color ${i + 1}` }));
      ```
- [ ] 3.2 Add a comment above `SKIN_COLORS` (and `HAIR_COLORS`) in `AvatarCustomizer.tsx` documenting that these are manual-config palettes independent from seed-derived `SKIN_TONES` in `avatar-seed.ts`
- [ ] 3.3 Live check: does any persisted `persona_json.avatarAppearance.clothingColor` in the current dev DB hold a value NOT in the new `OUTFIT_COLORS_NUMERIC` set? Sample via `repos.employees.findByCompany(...)` or in-browser IndexedDB; if yes, decide drop-vs-keep per MEMORY.md "pre-launch 脏数据清掉不写 migration" nursery rule

## 4. Phase 3 — Stale documentation cleanup

- [ ] 4.1 Update `CLAUDE.md` line 189 bullet: replace the stale "3D 员工外观 (`office3d-employees.tsx` 硬编码 `OUTFIT_COLORS / SKIN_TONES`) 与 2D DiceBear 头像 **不同源**" description with the current reality: "2D DiceBear 卡通头像和 3D 块人是两种渲染引擎；衣服色通过 `outfitColorFromSeed(seed)` 桥接（2D 的 shirt 色 = 3D 的 body 色，hex 字节等价），其他部件（发型 / 脸 / 配饰）由 DiceBear 自 seed 独立派生"
- [ ] 4.2 Update `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md` Open Issue line "3D↔2D avatar 视觉割裂" to reflect the post-change state (衣服色已桥接；其余部件风格差异保持 DiceBear 多样性，属产品选择)

## 5. Phase 4 — Build and typecheck

- [ ] 5.1 `pnpm --filter @offisim/shared-types build` — clean (no schema change expected)
- [ ] 5.2 `pnpm --filter @offisim/core build` — clean
- [ ] 5.3 `pnpm --filter @offisim/ui-office build` — clean
- [ ] 5.4 `pnpm --filter @offisim/web build` — clean
- [ ] 5.5 `pnpm typecheck` — all packages green (serial order: shared-types → core → ui-office → web)

## 6. Phase 5 — Live verification on web runtime

- [ ] 6.1 Web dev running (`apps/web` @ 5176) with Chrome DevTools MCP attached; default company "My AI Company" + 8 employees visible
- [ ] 6.2 **2D chat avatar color extraction**: in the chat panel (right rail), pick one employee's DicebearAvatar (e.g. "Alex Chen" in direct chat header); via `evaluate_script` decode the `img.src` data URI → parse SVG → locate the clothing/shirt `<path>` element and extract its `fill`; confirm the hex value equals `outfitColorFromSeed('Alex Chen')` output (expected: first element of `OUTFIT_COLORS` set, deterministic per djb2 hash)
- [ ] 6.3 **3D body color match**: switch to 3D office view; via `window.__OFFISIM_DEBUG__.getSceneState()` or equivalent introspection get the same employee's 3D block-figure body mesh color; confirm byte-identical to step 6.2
- [ ] 6.4 **8-employee coverage**: iterate all 8 default employees (`Alex Chen` / `Maya Lin` / `Marcus Johnson` / `Kai Nakamura` / `Sophie Park` / `Ryan Torres` / `Zara Okafor` / `Jamie Reeves`); log each 2D shirt hex vs 3D body hex; confirm all 8 pairs equal
- [ ] 6.5 **View switch round-trip**: 2D → 3D → 2D for the same employee; confirm avatar shirt color does not flicker / change mid-transition; LRU cache behaves (no unexpected regenerate)
- [ ] 6.6 **Customizer verification**: open EmployeeCreatorOverlay (ADD EMPLOYEE button), expand AvatarCustomizer; verify the Clothing swatches show 8 colors matching `OUTFIT_COLORS_NUMERIC` visual hex, labels match `['Blue', 'Purple', 'Green', 'Indigo', 'Orange', 'Red', 'Cyan', 'Amber']`
- [ ] 6.7 **Regression — onboarding / team / dashboard surfaces**: verify DicebearAvatar usages in `TeamHealthCard` / `EmployeeInspector` / `AgentCard` / `company-creation-wizard-data` all render without visual breakage (no missing shirts, no palette mismatch)
- [ ] 6.8 No new console errors / warnings during the verification flow (`list_console_messages types=[error,warn]`)

## 7. Phase 6 — Verification doc and finalization

- [ ] 7.1 Write `verification.md` in the change dir: Phase 0 DiceBear schema findings + live probe result + 降级 decision (if any); Phase 4 build chain result; Phase 5 live color-match evidence (per-employee hex pairs table); any follow-ups
- [ ] 7.2 `openspec validate align-dicebear-outfit-color` — clean
- [ ] 7.3 Commit (single squash — UI bridge + customizer cleanup + docs together, since Decision 1-7 are same direction and改动小)
- [ ] 7.4 Ready for `/opsx:archive`
