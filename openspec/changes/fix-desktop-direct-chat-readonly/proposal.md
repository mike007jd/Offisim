## Why

2026-04-21 Tauri release live verify of `isolate-tauri-desktop-llm-credential` 5.4：桌面端 direct chat 发给单个员工（e.g. `Maya Lin`）`hi` 立刻抛 `Attempted to assign to readonly property.`，消息从未到达 transport 层。同一 bundle 里 team chat 一切正常（Boss 经 MiniMax 正常回复）。

问题定位在 direct chat 路径的一处 readonly / frozen 对象写入 —— 不在本次 credential isolation 范围内（team chat 同样走新 `llm_fetch`），是早就存在的 bug，只是 Tauri webview JSC 的 strict 模式比普通 browser 更严，把原本"静默 no-op"的 assignment 翻成 TypeError。

如果不修，桌面端唯一走得通的会话形态只有 team chat，direct chat 完全不可用，违反 "功能完成 = 用户真能用" 底线。

## What Changes

- **复现 + 抓 stack trace**（桌面 release bundle）定位具体赋值点 —— error message 本身不够细
- 基于 stack 根因修复。候选嫌疑：
  - `AgentState` / runtime snapshot（agent state 通常为保证不变性被冻结）
  - `useDirectChat` / 相关 conversation / session snapshot
  - Zustand store state 被绕过 `set(...)` 直接写
  - React ref / props / frozen config 对象
- **根因修**：替换成正规状态更新（`setState` / store action / clone-and-assign）。**不**用 `Object.defineProperty(writable:true)` 或浅层 unfreeze 绕过
- 回归验证：team chat 不坏；≥2 个员工的 direct chat 都能端到端回复

## Capabilities

### New Capabilities

（暂无。根因定位后若确为一整类问题再决定是否引入新 capability）

### Modified Capabilities

根因定位前**候选**（apply 阶段根据 stack trace 确认，最终可能只触一条）：

- `chat-streaming-ux`: 若根因在 streaming chunk commit / conversation snapshot 路径，追加一条 "direct chat strict-mode safety" scenario
- `employee-node-boundaries`: 若根因在 employee agent state 写入路径
- `runtime-provider-boundaries`: 若根因在 runtime context provider snapshot 路径

若根因确定为独立 UI hook 内局部 bug（非跨层契约），可能不需要触任何 canonical spec，仅记录 verify records 后 archive。此时 specs delta 为空（合规）。

## Impact

- **Code**：单路径修复（预计 1-3 个文件），无新依赖
- **UX**：桌面端 direct chat 从"立刻报错"恢复为可用。team chat / SOP dispatch / A2A external employee dispatch 路径不动
- **Migration**：无
- **Rollback**：revert commit 即可；无数据 / schema / config 迁移
- **Unblocks**：`isolate-tauri-desktop-llm-credential` 的 5.4 live verify 重跑（但该项已在原 change 标记 out-of-scope，cross-ref 到本 change）
