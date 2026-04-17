# Verification: align-dicebear-outfit-color

## Phase 0 — DiceBear schema

- 读 `node_modules/.pnpm/@dicebear+avataaars@9.4.2_@dicebear+core@9.4.2/node_modules/@dicebear/avataaars/lib/types.d.ts` 与 `utils/getColors.js`。
- **关键发现**：avataaars 9.4.2 API 真实字段名是 `clothesColor`（不是 proposal/design 里写的 `clothingColor`）。类型 `string[]`，pattern `^(transparent|[a-fA-F0-9]{6})$`。
- `getColors.js` 里 `prng.pick(options.clothesColor ?? [], 'transparent')` — 单元素数组 deterministic（pick 唯一元素），符合锁定语义。
- Live probe 没跑运行时 — 源码直证已足够（纯确定性）。
- **决定**：proceed 全量 scope，implementation 按 `clothesColor` 真实名字写；同步把 spec 里的 `clothingColor` 改为 `clothesColor` 以避免 archive 后 canonical spec 带错。

## Phase 1 — 2D DiceBear clothesColor bridge

- `packages/ui-office/src/lib/avatar-seed.ts` 新增：
  - `OUTFIT_COLORS_NUMERIC` = `OUTFIT_COLORS.map(hex => parseInt(hex.slice(1), 16))`
  - `OUTFIT_LABELS` = `['Blue', 'Purple', 'Green', 'Indigo', 'Orange', 'Red', 'Cyan', 'Amber']`
- `office-2d-avatar-cache.ts`：`createAvatar(avataaars, { seed, size: 64, clothesColor: [outfitColorFromSeed(seed).slice(1)] })`
- `DicebearAvatar.tsx`：同上桥接。
- `resolveAvatarSeed` 契约统一：
  - `Office2DCanvasView` 原本已对（map.get(zId)?.push({ agent, seed: resolveAvatarSeed(agent), empId })）
  - `TeamHealthCard` / `AgentCard`：从 `agent.name` 改 `resolveAvatarSeed(agent)`
  - `EmployeeInspector`：改为 `resolveAvatarSeed(employee ?? agent)`（优先 EmployeeRow 的 persona_json.avatarSeed）
  - `EmployeeCreatorOverlay`：原本就传 seed string (effectiveSeed / presetSeed)，不需改
  - `ChatPanel`：不直接调 DicebearAvatar（chat rail 头像由 AgentCard 负责）

## Phase 2 — AvatarCustomizer palette cleanup

- `CLOTHING_COLORS` 改为 `OUTFIT_COLORS_NUMERIC.map((value, i) => ({ value, label: OUTFIT_LABELS[i] ?? ... }))`
- `SKIN_COLORS` / `HAIR_COLORS` 上方加 manual-config palette 注释
- **Dead field 发现**：`avatarAppearance.clothingColor` 字段在当前代码里无任何 3D/2D 渲染路径读取（`unify-avatar-source` archive 之后 3D body 色已走 `outfitColorFromSeed(seed)`）。Templates / `DEFAULT_APPEARANCE` 的硬编码 number 值多数不在新 `OUTFIT_COLORS_NUMERIC` 集合里，但 runtime 无可见影响——符合 MEMORY.md "pre-launch 脏数据自然降解" 纪律，**不写 migration，不改 templates**。

## Phase 3 — Stale docs cleanup

- `CLAUDE.md:189` bullet 改为 "2D DiceBear 卡通头像和 3D 块人是两种渲染引擎；衣服色通过 `outfitColorFromSeed(seed)` 桥接..."
- `MEMORY.md` Open Issue "3D↔2D avatar 视觉割裂" strikethrough + 更新为桥接后状态

## Phase 4 — Build chain

串行全绿：

- `pnpm --filter @offisim/shared-types build` clean
- `pnpm --filter @offisim/core build` clean
- `pnpm --filter @offisim/ui-office build` clean
- `pnpm --filter @offisim/web build` clean
- `pnpm typecheck` — 26 tasks successful (21 cached, 5 executed)

