## 1. Scaffolding

- [x] 1.1 创建 `apps/web/src/runtime/hooks/` 下 5 个空 hook 文件
- [x] 1.2 基线：`wc -l OffisimRuntimeProvider.tsx`（731）+ `grep -c 'useState\\|useRef' ...` + `grep '^export' ...`

## 2. 抽 `useRuntimeInit`（async lifecycle 唯一 owner）

- [x] 2.1 搬 `createBrowserRuntime(companyId)` 调用 + `disposeRuntime` cleanup + status/version ref 管理
- [x] 2.2 暴露 `reinit()` 回调（Settings 保存后触发）
- [x] 2.3 返回 `{ runtime, status, version, reinit, isInitializing }`
- [x] 2.4 确认全仓 `createBrowserRuntime\\|disposeRuntime` grep 只在 `useRuntimeInit.ts`（和现有 core 导出点）

## 3. 抽 4 个 sub-hook

- [x] 3.1 `useSceneIntentWiring({ runtime })`：`InMemorySceneIntentBus` + `SceneIntentDispatcher` 构建，runtime null 时 no-op
- [x] 3.2 `useNotificationBridge({ runtime })`：`NotificationBridge` 接 eventBus + teardown
- [x] 3.3 `useInteractionSync({ runtime })`：interaction mode / request / resolved / restored 三事件订阅 + state mirror
- [x] 3.4 `useUnfinishedThreadDetection({ runtime })`：idle 超时扫描 + unfinished threads list
- [x] 3.5 每 sub-hook runtime === null 时短路，不订阅

## 4. Barrel 瘦身

- [x] 4.1 `OffisimRuntimeProvider.tsx` 改成：调 `useRuntimeInit` → 调 4 sub-hook → useMemo 拼 `OffisimRuntimeValue` + `OffisimRuntimeStatusValue` → 两 Context Provider JSX
- [x] 4.2 删除原 async init 代码 / 事件订阅 / NotificationBridge wiring / idle-timer 扫描
- [x] 4.3 `UnfinishedThread` type export 保留在 barrel（消费者兼容）
- [x] 4.4 ≤ 250 NBNC gate 达成

## 5. Verification: typecheck + build

- [x] 5.1 shared-types → ui-core → core → ui-office → web 串行 build 全绿
- [x] 5.2 `pnpm typecheck` 26/26 绿

## 6. Verification: spec gates

- [x] 6.1 `ls apps/web/src/runtime/hooks/*.ts` 正好 5 文件
- [x] 6.2 sub-hook 之间 import 零匹配
- [x] 6.3 `createBrowserRuntime\\|disposeRuntime` in `apps/web/src/runtime/**` 只在 `useRuntimeInit.ts`
- [x] 6.4 barrel 无 `createBrowserRuntime\\|NotificationBridge\\|sceneIntentBus.on`

## 7. Live runtime verification

- [x] 7.1 dev server 冷启动，观察 status `initializing → ready` 序列（via fiber sampling — state machine 走过 initializing → ready）
- [x] 7.2 发一轮 task，ceremony / scene intent / interaction sync ✅ via live task。NotificationBridge reinit regression 已修并复测：fresh session reinit 后手动 emit `plan.completed` 正确产出 `notification.created`
- [x] 7.3 Settings 改 provider 保存 → `reinit()` 触发，version 1→2→3，isInitializing false→true→false
- [x] 7.4 company switch：old bus 订阅 204 → 0，new bus 204，无 listener leak
- [x] 7.5 idle detection：种一个 `running` thread + project row，reload 后 ResumeBar 正确渲染 `1 unfinished project`（natural 浏览器中断未复现 running row，是 orchestration 持久化问题，正交本 refactor）
- [x] 7.6 观察记录到 `verify-notes.md`（附带 Follow-up Fix 章节）

## 8. 最终 gate

- [x] 8.1 `openspec validate refactor-offisim-runtime-provider --strict` 全绿
- [x] 8.2 通知用户等 `/opsx:archive`
