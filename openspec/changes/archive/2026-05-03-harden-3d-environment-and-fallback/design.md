## Context

`SceneCanvas.tsx` 当前架构：
- 双层 `SceneErrorBoundary`：内层包 3D `<Office3DView>`，外层包 2D + 3D 整体（fallback 是硬编码暗色 `<div bg-black/50 text-white>`）。
- `force2D: boolean` + `crashCountRef: number` 两个独立 refs，分散管理 fallback state；3D 内层 boundary `onError` 把 `crashCountRef +=1` 并 `setForce2D(true)`；`useEffect [viewMode]` 在 viewMode 变化且 `crashCountRef < 2` 时 `setForce2D(false)`。
- 3D 加载失败的根因是 `<Environment preset="apartment" />`（drei `@react-three/drei` 默认从 `market-assets.fra1.cdn.digitaloceanspaces.com` 拉 `lebombo_1k.hdr`）。Tauri release 严格 CSP + 离线 → 必 fail。
- design-token-foundation `// raw-hex-allowed-file:` exemption 把 `SceneCanvas.tsx` 整文件挡在 token 检查之外，掩盖了硬编码暗色面板问题。

`scene-3d-lighting` spec 当前 explicitly 要求 `<Environment preset="apartment" />`。`scene-3d-performance-fallback` spec 当前要求 `crashCountRef >= 2 → force 2D regardless of FPS`，但没规定显式 user retry 的 reset 路径，也没规定鬼态 affordance。

## Goals / Non-Goals

**Goals:**
- 消除 3D envmap 的网络依赖：release / dev / offline 都可加载 envmap。
- envmap 视觉等价 apartment preset（studio-room 风格 PBR 反射）。
- `force2D` 鬼态可恢复：用户显式 retry 必能 reset，无论 viewMode 是否真变。
- 用户始终能"看到当前真实状态"：3D toggle 与 effective view 不一致时必须可见 affordance + retry 入口。
- 错误面板 light/dark 都正确，零硬编码 literal，token-driven。
- `pnpm tokens:lint-hex` 在 `SceneCanvas.tsx` 上零 violation 且无 `// raw-hex-allowed-file:` 豁免。

**Non-Goals:**
- 不重写 3D 场景 art direction（Office3D 视觉风格不变）。
- 不引入第三方 HDR 资产 / 光照库（`RoomEnvironment` 是 three.js 内置）。
- 不重构 `useScenePerformanceTier` 的 FPS-driven force2D 链路（已正确；本 change 只补 explicit-user-reset 路径和鬼态 UI）。
- 不动 2D canvas pipeline（bucket 2a 已交付）。
- 不重做 inner `SceneErrorBoundary` 的 `null` fallback 行为（3D 内层错误现场静默→外层接管，是 well-defined behavior）。

## Decisions

### Decision 1: Procedural `RoomEnvironment` + PMREM 替代 drei `<Environment preset>`

`three/examples/jsm/environments/RoomEnvironment.js` 是 three.js MIT 内置类，构造一个 ~10×10 的程序化彩色房间 scene。`THREE.PMREMGenerator.fromScene(env, 0.04)` 把它 bake 成可用的 PBR envmap texture（mipmap-encoded）。整个流程纯 GPU + CPU memory，零网络。

**实现位置**：抽出 `useProceduralRoomEnvironment(active: boolean): void` hook 到新文件 `packages/ui-office/src/components/scene/use-procedural-room-environment.ts`。Hook 用 `useThree()` 拿 renderer + scene；`useEffect [active, renderer]` 在 `active=true` 时 build RoomEnvironment + PMREMGenerator + bake + `scene.environment = pmremTexture`，在 `active=false` 或 unmount 时 dispose pmremGenerator + dispose textures + `scene.environment = null`。

**为什么不 bundle HDR 文件**：
- HDR 即使 1k 也要 ~600KB～1MB，加进 `ui-office` 包让所有 dev/web 都背这个负担。
- 增加许可审计成本（HDR 来源 / CC0 / attribution）。
- 增加 CI / asset pipeline 复杂度（vite asset import / public directory）。
- RoomEnvironment 视觉效果在 0.04 roughness blur 下与 apartment preset 难以肉眼区分（envmap 主要影响 PBR 反射的色调，不影响材质表面色）。

