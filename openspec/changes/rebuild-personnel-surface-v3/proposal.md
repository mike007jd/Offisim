## Why

V3 设计稿把 Personnel 定为三栏 280|1fr|420（左 list 可折叠 64px、中 profile、右 6-tab inspector），且要求：inspector tabs 用 prototype `.insp-tabs` / `.insp-tab` bottom-rule chip-grammar（非松散横向按钮；`border-bottom 1px var(--line)` + `padding 0 sp-5`，per-chip `--r-sm` + active `--accent-surface`，**不是**带 border 的 padded 容器盒）、detail head padding `sp-5 sp-7`（非 sp-7 sp-9）、profile field rows ~32px input + 4-6px label gap + 字段组无 card wrapper（caps label + flow）、avatar 从当前 `rounded-full`（全圆）改成 26% block-style、drop bell。当前三栏宽度已对（280|1fr|420），但 inspector tab 是松散 `TabsTrigger text-xs`（无 chip-grammar）、detail head padding 偏大（px-6=24px 横）、avatar 仍是 `rounded-full`。Phase 4 把 Personnel 重做成 V3 grammar。依赖 Phase 0 token（`--sp-5/7`、`--line`、`--r-sm`、`--accent-surface`、`--surface-sunken` 当前只存在于 prototype，由 Phase 0 落地）。

## What Changes

- **inspector tabs → `.insp-tabs` bottom-rule chip-grammar**：6-tab(Profile/Appearance/Runtime/Skills/Memory/History) 的 `TabsList`/`TabsTrigger` 从松散 `text-xs` 按钮改 prototype `.insp-tabs`/`.insp-tab` 语法 —— tab 条是单行 rail（`border-bottom 1px var(--line)` + `padding 0 sp-5`，~44px 高，`gap 2px`，可横向滚动），per-chip 是 28px 高 / `padding 0 11px` / `border-radius var(--r-sm)`(7px，**非 --r-md**) / 透明底，hover faint sunken、active `--accent-surface` + `--accent` 文字。**不是**带 border + 3px 内 padding 的容器盒。tab 容器结构（6 TabsContent + forceMount + retain-state）不变。
- **detail head padding → sp-5 sp-7**：`px-6 py-4`（24px 横 / 16px 纵）改 prototype `.pd-head` 的 `sp-5 sp-7`（12px 纵 / 16px 横）。
- **profile field rows V3 rhythm**：字段组 caps label + flow（无 card wrapper），input ~32px、label gap 4-6px；现状已无 card、间距大体合规，本 phase 收口为显式 V3 节奏。
- **avatar `rounded-full` → 26% block-style**：`DicebearAvatar`（内部员工 2D fallback）当前硬编码 `rounded-full`（全圆），改成 26% block radius（prototype `.av` 规则）。**这是有意的跨表面改动**：`DicebearAvatar` 经 `EmployeeAvatar` 复用在 Office scene roster / Personnel / Market detail / Employee Creator，改它即 app-wide 重塑内部员工 2D avatar 为统一 26% block；本 change 拥有这个跨表面统一。不动 `BrandAvatar2D`、不动 3D block-figure。
- **三栏宽度确认 + responsive**：desktop 280|1fr|420、左可折叠 64px；tablet/narrow 退化保留。
- **drop bell**：Personnel 内确认无铃铛（grep 验证；全局铃铛删除属 Phase 2/8）。
- **base-spec drift 收口（MODIFIED）**：base spec 把 page grid 写成 inline `lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]`、AppearanceTab PreviewCard 写成 inline `aspect-[256/200] min-h-[200px] max-w-[256px]`、inspector 写成 inline `min-h-[560px]` literal——但当前代码用 named CSS class（`grid-personnel-*` / `avatar-preview-card`）表达同一几何，且 `min-h-[560px]` literal 不存在于代码。本 change 把这两条 base requirement 重写为 named-CSS-class 现实（断言几何/behavioral floor，不锁 inline literal），不留 spec 同时主张两套语法。

**不在范围**：appearance live preview 几何 / runtime engine binding / memory / history 的**行为**（保持，不破）；员工数据模型；`routeToPersonnel(id, tab?)` 签名与跨 surface routing 行为（纯 className，不动 routing）；surface 配色（Phase 0）。

## Capabilities

### Modified Capabilities
- `personnel-workspace-surface`:
  - **ADDED** —— inspector tabs 用 `.insp-tabs` bottom-rule chip-grammar、detail head padding `sp-5 sp-7`、profile field rows ~32px + 4-6px + 无 card wrapper、avatar `rounded-full` → 26% block-style（有意跨表面）。
  - **MODIFIED** —— `AppearanceTab 3D Canvas slot declares aspect-ratio before mount` 与 `Personnel page grid SHALL use a layout that preserves min-height budget across responsive break` 两条 base requirement 重写为 named-CSS-class 现实（`avatar-preview-card` / `grid-personnel-*`），断言几何与 behavioral floor 而非 inline literal。
  - **保持不变** —— 三栏 IA、profile 内容、appearance/runtime/memory/history 行为、cross-surface routing（`routeToPersonnel` 签名）、inspector forceMount + retain-state。

## Impact

- 代码：`PersonnelPage.tsx`（inspector TabsList/TabsTrigger chip-grammar、DetailHeader padding）、`personnel-tabs/ProfileTab.tsx`（field rhythm 收口）、`AppearanceTab.tsx`（PreviewCard 几何已由 `avatar-preview-card` class 提供，仅核对）、`shared/DicebearAvatar.tsx`（`rounded-full` → 26% block radius）。
- blast radius：tab/padding/profile/grid 均纯 className，不动组件树/state/routing；`routeToPersonnel(id,tab)` 签名不变；appearance/runtime 子功能自治不受影响。**avatar 改动是有意的 app-wide 改动**：`DicebearAvatar` 经 `EmployeeAvatar` 复用在 Office scene roster / Personnel / Market detail / Employee Creator，改 `rounded-full` 即统一全表面内部员工 2D avatar 为 26% block；不动 `BrandAvatar2D` 与 3D。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：inspector tabs chip 化 / detail head 紧凑 / profile 字段节奏 / avatar block / 三栏 + 折叠 / 无铃铛 / 6 tab 内容与 routing 不破。
