## Context

`PersonnelPage.tsx` 三栏 grid 走 named CSS class（index.css `grid-personnel-desktop-expanded` desktop `280|1fr|420` / `-collapsed` `64|1fr|420` / `-tablet-expanded` `220|1fr` / `-tablet-collapsed` `64|1fr`），**非** inline `lg:grid-cols-[…]` literal。inspector TabsList(`:418`) 松散 `TabsTrigger text-xs`(无 chip-grammar)。DetailHeader(`:481`) `px-6 py-4`（24px 横 / 16px 纵）。Profile 字段已无 card、input `h-9`、label `mb-1`。6 tab(Profile/Appearance/Runtime/Skills/Memory/History)，TabsContent forceMount + retain-state(`:426+`)。AppearanceTab PreviewCard 几何走 named class `avatar-preview-card`(index.css:171，`aspect-ratio 256/200 + max-width 16rem + min-height 12.5rem`)，`<Canvas>` 已仅 `style={{ background:'transparent' }}`。`shared/DicebearAvatar.tsx:29` 内部员工 2D avatar 硬编码 `rounded-full`（全圆）。`personnel-tabs/`(ProfileTab/AppearanceTab/RuntimeTab/SkillsTab/MemoryTab/HistoryTab)。`routeToPersonnel(id,tab)` 跨 surface 入口（本 change 纯 className，不动它）。

**base-spec drift 注意**：base `personnel-workspace-surface` spec 仍把 page grid 写成 inline `lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]`、PreviewCard 写成 inline `aspect-[256/200] min-h-[200px] max-w-[256px]`、inspector 写成 `min-h-[560px]` literal，与 named-class 现实漂移（且 `min-h-[560px]` literal 代码里不存在）。本 change 在 spec delta 里把这两条 base requirement MODIFIED 成 named-class 现实。

V3 prototype `offisim-personnel-prototype.html` + DNA §11 Personnel：三栏 280|1fr|420、detail head `.pd-head` `sp-5 sp-7`、inspector `.insp-tabs` bottom-rule chip-grammar（`border-bottom 1px var(--line)` + `padding 0 sp-5`，per-chip `.insp-tab` 28px + `--r-sm` + active `--accent-surface`；**不是**带 border 的 padded 容器盒）、profile caps label + flow 无 card、avatar `.av` `border-radius 26%`。

## Goals / Non-Goals

**Goals:** Personnel = V3 grammar（inspector chip-tabs / detail head padding / profile rhythm / avatar block），三栏 IA 与 6-tab 行为不变。

**Non-Goals:** appearance 几何 / runtime binding / memory / history 行为；数据模型；routing 签名；surface 配色(Phase 0)。

## Decisions

### D1 — inspector tabs `.insp-tabs` bottom-rule chip-grammar（纯 className）
`TabsList` 套 prototype `.insp-tabs`：单行 rail，`border-bottom: 1px solid var(--line)` only（**无**容器 border / 无 3px 内 padding 盒）、`padding: 0 var(--sp-5)`、~44px 高、`gap: 2px`、`overflow-x: auto`。`TabsTrigger` 套 `.insp-tab`：28px 高、`padding: 0 11px`、`border: 0`、`border-radius: var(--r-sm)`（7px，**非 --r-md**）、透明底 `var(--ink-3)` 文字、hover faint sunken + `var(--ink-1)`、active `background: var(--accent-surface)` + `color: var(--accent)`。**不动** TabsContent 结构（6 个 forceMount + `TABS_RETAIN_STATE_CLASS` 保留，护 3D preview 预热 + layout 稳定）。
**理由**：prototype `.insp-tabs`/`.insp-tab`（offisim-personnel-prototype.html:377-398）。早期 proposal 写的「border + `--r-md` + 3px padding 容器盒」是 over-spec，prototype 实际是 bottom-rule + per-chip `--r-sm`，已纠正。

### D2 — detail head padding sp-5 sp-7
DetailHeader `px-6 py-4`（24px 横 / 16px 纵）→ prototype `.pd-head` 的 `var(--sp-5) var(--sp-7)`（12px 纵 / 16px 横）。className target = `px-3 py-4`（audit 已冻结此 target）；spec prose 以 prototype `--sp-5/--sp-7` padding 为 SSOT 描述，不锁特定 Tailwind class 产出该值。

### D3 — profile field rhythm 收口
caps label + flow（无 card wrapper，现状已合规）；input ~32px、label gap 4-6px 显式化。

### D4 — avatar `rounded-full` → 26% block（有意跨表面改动）
`shared/DicebearAvatar.tsx:29` 当前硬编码 `rounded-full`（全圆，**非** 26%）；改成 26% block radius（prototype `.av`）。**这是有意的 app-wide 改动**：`DicebearAvatar` 经 `EmployeeAvatar` 复用在 Office scene roster / Personnel / Market detail / Employee Creator，改它即统一全表面内部员工 2D avatar 为 26% block。本 change 拥有该统一；不动 `BrandAvatar2D`、不动 3D block-figure。
**理由**：prototype `.av { border-radius: 26% }`（offisim-personnel-prototype.html:298）。早期 design 写「26% 核对/缺则补」假设已实现，实为全圆，已纠正为有意改动。

### D5 — 三栏 + responsive 保持
desktop 280|1fr|420 + 折叠 64（named class `grid-personnel-*`）；tablet/narrow 退化保留；inspector min-height behavioral floor 保留（代码无 `min-h-[560px]` literal，靠 flex/grid 布局维持跨 break 高度不变，spec MODIFIED 后断言 behavioral floor）。

## Risks / Trade-offs

- **改 inspector tabs className 误伤 forceMount/retain-state** → 只改 List/Trigger 视觉,不动 Content props；live 验 3D preview 预热 + tab 切换 layout 稳定。
- **profile rhythm 改动误碰 save round-trip** → 只动排版,不动表单字段绑定/save 路径（appearance/runtime/profile 行为保持）。
- **avatar 26% 是 app-wide 改动（已接受）** → `DicebearAvatar` 经 `EmployeeAvatar` 复用在 Office scene roster / Personnel / Market detail / Employee Creator，改 `rounded-full` → 26% 即全表面统一内部员工 2D avatar。本 change 有意拥有该跨表面统一（spec ADDED requirement 明确 app-wide），**不**降级为 Personnel-local class（局部 class 会让同一员工头像在 scene vs Personnel 不一致，违反 prototype 单一 block 语言）。不动 `BrandAvatar2D` / 3D。

## Migration Plan

1. inspector TabsList/TabsTrigger chip-grammar。
2. DetailHeader padding。
3. profile field rhythm 收口 + AppearanceTab PreviewCard aspect-ratio（若缺）。
4. avatar 26% 核对。
5. 串行 build + live 验。
6. 回滚：纯 className 改动,单 commit 可 revert。

## Open Questions

- profile field 是否需新增 caps-label 显式分组（现状 `<h3>` uppercase 已近似；apply 按 prototype 核）。

（已解决：`DicebearAvatar` 当前是 `rounded-full`（全圆），非 26%——非「核对/已实现」，是有意 app-wide 改动，见 D4。）
