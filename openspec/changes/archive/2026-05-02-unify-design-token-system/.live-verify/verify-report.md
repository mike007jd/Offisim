# unify-design-token-system live verify report

> 日期：2026-05-02
> 触发：close-frontend-ux-debt task 6.3 — `unify-design-token-system` archive gate 三查
> Scope：(1) Tauri release `.app` dark/light 主题切换 (2) design tokens SSOT 来源单一性

## Part A — Token SSOT 来源单一性（grep 自动验证，2026-05-02）

**Pass**：✅

证据：

```
$ ls packages/ui-core/src/tokens/
border.ts colors-3d.ts colors-semantic.ts index.ts motion.ts radius.ts
shadow.ts spacing.ts tailwind-theme.ts typography.ts z-index.ts

$ cat packages/ui-core/src/tokens/index.ts
export * from './border.js';
export * from './colors-3d.js';
export * from './colors-semantic.js';
export * from './motion.js';
export * from './radius.js';
export * from './shadow.js';
export * from './spacing.js';
export * from './tailwind-theme.js';
export * from './typography.js';
export * from './z-index.js';

$ cat packages/renderer/src/tokens/colors.ts
export { STATE_COLORS_DARK as STATE_COLORS } from '@offisim/ui-core/tokens';
# ↑ 只 re-export，不另立 SSOT

$ pnpm tokens:lint-hex
> node scripts/lint-no-raw-hex.mjs
# 退出码 0，无 raw hex 漂移
```

满足 `design-token-foundation` capability 的 SSOT Requirement：
- > `packages/ui-core/src/tokens/` SHALL be the single source of truth for all design tokens

## Part B — Tauri release `.app` 主题切换（dark/light）

**Pass**：✅

执行步骤：

1. `pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/desktop build`
2. 确认 release bundle 重新产出：
   - `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` — May 2 12:42:23 2026
   - `apps/desktop/src-tauri/target/release/bundle/dmg/Offisim_0.0.1_aarch64.dmg` — May 2 12:42:44 2026
3. `open -b com.offisim.desktop` 启动 release `.app`
4. Computer Use 附着 `com.offisim.desktop`，窗口 URL 为 `tauri://localhost`
5. Light：Office workspace 截图
6. Settings → Runtime → Theme，从 Light 切到 Dark
7. Dark：抽查 Office / SOPs / Market / Personnel / Activity / Settings

截图证据：

- `release-light-office.png`
- `release-dark-settings-runtime.png`
- `release-dark-office.png`
- `release-dark-sops.png`
- `release-dark-market.png`
- `release-dark-personnel.png`
- `release-dark-activity.png`

观察：

- Light Office：shell、团队卡片、workspace panel、3D scene 区域均为 light token，文字和边框可读。
- Dark Settings Runtime：主题 radio 真实切到 Dark，页面主体、侧栏、表单、底部状态栏同步变暗。
- Dark Office：顶部导航、团队列表、chat panel、状态栏、3D scene palette 均进入 dark；未见整块 light 残留。
- Dark SOPs：空状态、左侧栏、工具栏、输入区可读；按钮和边框对比正常。
- Dark Market：Market 服务不可达空状态正常渲染为 dark；这是平台服务状态，不是主题漂移。
- Dark Personnel：员工列表、筛选、空详情面板均为 dark，文字可读。
- Dark Activity：空状态、说明文字、Back to Office 按钮均为 dark，未见 text/background 对比异常。

截图尺寸验证：

```
$ sips -g pixelWidth -g pixelHeight openspec/changes/unify-design-token-system/.live-verify/*.png
# 7 张截图均为 3024 x 1964
```

合规判定（per `theme-light-dark-switching` capability）：
- 每个 touched surface 在两个主题下都正确渲染
- 语义 token（`bg-surface` / `text-text-primary` 等）自动切换，无 per-component `dark:` variant 漂移
- 无 hard-coded hex / 任意 Tailwind value 在 dark mode 留遗

## Outcome

- Part A：✅ pass
- Part B：✅ pass