**为什么不在 release 偷偷 disable env**：
- 违反"必须找根因"原则。
- light theme 和 dark theme PBR 反射会不一致（dark 下有 envmap、light 下没有），违背 art-direction 一致性。

**Alternatives considered**：
- Bundle local HDR + drei `<Environment files="..."/>`：增加 binary asset 负担、许可审计、CI pipeline，rejected。
- 完全去掉 envmap，仅靠 hemisphere/directional：失去 PBR 反射，3D 视觉退化明显（材质看起来像哑光塑料），rejected。
- Drei 自有 procedural 选项：drei 没有内置 procedural envmap helper，rejected。

### Decision 2: `useReducer` state machine 取代 `useState + useRef` 双轨

当前 `force2D` (state) + `crashCountRef` (ref) 双轨容易 race（多个 crash 几乎同时 fire 时 ref 累加但 state 只 set 一次）。新 state shape：

```ts
type FallbackState = {
  force2D: boolean;
  crashCount: number;
  lastError: string | null;
};
type FallbackAction =
  | { type: 'reportCrash'; error: Error }
  | { type: 'requestRetry' }
  | { type: 'viewModeBumped' };  // explicit user retry signal
```

reducer：
- `reportCrash`：crashCount += 1; force2D = true; lastError = error.message
- `requestRetry`：force2D = false; crashCount = 0; lastError = null
- `viewModeBumped`：相同语义 = `requestRetry`（统一 reset）

**Alternatives considered**：
- 保留 ref + state 双轨：rejected — race-prone。
- 用 `useImperativeHandle` 暴露 `requestRetry()` 给 parent：rejected — 让 parent 拿 imperative 接口比 props 链脏，且 nonce-based reset 已经能覆盖所有显式 retry。

### Decision 3: `viewModeNonce: number` props 信号 + reducer subscribe

Parent (`OfficeSceneSurface.tsx`) 持有 `viewModeNonce` state，每次 toggle 按钮 click handler `setViewModeNonce(n => n + 1)`，无论 `viewMode` 是否真变。`SceneCanvas` `useEffect [viewModeNonce]`（仅在初次 mount 后变化才 dispatch；用 `useRef` 跳过 initial value）dispatch `viewModeBumped`。

`SceneFallbackBadge` 内部点击直接 `dispatch({type: 'requestRetry'})`，不需走 nonce。

**为什么用 nonce 而不是 callback ref**：
- props-only 接口，纯 declarative，避免 imperative ref。
- 容易扩展：未来键盘快捷键 / 命令面板 / programmatic retry 都能 bump nonce。
- React strict-mode 友好（不会因 double-invoke 触发多次 retry）。

**为什么 `crashCountRef >= 2` 软上限被去掉**：
- 当前 `useEffect [viewMode]` 只在 `crashCountRef < 2` 时 reset force2D，意图是"防止反复 crash 浪费 GPU"。但 explicit user retry 是用户主动决定，应该总是允许 — 用户比 heuristic 更知道自己想要什么。
- 新 reducer：`viewModeBumped` 总是 reset，不看 crashCount。FPS-driven force2D 路径（`useScenePerformanceTier` 三秒 `tier='off'`）保持不变，依然能在 retry 后再次触发若依然不行。

### Decision 4: `<SceneErrorPanel>` function component 取代内联 div

class boundary 不能用 hook，但 boundary 的 `render()` 可以返回一个 function component，function component 内可调 `useSceneColors()`。

```tsx
function SceneErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  const sceneColors = useSceneColors();
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ backgroundColor: sceneColors.sceneBackground }}
    >
      <div className="text-center p-4">
        <p className="text-sm text-destructive">Scene Error</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
        <button
          type="button"
          className="mt-3 px-3 py-1 text-xs rounded bg-muted text-foreground hover:bg-muted-hover"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
```

`SceneErrorBoundary` 默认 render `<SceneErrorPanel error={...} onRetry={...} />`。所有颜色都走 `@theme inline` 的 Tailwind utilities（已 token-bound）+ `useSceneColors()` 走 `Scene3DColors`。

### Decision 5: `<SceneFallbackBadge>` 鬼态 affordance

新组件 `packages/ui-office/src/components/scene/scene-fallback-badge.tsx`：

