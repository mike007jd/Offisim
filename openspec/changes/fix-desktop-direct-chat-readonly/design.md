## Context

2026-04-21 Tauri release bundle live verify：

- **Team chat**：`hi` → Boss 经新 `llm_fetch` transport 正常 streaming 回复（MiniMax）
- **Direct chat**：`@Maya Lin hi` → 立即 `Attempted to assign to readonly property.`，消息根本没进 transport

同一 bundle、同一 provider、同一 secret，team chat 通而 direct chat 断，定位在 direct chat 独有的前置路径。

**JSC 严格度差异**：Tauri macOS webview 用 Safari 的 JavaScriptCore，对 `Object.freeze` / ES module 导出 / 冻结对象的赋值比 Chromium / browser dev mode 更严格 —— browser 里"静默 no-op"的赋值在 JSC 直接抛 `TypeError: Attempted to assign to readonly property.`。这类 bug 在 Chromium 下开发时不会暴露，必须 Tauri 真 runtime 才复现。

**约束**：

- 仅桌面发生，web 不复现（如复现应当在本 change 一并修）
- error 文案没带堆栈文件:行号 —— Tauri release bundle 的 Terser minify 把文件名折叠了。需要 source map + DevTools / `RUST_LOG=trace` 配合抓
- 修复必须是根因替换，不能用 `Object.defineProperty(writable:true)` / shallow unfreeze / `structuredClone` 套壳等 workaround

## Goals / Non-Goals

**Goals**

- Tauri release bundle 上 direct chat `@<任一员工> hi` 能端到端走通
- Team chat / SOP / A2A external employee dispatch 不回归
- 修复定位真实的 mutation 源头，而非绕过 freeze

**Non-Goals**

- 不动 transport / credential（`isolate-tauri-desktop-llm-credential` 的 scope）
- 不重做 direct chat UI / UX
- 不做 web 端改进（除非根因同源需要顺手修）
- 不引入 "direct chat strict-mode safety" 一类泛化 capability（先看根因形状再说）

## Decisions

### 先 repro + 抓堆栈再动代码

其它选择（基于症状猜点先改）在这类 bug 会反复：`Attempted to assign to readonly property.` 可能触发点包括 AgentState / conversation snapshot / Zustand store 直写 / frozen config / React ref 赋值等。猜改等于猜测哪层被冻 —— 修了一处还有下一处。

**Plan**：

1. 用 release bundle 重开，DevTools Sources 加载 source map（Tauri `tauri.conf.json` bundle 里是否启用 source map 要先确认，没有则临时改 `vite build --sourcemap` 重 bundle 一次）
2. Reproduce 的 breakpoint `pause on exceptions`
3. 抓完整 stack → 锁定赋值语句所在文件 / 行
4. 看 target 对象是什么（console 里 `Object.isFrozen(target)` / 看 prototype）

### 修复策略按根因形状分类

根据抓到的 target 对象类型走不同修法：

- **Zustand store 直接 mutate**（`store.getState().foo = bar`）→ 换成 `useFooStore.setState(s => ({ ...s, foo: bar }))` 或走既有 action
- **AgentState / snapshot 字段写入**（`agentState.x = y`）→ 走既有 reducer / event emit / repo update 路径，不在 render 层直写
- **React ref 写 readonly prop** 或 **frozen config 对象**（如 `provider-config` 类 SSOT）→ 产生新对象替换，不修改旧对象
- **TS 的 `readonly` 字段只在编译期约束**不会触发 runtime error，所以 target 几乎肯定是真 `Object.freeze(...)` 过的；可以用这条反推源头冻结点

### Canonical spec 延迟决定

若根因是跨层契约（e.g. "direct chat 的 conversation snapshot 必须不可变"），落 `chat-streaming-ux` 或 `runtime-provider-boundaries` 的 scenario；若只是局部 hook 里的遗留 mutation，canonical spec delta 可以为空，只改 code + 记录 verify records。

Archive gate 的 spec 一致性检查会在 apply 阶段根据根因重新判，不提前写死。

## Risks / Trade-offs

- **Risk**：source map 在当前 release bundle 可能没打开 → 抓不到原始文件行。**Mitigation**：先 check `apps/desktop/tauri.conf.json` + `apps/web/vite.config.ts` 的 `build.sourcemap` 设置；必要时临时 `sourcemap: true` 重 bundle 一次跑排查，完事回滚
- **Risk**：修完 direct chat 发现同样的 mutation 在其它路径也暗藏（只是没被走到）→ 扩散到 scope 外。**Mitigation**：抓到赋值点后 `grep` 同一 pattern 全仓检查；若发现其它路径有潜在 trigger，**不扩大 scope**，留 followup change
- **Risk**：根因在依赖包里（`@anthropic-ai/sdk` / `openai` 之类 frozen exports）→ 没法直接改。**Mitigation**：多数情况下该类 SDK 不会因 direct chat 路径才触发；若真碰到，走"包装一层 mutable adapter"而非改依赖
- **Trade-off**：先 repro 再修比直接猜改慢一轮，但避免多次返工；符合"根因优先"纪律

## Open Questions

- direct chat 是否在桌面 dev 模式（`pnpm --filter @offisim/desktop dev`）也复现？若 dev 可重现，不用 release bundle 排查。apply 第一步确认
- 是否仅 macOS 桌面复现？Windows / Linux Tauri webview 引擎不同（WebView2 / WebKitGTK）严格度行为可能不同。本轮只负责 macOS 过线，其它平台若有差异记 followup
