## Why

`apps/web/src/runtime/OffisimRuntimeProvider.tsx` 731 行单文件，同时承担：runtime init lifecycle（async build + 失败回退 + dispose cleanup）、scene intent bus wiring、notification bridge、interaction mode sync、interaction request/resolved/restored 订阅、unfinished thread detection（idle timeout + 自动重试）、deliverable hydration 暴露、vault directory status、reinit trigger（runtime version bump）。组件 body 30+ useState/useRef/useEffect 堆叠，改任何一条都要读完 731 行才知道依赖链。对齐 `web-app-shell-boundaries` 的 shell 拆分 + `scene-orchestrator-boundaries` composition hook 模式。

## What Changes

- **Thin provider**: `OffisimRuntimeProvider.tsx` 压到 ≤ 250 NBNC，只做 useState init context values + 调 5 个 sub-hook + 渲染两个 Context.Provider 嵌套（`OffisimRuntimeContext.Provider` + `OffisimRuntimeStatusContext.Provider`）。
- **5 个 composition hook** (`apps/web/src/runtime/hooks/` 子目录)：
  - `useRuntimeInit` — async runtime build（repos / buses / graph）+ dispose cleanup + 失败回退 + version bump 触发 reinit
  - `useSceneIntentWiring` — SceneIntentBus + SceneIntentDispatcher 构建与 rebind
  - `useNotificationBridge` — NotificationBridge 接 eventBus + teardown
  - `useInteractionSync` — interaction mode / interaction request / resolved / restored 三事件订阅 + state mirror
  - `useUnfinishedThreadDetection` — idle 超时扫描 + unfinished threads 列表暴露
- **保留**：`OffisimRuntimeContext` / `OffisimRuntimeStatusContext` 定义 + `OffisimRuntimeValue` type 不动（消费者 hook 路径 `useOffisimRuntime` 不变）。
- **可观测行为不变**：runtime 从 init → ready 的 status 序列、scene intents 的投递顺序、notification 弹窗、interaction mode 切换、unfinished thread 检测时机全部 byte-identical。

## Capabilities

### New Capabilities

- `runtime-provider-boundaries`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`apps/web/src/runtime/hooks/{useRuntimeInit,useSceneIntentWiring,useNotificationBridge,useInteractionSync,useUnfinishedThreadDetection}.ts`
- **文件重写**：`OffisimRuntimeProvider.tsx` 731 → ≤ 250
- **消费者无改动**：`useOffisimRuntime()` hook 消费者（ui-office / apps/web 内 20+ 处）import 路径 + 返回值 schema 不变
- **验证**：live runtime 从冷启动 → 首消息 → 多轮对话 → reinit（修改 provider 触发） → idle 恢复 unfinished thread detection 跑一轮，status 序列 byte-identical
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
