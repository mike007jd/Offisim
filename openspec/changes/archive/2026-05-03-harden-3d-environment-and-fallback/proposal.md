## Why

Bucket 2a (`add-scene-2d-theme-tokens`) live verify on Tauri release `.app` 暴露 3 个预存 3D release 缺陷，阻塞 dark + 3D 主题双路径验证：

1. **HDR root cause**：`scene-lighting-rig.tsx:111` 的 `<Environment preset="apartment" />` 走 drei 默认 CDN（`market-assets.fra1.cdn.digitaloceanspaces.com`）拉 `lebombo_1k.hdr`。Tauri release 严格 CSP + offline → 加载失败 → `Scene Error: Could not load lebombo_1k.hdr`。每次切 dark + 3D 必然 fail。
2. **错误面板硬编码暗色**：`SceneCanvas.tsx:32-46` 外层 `SceneErrorBoundary` fallback panel 硬编码 `bg-black/50 text-white text-red-400 text-gray-400`，3D 错误冒泡到外层时整个 SceneCanvas（含 2D 层）被暗色面板覆盖。light theme 下表现为"白底场景突然黑屏"。该文件持有 `// raw-hex-allowed-file:` exemption，违反 design-token-foundation SSOT。
3. **派生 UX 鬼态**：3D 一次 crash → `force2D=true` + `crashCountRef=1`；用户再点 3D 按钮，因 `viewMode` prop 已是 `'3D'` 所以 `useEffect [viewMode]` 不 fire，`force2D` 不 reset → 3D 按钮亮但渲染 2D 内容（用户截图证据）。两次 crash 后 (`crashCountRef >= 2`) 即使 prop 真的变化也不再 reset，永久卡死。

## What Changes

### 1. Procedural envmap 替代 CDN preset（root cause fix）
- 移除 `<Environment preset="apartment" />`（drei CDN 路径），改用 `RoomEnvironment`（来自 `three/examples/jsm/environments/RoomEnvironment.js`）+ `THREE.PMREMGenerator` 在 React effect 里 procedurally bake envmap，set `state.scene.environment`。
- 抽出 `useProceduralRoomEnvironment(active: boolean)` hook 在新文件 `packages/ui-office/src/components/scene/use-procedural-room-environment.ts`：mount 时 build + bake，unmount / `active=false` 时 dispose。
- 沿用 `LIGHTING_TIER_PRESETS[tier].envMapPreset`（`null` vs `'apartment'`）控制 environment on/off — 信号语义不变，只把"loaded from CDN"换成"baked locally"。
- 完全 offline-safe：无网络请求，无外部资产，无许可问题（RoomEnvironment 是 three.js MIT 内置类）。视觉上等价 apartment preset（都是 studio-room 风格 envmap）。

### 2. SceneError boundary fallback panel 走 token（cosmetic regression fix）
- 把 `SceneCanvas.tsx` 内联渲染的 fallback panel 抽成新文件 `packages/ui-office/src/components/scene/scene-error-panel.tsx` 的 `SceneErrorPanel` function component（class boundary 不能用 hook，但子组件可以）。
- 用 `useSceneColors().sceneBackground` 设背景，`text` / `textMuted` 设主/次文字色，错误强调用 `text-destructive` Tailwind utility（`@theme inline` token-bound）。
- 移除 `SceneCanvas.tsx` 的 `// raw-hex-allowed-file:` header — 该文件不再持有 raw 字面量。
- design-token-foundation spec 的 `raw-hex-allowed-file` 允许列表去掉 `SceneCanvas.tsx`。