```tsx
function SceneFallbackBadge({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-2 rounded-full border border-warning bg-warning-muted px-3 py-1.5 text-xs text-warning hover:bg-warning/20"
    >
      <span>3D unavailable</span>
      <span className="text-warning/70">·</span>
      <span className="font-semibold">Retry</span>
    </button>
  );
}
```

`SceneCanvas` 在 `viewMode === '3D' && state.force2D` 时 render 它（不在 viewMode='2D' 时 render — 用户主动选 2D 不算鬼态）。点击 → reducer `requestRetry`。

**Why bottom-right corner**：不挡 ceremony bubble (top-center) / employee 选中 (随员工)；`absolute` + `z-10` 浮在 canvas 上层但不阻挡其他 overlays。

### Decision 6: design-token-foundation 删 `SceneCanvas.tsx` 文件级 exemption

bucket 2a 已经把 11 个 2D canvas 文件从允许列表删掉。本 change 进一步删 `SceneCanvas.tsx`。后续 candidate（不在本 change scope）：`Studio canvas`, `ZoneCanvas`, `PrefabThumbnail`, `company-creation-wizard-preview`, 3D mesh prefabs (`office3d-*`), `office3d-shared.ts`。这些文件的 hex 色多是材质 / 预览 / 编辑器内部艺术资源，scope 比本 change 大，留给后续 change 处理。

## Risks / Trade-offs

- **Risk**：RoomEnvironment 视觉与 apartment preset 有微小差异（PBR 反射色温略冷一些）。**Mitigation**：本 change 之前 `apartment` preset 在 release 是完全 fail 的，用户实际看到的是无 envmap 的退化材质 — RoomEnvironment 即使略冷也是改进。dev / web 模式两者都能加载，可以肉眼对比，发现差异大再调 PMREM `roughness` 参数（默认 0.04，可调到 0.08-0.12 软化）。
- **Risk**：`viewModeNonce` props 链路加一层，OfficeSceneSurface → SceneSurface → SceneCanvas 三层都要传。**Mitigation**：纯 number prop，无副作用，typecheck 强制完整传参。
- **Risk**：`useReducer` 取代 `useRef` + `useState` 改变 commit 频率（reducer 每次 dispatch 必 re-render）。**Mitigation**：dispatch 频率与原 `setForce2D` 等价（只在 crash / retry / nonce 变化时 fire），re-render 量级不变。
- **Trade-off**：去掉 `crashCountRef >= 2` 软上限意味着用户连点 retry 可能反复触发同一 crash。**Mitigation**：reducer 对每次 retry 重置 crashCount 但 lastError 还在；SceneFallbackBadge tooltip / hover 可显示 lastError，让用户看到为什么 retry 一直 fail（本 change 不强制做 tooltip，留作未来 polish）。

## Migration Plan

1. 落 `useProceduralRoomEnvironment` hook + 在 `scene-lighting-rig.tsx` 替换 `<Environment preset>`。Build & smoke test 3D 渲染（dev mode 能看到 PBR 反射）。
2. 落 `<SceneErrorPanel>` function component + `<SceneFallbackBadge>` + `SceneCanvas` reducer 重构 + viewModeNonce props 链路。删 `SceneCanvas.tsx` 的 `// raw-hex-allowed-file:` header。
3. `OfficeSceneSurface.tsx` 接 viewModeNonce + bump on toggle click。
4. `pnpm tokens:lint-hex` 必须 0 violation 且 `SceneCanvas.tsx` 不在 exempt 列表。
5. 串行 build + typecheck + lint（我改的文件）通过。
6. Self live verify on web (`pnpm --filter @offisim/web dev`)：dark/light 切 3D；故意注入 throw 验 SceneErrorPanel light/dark；force2D 鬼态后点 3D toggle 验 retry；fallback chip 可见可点。
7. Tauri release verify 留给用户。

无 rollback：纯 cosmetic + UX 修复，没有 data 副作用。回滚 = `git revert`。

## Open Questions

- `RoomEnvironment` 的 PMREM `roughness` 默认 0.04，需要 web live verify 时肉眼对比目前 dev 模式的 apartment preset，看是否需要调（本 change 默认沿用 0.04）。
- `SceneFallbackBadge` 是否需要展示 lastError 详情（hover tooltip）？本 change 默认只显示 `3D unavailable · Retry`，详细 error 留给 SceneErrorPanel（外层 boundary 接到时才展示）。如用户反馈 retry 失败原因不够透明，可后续 polish。
