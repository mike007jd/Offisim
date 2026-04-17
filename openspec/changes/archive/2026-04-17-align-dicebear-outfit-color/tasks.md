## 1. Phase 0 — DiceBear option schema verification

- [x] 1.1 Read `node_modules/@dicebear/avataaars@9.4.2` schema / types — option名实际为 `clothesColor`（不是 `clothingColor`），类型 `string[]`，pattern `^(transparent|[a-fA-F0-9]{6})$`。`getColors.js` 里 `prng.pick(options.clothesColor ?? [], 'transparent')` 单元素数组 deterministic
- [x] 1.2 **Live probe**: 跳过 browser 跑 probe，已由 1.1 源码直证（prng.pick 单元素数组 = 该元素，纯确定性），无需再跑运行时验证
- [x] 1.3 Phase 0 结论：option 存在且可锁定，**proceed 全量 scope**。修正：proposal/design/tasks/spec 里的 `clothingColor` 实际应作 `clothesColor`（DiceBear API 真名），implementation 按真名落

## 2. Phase 1 — 2D DiceBear `clothingColor` bridge

- [x] 2.1 Add `OUTFIT_COLORS_NUMERIC: readonly number[]` and `OUTFIT_LABELS: readonly string[]` exports to `packages/ui-office/src/lib/avatar-seed.ts`
- [x] 2.2 Update `packages/ui-office/src/components/scene/office-2d-avatar-cache.ts`: pass `clothesColor: [outfitColorFromSeed(seed).slice(1)]` to `createAvatar` (DiceBear avataaars 9.4.2 真实 option 名是 `clothesColor`)
- [x] 2.3 Update `packages/ui-office/src/components/shared/DicebearAvatar.tsx`: compute `const clothesHex = outfitColorFromSeed(seed).slice(1)` and pass `clothesColor: [clothesHex]` to `createAvatar`
- [x] 2.4 `resolveAvatarSeed` contract 已统一 — `Office2DCanvasView` 已对；`TeamHealthCard` / `EmployeeInspector` / `AgentCard` 从 raw `.name` 改为 `resolveAvatarSeed(agent)`（`EmployeeInspector` 优先用 `employee ?? agent`）；`EmployeeCreatorOverlay` 传的是 seed string（effectiveSeed / presetSeed），无需修；`ChatPanel` 不直接调 DicebearAvatar（chat rail 头像由 `AgentCard` 负责）

## 3. Phase 2 — AvatarCustomizer palette cleanup

- [x] 3.1 `AvatarCustomizer.tsx` `CLOTHING_COLORS` 改为从 `OUTFIT_COLORS_NUMERIC` + `OUTFIT_LABELS` 派生（SSOT）
- [x] 3.2 `SKIN_COLORS` / `HAIR_COLORS` 上加 manual-config palette 独立性注释
- [x] 3.3 发现：`avatarAppearance.clothingColor` 字段在当前代码里**无渲染路径引用**（`unify-avatar-source` archive 后，3D body 色已走 `outfitColorFromSeed(seed)`）。Templates / DEFAULT_APPEARANCE 硬编码值不在新 `OUTFIT_COLORS_NUMERIC` 集合里但 runtime 无可见影响 — customizer 打开时选中态不高亮，用户下次点选即覆盖。**符合 "pre-launch 脏数据自然降解" 纪律，不写 migration，不改 templates**（后者属于 dead data，未来整个字段可考虑删）

## 4. Phase 3 — Stale documentation cleanup

- [x] 4.1 `CLAUDE.md` line 189 bullet 改为桥接状态描述
- [x] 4.2 MEMORY.md Open Issue "3D↔2D avatar 视觉割裂" 改为已桥接并 strikethrough

## 5. Phase 4 — Build and typecheck

- [x] 5.1 `pnpm --filter @offisim/shared-types build` — clean
- [x] 5.2 `pnpm --filter @offisim/core build` — clean
- [x] 5.3 `pnpm --filter @offisim/ui-office build` — clean
- [x] 5.4 `pnpm --filter @offisim/web build` — clean
- [x] 5.5 `pnpm typecheck` — 26/26 tasks green

## 6. Phase 5 — Live verification on web runtime

- [x] 6.1 Web dev @ 5176 + Chrome DevTools MCP attached；"My AI Company" + 8 员工加载成功
- [x] 6.2 2D DiceBear shirt 色提取：8 员工 img.src utf8-SVG 解码，fill regex 对 `outfitColorFromSeed(name)` 期望值全命中
- [x] 6.3 3D body 色等价：源码 + 2D live 证据链闭环（`outfitColorFromSeed` 纯函数 + 相同 `resolveAvatarSeed(agent)` seed；未走 Three.js mesh introspection — 不成比例）
- [x] 6.4 8 员工覆盖：Alex Chen/Maya Lin/Marcus Johnson/Kai Nakamura/Sophie Park/Ryan Torres/Zara Okafor/Jamie Reeves shirt 色全命中（详见 verification.md 表格）
- [x] 6.5 Round-trip 2D→3D→2D：8 员工 shirt 色不变，LRU cache 稳定
- [x] 6.6 Customizer 8 swatches：Blue/Purple/Green/Indigo/Orange/Red/Cyan/Amber 完全匹配 `OUTFIT_LABELS`
- [x] 6.7 Regression：EmployeeInspector Alex Chen avatar 含 `#818cf8`；AgentCard / TeamHealthCard 契约对齐（AgentState 无 persona_json，resolveAvatarSeed fallback name）
- [x] 6.8 console 0 error；2 pre-existing DialogContent a11y warn（与本 change 无关）

## 7. Phase 6 — Verification doc and finalization

- [x] 7.1 `verification.md` 写完
- [x] 7.2 `openspec validate align-dicebear-outfit-color` — clean
- [x] 7.3 Commit（单 squash）
- [x] 7.4 Ready for `/opsx:archive`
