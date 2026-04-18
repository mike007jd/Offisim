## Context

`OffisimRuntimeProvider` 是 web 端 runtime 的组装中心——在 App.tsx 外层包住所有 ui-office 消费者，通过两条 Context 暴露 `OffisimRuntimeValue` 和 `OffisimRuntimeStatusValue`。731 行里混杂 async lifecycle、多个事件总线的 wiring、notification bridge、interaction 状态同步、idle 线程检测等职责；是 Round 2 B 级屎山中结构最典型的一条。

模式参考：
- `web-app-shell-boundaries`：App.tsx 794→311 NBNC，5 hook + 3 render-only 组件
- `scene-orchestrator-boundaries`：barrel + 5 lib 模块
- 本 change 对 Provider 走"5 hook + thin provider"路线（render-only 组件没必要，Provider 本身就是 JSX 很薄的东西）

## Goals / Non-Goals

**Goals:**

- Provider 文件 731 → ≤ 250 NBNC，只剩 Context 初值 + 5 hook 调用 + 两层 Provider JSX
- 5 个 hook 各自单一责任，cross-hook 数据流通过 barrel 显式传递
- Context shape（`OffisimRuntimeValue` / `OffisimRuntimeStatusValue`）byte-identical

**Non-Goals:**

- 不改 runtime 构建顺序（repos → buses → notification bridge → graph）
- 不改 Context 类型定义 / 消费者 hook 名称
- 不合并 两 Context 成一个（status 与 main 分离是既有设计，降低 re-render 面）
- 不引入测试

## Decisions

### D1. Hook 目录：`apps/web/src/runtime/hooks/`

**选择**：5 个 hook 落 `apps/web/src/runtime/hooks/`。

**理由**：web app 的 runtime wiring 专属，不跨包；与 `apps/web/src/runtime/OffisimRuntimeProvider.tsx` 同级子目录保持聚合。

### D2. `useRuntimeInit` 是 async lifecycle 唯一 owner

**选择**：`useRuntimeInit({ companyId })` return `{ runtime, status, version, reinit, isInitializing }`。内部完整包：

- async `createBrowserRuntime()` 调用 + dispose cleanup
- version ref 用于监控 company 切换触发 rebuild
- 失败回退 state（显示 error + retry）
- 暴露 `reinit()` 给 Settings 修改后触发重建

**理由**：async lifecycle 的 cleanup 时序敏感（dispose 旧 runtime → build 新的 → 切 ref），必须单 hook 内保证原子性。分散到多个 hook 会让 cleanup 顺序难以 reason about。

### D3. Sub-hook 接收已构建的 runtime，不感知 async init

**选择**：`useSceneIntentWiring({ runtime })` / `useNotificationBridge({ runtime })` / `useInteractionSync({ runtime })` / `useUnfinishedThreadDetection({ runtime })` 全部接 ready 的 runtime 对象（或 null，当 isInitializing 时）。`runtime === null` 时 sub-hook 内部 short-circuit。

**理由**：把 "is initializing" 的判断集中在 `useRuntimeInit`，sub-hook 只管 "runtime ready 之后做什么"；避免 5 个 hook 里各自复制初始化判断。

### D4. Context 组装在 barrel 的 useMemo 里

**选择**：barrel 里 `const runtimeValue = useMemo(() => ({ runtime, sceneIntentBus, ..., listRecentDeliverables, ... }), [runtime, ...])`。sub-hook 返回需要暴露的 piece，barrel 拼装。

**理由**：Context value 聚合的是多个 hook 产出的片段（runtime / scene bus / unfinished threads / deliverable helpers），barrel 组装保持统一 refs；useMemo 依赖精确列出防误 re-render。

### D5. `UnfinishedThread` 类型保留为 Provider 文件导出

**选择**：`export interface UnfinishedThread`（被 `OffisimRuntimeValue` 引用）继续从 `OffisimRuntimeProvider.tsx` export。即使 implementation 搬进 hook，type 仍留原位。

**理由**：消费者 import `import { UnfinishedThread } from '.../OffisimRuntimeProvider'` 不改；hook 文件 import 这个 type 构建返回值。符合 "public API byte-identical" 目标。

## Risks / Trade-offs

- **风险：reinit 触发时 sub-hook cleanup 顺序**→ React 会按 sub-hook 注册的反序调用 cleanup（LIFO）。`useRuntimeInit` 必须在 sub-hook 之前注册（barrel 顶部第一个调用），保证它的 dispose 最后跑，此时 sub-hook 的 subscription 已经 unsubscribe。通过 spec scenario 固化。
- **风险：跨 hook 共享 ref（e.g. interaction state）丢同步**→ 通过 barrel 显式传递而不是 module-level。
- **风险：live verify 覆盖**→ 必须覆盖：冷启动、运行一轮任务、Settings provider 修改后 reinit、company switch、页面 refresh。
- **Trade-off：6 文件替代 1 文件**→ 接受。runtime lifecycle 是高风险代码，拆细更易 review。
