## Why

13 张 UX 截图里反复出现的"基础信任问题"：dialog 切 tab 高度跳变 / 表单越长越溢出 viewport / sticky footer 把最后一字段盖住 / Company creation 的 Back 按钮悬在头部脱离主操作行 / "Create your own / Open Studio Editor" 文案承诺打开 Studio 编辑但实际只是创建公司停在主界面 / 主 shell 与 Company / Employee 表单层层 cards 套 cards 视觉噪声盖过内容。这些不是单点 bug，是整套 panel/dialog 缺一份"尺寸 + 滚动 + 容器层级"契约。A4 要把契约立起来并落第一批表面。

## What Changes

- 新增全局 panel/dialog **尺寸契约**：每个 modal/full-screen overlay 在 desktop/tablet 视口必须声明 `min-height` + `max-height`（基于视口百分比 clamp），tab/section 切换 SHALL NOT 改变外层高度，超长内容**只在内部滚动容器**滚动；narrow viewport 单独契约见 `responsive-app-shell` 不重复。
- 新增 Company creation 流程契约：Back 按钮 SHALL 与 Company Name input / Start / Open Studio Editor 同一 footer 行（不再悬在 header）；"Open Studio Editor" 主操作 SHALL 一次完成 *create company → set active company → open Studio in edit mode*，不允许只创建公司不切换或只切换不打开 Studio。
- 第一批"去 cards 套 cards"surfaces：主 app shell（workspace center 不再被外层卡片包裹）、Company creation dialog（外壳一层、内容直接放表单不再嵌 SurfaceCard 套 SurfaceCard）、Employee Editor、Company Profile。同 surface 内 ≤ 1 层 visual container（dialog shell 本身算 0 层，内部最多 1 层 card 分组）。
- Tab 切换稳定性：`Tabs.List` + `Tabs.Content` 嵌入 dialog 时，外层 dialog SHALL 保留独立的 `flex-col min-h-0` + `Tabs.Content` 取 `flex-1 min-h-0 overflow-y-auto`；tab 切换前后 dialog 外框高度差 = 0。

## Capabilities

### New Capabilities

- `panel-and-dialog-sizing`: 全局 panel/dialog 的尺寸 + 内部滚动 + tab 切换不跳高 + cards-in-cards 容器层级契约，覆盖 A4 第一批 surfaces（主 shell / Company creation / Employee Editor / Company Profile）。
- `company-creation-flow`: Company creation dialog 的 footer 操作行（Back / Company Name / Start / Open Studio Editor）布局契约 + "Open Studio Editor" 一次完成 create+activate+open-studio 的端到端行为契约。

### Modified Capabilities

无。`responsive-app-shell` 只管 viewport overflow / 主操作可达 / sticky footer 反向 padding，本 change 在它之上叠加内部高度+滚动契约，作为新 capability 不与 responsive-app-shell 冲突。`dialog-overlay-protocol` 只管 close/focus/Escape，与本 change 的 sizing 契约互补不重叠。`design-system-consolidation` Purpose 已经写过 "broad page sections are not wrapped as nested floating cards"，但没落 requirement / scenario；本 change 的 cards-in-cards 条款定位为新 capability `panel-and-dialog-sizing` 的硬规则，不去拆 design-system-consolidation。

## Impact

**Affected code**:
- `packages/ui-office/src/components/onboarding/`（Company creation / template wizard footer 行）
- `packages/ui-office/src/components/employee/EmployeeEditorDialog.tsx`（去 cards 套 cards + sizing 规整）
- `packages/ui-office/src/components/company/CompanyProfile*`（Profile 面板容器层级）
- `packages/ui-office/src/components/layout/AppLayout*`（主 shell workspace center 容器层级）
- `packages/ui-office/src/components/shared/DialogShell*` 或等价 dialog primitive（sizing token 集中点）
- 各 dialog 的 Tabs 容器（Tabs.Content `flex-1 min-h-0 overflow-y-auto` 修订）

**Affected behavior**:
- Company creation"Open Studio Editor"按钮：从"只创建公司"扩成"创建+激活+打开 Studio edit mode"。需要核对 `useStudioStore` 打开 API + active company 切换 API + onboarding 流程当前是 imperative 还是 reducer 派发，避免 race。

**Affected tokens**:
- 新增/集中 `--panel-min-h` / `--panel-max-h` / `--dialog-min-h` / `--dialog-max-h` CSS variable 或 Tailwind clamp 表达式（具体落在 design.md）。

**No backend / migration / API change**。纯前端容器+样式+一处 onboarding 行为修订。

**Testing strategy**: 按 Validation Policy 走 live agent 手测，三视口（1440 / 1280 / 390）各 dialog 切 tab / 长表单滚动 / Open Studio Editor 端到端。无自动化测试新增。
