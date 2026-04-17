## 1. Scaffolding

- [ ] 1.1 创建 `apps/web/src/runtime/hooks/` 下 5 个空 hook 文件
- [ ] 1.2 基线：`wc -l OffisimRuntimeProvider.tsx`（731）+ `grep -c 'useState\\|useRef' ...` + `grep '^export' ...`

## 2. 抽 `useRuntimeInit`（async lifecycle 唯一 owner）

- [ ] 2.1 搬 `createBrowserRuntime(companyId)` 调用 + `disposeRuntime` cleanup + status/version ref 管理
- [ ] 2.2 暴露 `reinit()` 回调（Settings 保存后触发）
- [ ] 2.3 返回 `{ runtime, status, version, reinit, isInitializing }`
- [ ] 2.4 确认全仓 `createBrowserRuntime\\|disposeRuntime` grep 只在 `useRuntimeInit.ts`（和现有 core 导出点）

## 3. 抽 4 个 sub-hook

- [ ] 3.1 `useSceneIntentWiring({ runtime })`：`InMemorySceneIntentBus` + `SceneIntentDispatcher` 构建，runtime null 时 no-op
- [ ] 3.2 `useNotificationBridge({ runtime })`：`NotificationBridge` 接 eventBus + teardown
- [ ] 3.3 `useInteractionSync({ runtime })`：interaction mode / request / resolved / restored 三事件订阅 + state mirror
- [ ] 3.4 `useUnfinishedThreadDetection({ runtime })`：idle 超时扫描 + unfinished threads list
- [ ] 3.5 每 sub-hook runtime === null 时短路，不订阅

## 4. Barrel 瘦身

- [ ] 4.1 `OffisimRuntimeProvider.tsx` 改成：调 `useRuntimeInit` → 调 4 sub-hook → useMemo 拼 `OffisimRuntimeValue` + `OffisimRuntimeStatusValue` → 两 Context Provider JSX
- [ ] 4.2 删除原 async init 代码 / 事件订阅 / NotificationBridge wiring / idle-timer 扫描
- [ ] 4.3 `UnfinishedThread` type export 保留在 barrel（消费者兼容）
- [ ] 4.4 ≤ 250 NBNC gate 达成

## 5. Verification: typecheck + build

- [ ] 5.1 shared-types → ui-core → core → ui-office → web 串行 build 全绿
- [ ] 5.2 `pnpm typecheck` 26/26 绿

## 6. Verification: spec gates

- [ ] 6.1 `ls apps/web/src/runtime/hooks/*.ts` 正好 5 文件
- [ ] 6.2 sub-hook 之间 import 零匹配
- [ ] 6.3 `createBrowserRuntime\\|disposeRuntime` in `apps/web/src/runtime/**` 只在 `useRuntimeInit.ts`
- [ ] 6.4 barrel 无 `createBrowserRuntime\\|NotificationBridge\\|sceneIntentBus.on`

## 7. Live runtime verification

- [ ] 7.1 dev server 冷启动，观察 status `initializing → ready` 序列
- [ ] 7.2 发一轮 task，ceremony 跑完毕，确认 scene intent bus / notification bridge / interaction sync 全部正常触发
- [ ] 7.3 Settings 改 provider 保存 → 观察 `reinit()` 触发，`status → reinitializing → ready`，version 递增
- [ ] 7.4 company switch：新建或切公司，观察老 runtime dispose + 新 runtime build 无 leak
- [ ] 7.5 idle detection：任务中断（页面 backgrounded 或主动 cancel），idle 超时后 unfinished thread 被识别
- [ ] 7.6 观察记录到 `verify-notes.md`

## 8. 最终 gate

- [ ] 8.1 `openspec validate refactor-offisim-runtime-provider --strict` 全绿
- [ ] 8.2 通知用户等 `/opsx:archive`
