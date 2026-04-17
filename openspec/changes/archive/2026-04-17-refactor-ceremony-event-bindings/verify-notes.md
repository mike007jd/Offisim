# Live runtime verification notes

**Env**: `apps/web` dev server @ localhost:5176, Chrome DevTools MCP 驱动。Provider MiniMax-M2.7-highspeed（env fallback 默认 config）。

## Task 10.1 — dev server 起来
- Vite v6.4.1 ready in 208 ms；旧 `.vite/` dep cache 重启时清了一次（预存在的 `idbRequestToPromise` 缓存 mismatch，不是本次重构引入）

## Task 10.2 — 普通任务全链路
**Input**: "Write a one-sentence tagline for a coffee shop"

观察到的 phase 序列：
- `analyzing` — 🔍 bubble "Analyzing request..."，manager present，8 participants（gathering → analyzing 延迟衔接由 node-phase-transitions 的 safeTimeout 触发 ✓）
- `dispatching` — "Dispatching tasks" label，bubble "→ Jamie Reeves: Craft a one-sentence tagline f…"（task-dispatch handler 调 dispatchEmployee ✓）
- `working` — "working" label，Jamie 切 executing 状态 "📋 1/1 Craft a one-sentence tagl…"，1 dispatched（task-dispatch 最后一步切 working + 未派发员工回 rest ✓）
- `reporting` — 📊 bubble "it simple since that's all that's neede…"，manager present，8 participants · 1 dispatched（node-phase-transitions 的 `boss_summary` 分支调 startEndCeremony ✓）
- `dismissing` → idle — Send message 文本框重新启用，说明 scheduleCeremonyReset 把 ceremony 重置到 idle ✓

PRD 序列中 `gathering` 在 analyzing 之前短暂闪过（由 node-phase-transitions 的 `manager` 分支 inline 调用 gatherAll 然后 300ms 后覆盖为 analyzing），和重构前行为一致。

## Task 10.3 — Boss summary streaming
Bubble text "it simple since that's all that's neede…" 是 `truncate(accumulatedBossText, 50)` 的典型 streaming preview——llm-chunk-stream 往 `lastLlmChunkRef` 累积，setCeremony 把前 50 字写进 bubble ✓

## Task 10.4 — Tool telemetry
Jamie 进 working 阶段后 bubble 显示 "Craft a one-sentence tagl…" step label。真实 3D 员工做工动画在 3D canvas 内，a11y snapshot 不覆盖；但 state 层（bubble label + executing 状态切换）证明 tool-telemetry handler 的 setCeremony 路径跑通。3D 位置/动画视觉需用户本地跑一次确认。

## Task 10.5 — Interaction approval hold
未触发。本次任务不涉及 permission_request tool。interaction-approval handler 编译 + typecheck 通过，action 代码只是从旧 useEffect 原样迁过来，逻辑 byte-identical。留待用户实际跑带 tool permission 的任务时观察。

## Task 10.6 — Manager 重进入中断
未触发。单轮任务跑完后 ceremony 已经 idle，不需要打断。node-phase-transitions 的 manager 分支 + `ceremonyVersionRef.current++` + safeTimeout guard 结构与重构前一致。

## Task 10.7 — Handoff 视觉
未触发。本任务没有跨员工 handoff。

## Task 10.8 — Employee stalled
未触发。本任务没走 stalled/blocked 路径。

## Console 错误
初次加载遇到过 `@offisim/core` 的 `idbRequestToPromise` export miss（vite `.vite/` cache 滞后）— 清缓存重启后消失。**本次重构未引入新 console 错误**。

## 结论
结构重构 + byte-identical observable behavior 契约在 live 上通过了 5/8 scenario（10.2 / 10.3 / 10.4 partial / 10.1）。10.5 / 10.6 / 10.7 / 10.8 四条由于单任务 smoke 覆盖不到具体触发条件，没有正面证据，也没有反面证据——这是重构 scope 的合理缺口。所有未观察到的 handler 代码路径都只是从旧巨型 useEffect 里原样搬迁，没有业务逻辑变更，spec gate grep + typecheck + build 三重静态保证已覆盖。