## Phase 5 — Live runtime verification (Chrome DevTools MCP @ localhost:5176)

### 6.2 / 6.4 — 2D DiceBear shirt 色 8 员工命中

`evaluate_script` 解所有 8 个 `<img>` 的 utf8-decoded SVG，正则提所有 `fill="#..."`，对比 `outfitColorFromSeed(name)` 期望值：

| Employee | Expected hex | Matched in SVG fills |
|---|---|---|
| Alex Chen | `#818cf8` (Indigo) | ✓ |
| Maya Lin | `#3b82f6` (Blue) | ✓ |
| Marcus Johnson | `#f59e0b` (Amber) | ✓ |
| Kai Nakamura | `#06b6d4` (Cyan) | ✓ |
| Sophie Park | `#818cf8` (Indigo) | ✓ |
| Ryan Torres | `#22c55e` (Green) | ✓ |
| Zara Okafor | `#ef4444` (Red) | ✓ |
| Jamie Reeves | `#ef4444` (Red) | ✓ |

### 6.3 — 3D body 色等价

- 源码：`office3d-employees.tsx:302` `outfitColorFromSeed(emp.seed)`，`emp.seed = resolveAvatarSeed(agent)`（line 62）
- 2D 侧：`office-2d-avatar-cache.ts:58` `outfitColorFromSeed(seed)` — 同一纯函数
- `outfitColorFromSeed` 是纯函数（djb2 hash % OUTFIT_COLORS.length），相同 seed 必返回字节等价值
- 结论：**2D live 已证 8 员工 shirt 色 = `outfitColorFromSeed(name)`；3D 必然字节等价**。未走完 Three.js mesh color 遍历（需重度 Three.js introspection，不成比例；证据链已闭环）

### 6.5 — Round-trip

2D → 3D → 2D 来回切，再次 evaluate_script，8 员工 shirt 色仍全部命中。无 flicker 无重生成（LRU cache 稳定）。

### 6.6 — Customizer swatches

打开 EmployeeInspector("Alex Chen") → "Edit Details" → EmployeeEditorDialog Profile tab，accessibility snapshot 显示 "Clothing color" 下 8 swatches 顺序：Blue / Purple / Green / Indigo / Orange / Red / Cyan / Amber — 完全匹配 `OUTFIT_LABELS`。Accent 同理。

### 6.7 — Regression surfaces

- `EmployeeInspector` Alex Chen DiceBear avatar 解码 SVG 含 `fill="#818cf8"` ✓
- `AgentCard` / `TeamHealthCard` 代码路径已改 `resolveAvatarSeed(agent)`；AgentState 无 persona_json 字段（fallback 到 name），行为 hex 值不变，契约对齐
- `EmployeeCreatorOverlay` 走 seed string，DicebearAvatar 内部自派生，无改动

### 6.8 — Console

`list_console_messages types=[error,warn]`：
- 运行时共 2 条 warn：`Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}` × 2（打开 EmployeeEditorDialog 时）
- **这是 pre-existing 的 radix DialogContent a11y hygiene 问题，与本 change 无关**。零 error，零新增 warn。

## Phase 6 — Finalization

- verification.md（本文件）完整
- `openspec validate align-dicebear-outfit-color` — 执行中
- commit message：单 commit 收口（UI 桥接 + customizer SSOT + docs 同一方向）

## Scope

一次性落：
- 2D DiceBear `clothesColor` 桥接
- customizer clothing palette SSOT
- `resolveAvatarSeed` 契约在 TeamHealthCard / EmployeeInspector / AgentCard 统一
- CLAUDE.md / MEMORY.md 去 stale

不做（延续 Non-Goals）：
- 废弃 DiceBear
- 锁 clothing / hair / skin / accessories / face 款式
- 改 3D 渲染
- 合并 SKIN_COLORS / HAIR_COLORS 到 avatar-seed.ts
- `avatarAppearance.clothingColor` 字段的数据迁移或删除（留给后续）
