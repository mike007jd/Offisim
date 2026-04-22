## Context

Offisim 当前已经确认两件事：

1. 顶层 orchestration 不能交给 vendor SDK。我们的 boss / manager / employee / memory / tool-permission / checkpoint / runtime policy 都已经压在自研 LangGraph/harness 上，这层是产品能力，不是 transport 细节。
2. provider 接入又不能继续维持“全靠一个 raw gateway 分支”或“全靠某个 CLI 私有协议”两极。Anthropic 官方现在主推 Claude Agent SDK；OpenAI 侧则有 OpenAI Agents SDK；而 MiniMax、Kimi、Qwen/Model Studio、Z.AI 这类厂商的 coding/product docs 又分别落在 Anthropic-compatible 或 OpenAI-compatible 生态上。

因此新的目标不是“换掉 Offisim runtime”，而是把 vendor SDK 变成受控的 execution lane，并让 provider/preset 层显式声明支持矩阵。

## Goals / Non-Goals

**Goals:**

- 保留 Offisim LangGraph/harness 作为唯一顶层 orchestrator
- 建立统一 execution lane 模型：`gateway` / `claude-agent-sdk` / `openai-agents-sdk`
- 让 provider/preset 显式声明允许的 lane，而不是靠 compatibility label 隐式猜测
- 让 browser-limited、desktop-trusted、backend-harness 三类执行环境有清晰的 lane gating
- 先把后端式 harness 建成真验证面，再反向喂给桌面/前端产品面

**Non-Goals:**

- 不把 Offisim 重写成“纯 Claude Agent SDK 应用”或“纯 OpenAI Agents SDK 应用”
- 不假设所有 Anthropic-compatible provider 都能直接跑 Claude Agent SDK 全能力
- 不假设所有 OpenAI-compatible provider 都支持 OpenAI Agents SDK 所需的 Responses/tools/streaming 语义
- 不恢复 ACP 或任何 subscription/OAuth 代打产品路径

## Decisions

### D1. Offisim 只抽象“一条 active execution lane”，不抽象“多个并发主控 runtime”

每个 runtime/thread 在任一时刻只绑定一个 active execution lane。这个 lane 由 provider config 决定，可以是：

- `gateway`: 现有 `AnthropicAdapter` / `OpenAiAdapter`
- `claude-agent-sdk`: Anthropic 官方 agent loop 作为底层执行器
- `openai-agents-sdk`: OpenAI 官方 agents runtime 作为底层执行器

LangGraph 节点不直接 new vendor SDK client，而是都经过统一 execution adapter。

**Why**

- 保持当前 runtime 心智：一个 thread / 一个 active model execution binding
- 避免“boss 走 A lane、employee 走 B lane”的跨 lane 混乱

**Alternatives considered**

- 每个 role 单独选 lane：灵活，但排障和 checkpoint 语义会立刻复杂化
- 完全让 vendor SDK 接管 workflow：直接丢掉 Offisim 的产品护城河

### D2. `gateway` 保留为最低公共分母；agent SDK lanes 一律显式 opt-in

`gateway` lane 继续作为最通用、最容易 backend/web 统一的路径。任何 provider 至少要先能跑 `gateway`，才能考虑开放 agent SDK lane。

`claude-agent-sdk` / `openai-agents-sdk` 只有在以下条件成立时才开放：

- 官方文档明确支持该类工具或协议
- 我们完成真实 smoke/load/tool-call/edge 验证
- preset 明确声明该 lane 可用

**Why**

- compatibility label 只能说明“协议像”，不说明“agent runtime 全能力可用”
- 逐家验证比全量默认开放更稳

### D3. execution lane 受 execution mode gating

- `browser-limited`: 只允许 `gateway`
- `desktop-trusted`: 允许 `gateway`，并逐步开放可信宿主中的 agent SDK lanes
- `backend-harness`: 三条 lane 都可验证，是首个完整矩阵执行面

**Why**

- Claude/OpenAI agent SDK 都更适合 trusted runtime，而不是 webview
- 用户要“自己选路子”，前提是产品先知道在哪个环境下这个路子真的可走

### D4. Claude lane 与 OpenAI lane 分开建，不做一个“万能 agent sdk”抽象

Provider metadata 里保留 lane 粒度，而不是单一 `agent-sdk` 布尔值。

**Why**

- Claude Agent SDK 和 OpenAI Agents SDK 的模型、tool、session、transport、provider 扩展方式都不同
- 抽太平会把重要差异藏掉

### D5. 中国厂商按“官方已验证 lane”维护矩阵，而不是按国家/生态一刀切

首批观察对象：

- Anthropic-compatible / Claude coding path: MiniMax、Kimi、Qwen/Alibaba Model Studio、Z.AI
- OpenAI-compatible general path: OpenRouter、Kimi general API、Z.AI general/coding API、Qwen Responses/OpenAI-compatible 等

但默认策略是：

- 只有 `gateway` lane 可以靠 compatibility 先开
- agent SDK lane 必须逐家勾选 verified

### D6. harness 先行，前端后接

harness 需要升级为正式验证层，至少覆盖：

- `gateway` / `claude-agent-sdk` / `openai-agents-sdk`
- `smoke` / `shared-thread-load` / `isolated-load`
- queue depth / timeout / cancel / empty prompt / unicode / long context / tool-call / malformed auth / provider 4xx/5xx 分类

输出以 CLI + JSON summary 为主，先满足 backend 研发效率，再决定前端是否展示。

## Risks / Trade-offs

- [Provider drift] 厂商文档会持续变化，尤其 compatibility endpoint、model alias、tool 语义
  → Mitigation: provider lane 只按 verified matrix 开放，并把 protocols-ledger 纳入变更流程

- [Desktop integration complexity] agent SDK lane 在桌面端的可信宿主如何承载，还需要单独收口
  → Mitigation: backend-harness 先落，desktop-trusted 作为第二阶段

- [Surface area growth] 每个 provider 维护多 lane 会扩大配置与验证矩阵
  → Mitigation: `gateway` 做 baseline；agent lanes 严格 opt-in；UI 只展示 preset 支持的 lane

- [False equivalence] OpenAI-compatible 并不等于 OpenAI Agents SDK fully compatible
  → Mitigation: OpenAI lane 先从 OpenAI native 开始，第三方逐家验证，不做默认承诺

## Migration Plan

1. 先完成 ACP 删除与 canonical spec/document cleanup
2. 引入 execution lane schema，但默认所有 provider 仍落 `gateway`
3. 在 backend harness 中先接 `claude-agent-sdk`，从 Anthropic native + 一家 verified Anthropic-compatible provider 开始
4. 再接 `openai-agents-sdk`，从 OpenAI native 开始
5. 等 harness 证据充分后，再把 trusted desktop runtime / Settings UI 打开对应 lane
6. protocols-ledger 补入 Anthropic Claude Agent SDK 与 OpenAI Agents SDK 两行，并持续维护 verified provider matrix

## Open Questions

- desktop-trusted 环境里的 agent SDK lane 最终宿主是什么：Node sidecar、独立 backend service，还是别的 trusted host？
- `claude-agent-sdk` lane 是否首发只开 Anthropic native + MiniMax，还是把 Kimi/Qwen/Z.AI 一起纳入首批验证？
- `openai-agents-sdk` 对第三方 provider 是走官方 custom provider 接口，还是借 AI SDK adapter 统一封装？
- provider lane 选择是否需要按 model 细分，而不是仅按 provider/preset 细分？