### 3. Force-2D fallback 显式 reset 路径 + 可见鬼态 affordance
- `SceneCanvas.tsx` 把 `force2D` + `crashCountRef` 抬到内 `useReducer` 单 state machine `{ force2D: boolean; crashCount: number; lastError: string | null }`，状态转移：`reportCrash` / `requestRetry` / `viewModeBumped` 三个 action。
- 派生上层显式 reset 信号：parent 加 `viewModeNonce: number`（每次显式点 3D toggle 按钮 +1，无论 viewMode 是否真的变化）；SceneCanvas 监听 nonce 变化触发 `viewModeBumped` action 清 `force2D` + `crashCount`。`useEffect [viewMode]` 旧的"软重置"逻辑保留作为 viewMode 真改变时的次级 reset。
- `viewMode === '3D'` 但 `effectiveViewMode === '2D'` 鬼态时，scene 右下角渲染新组件 `<SceneFallbackBadge>`（新文件 `packages/ui-office/src/components/scene/scene-fallback-badge.tsx`）：内容 `3D unavailable · Retry`，点击调内部 dispatch `requestRetry`，颜色走 `bg-warning/15 text-warning border-warning/30`（token-driven）。

### 4. App / OfficeSceneSurface 接 viewModeNonce
- `apps/web/src/components/office-shell/OfficeSceneSurface.tsx`（持有 viewMode toggle）：toggle 按钮 click handler 在 `setViewMode` 之外额外 `setViewModeNonce(n => n+1)`。即使从 3D 切到 3D 也 bump nonce。
- `viewModeNonce` 沿 props 链一路传到 SceneCanvas。

## Capabilities

### Modified Capabilities
- `scene-3d-lighting`：将 "envMapPreset 走 drei `<Environment preset>` CDN" 改成 "envMapPreset 是开关信号，控制 procedural `RoomEnvironment`-baked envmap 的 mount/unmount"；envmap 必须 offline-safe，禁止任何 network fetch。
- `scene-3d-performance-fallback`：新增 "explicit user retry 必须 reset `force2D` + `crashCount`，即使 viewMode prop 不变" Requirement；新增 "force2D 鬼态（viewMode=3D 但 effectiveViewMode=2D）必须可见 affordance（不允许静默渲染 2D 但 toggle 显示 3D）" Requirement。
- `design-token-foundation`：从 `raw-hex-allowed-file` 允许列表移除 `SceneCanvas.tsx`。

## Impact

- **Files**：
  - 修改：`packages/ui-office/src/components/scene/scene-lighting-rig.tsx`、`packages/ui-office/src/components/scene/SceneCanvas.tsx`、`apps/web/src/components/office-shell/OfficeSceneSurface.tsx`、`packages/ui-office/src/components/scene/scene-performance-tier.ts`（注释更新）。
  - 新增：`packages/ui-office/src/components/scene/use-procedural-room-environment.ts`、`packages/ui-office/src/components/scene/scene-error-panel.tsx`、`packages/ui-office/src/components/scene/scene-fallback-badge.tsx`。
  - Spec deltas：`scene-3d-lighting`、`scene-3d-performance-fallback`、`design-token-foundation` 三份 modify-delta。
- **Gates**：`pnpm tokens:lint-hex` 必须 0 violation 含 `SceneCanvas.tsx`；串行 build (shared-types → ui-core → core → ui-office → web) 0 error；`pnpm typecheck` 0 error；改动文件 `biome check` 0 error。
- **DB / migration / runtime / agent contract**：无影响。
- **License**：`RoomEnvironment` 是 three.js MIT 内置类（`three/examples/jsm/environments/RoomEnvironment.js`），无第三方资产引入。
- **Live verify (web)**：`pnpm --filter @offisim/web dev` + chrome-devtools / playwright MCP：dark/light 双主题 3D 加载验 envmap baked 不报错；Settings 切 dark→light 3D 正常；故意触发 3D crash 验 fallback panel 在 light/dark 都正确；力 force2D 鬼态后点 3D toggle 验 retry；fallback chip 在 force2D 鬼态可见可点。
- **Tauri release verify**：留给用户 codex 跑（用户已锁定主 session 不验 Tauri 壳）。
