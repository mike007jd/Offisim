## Context

Offisim 正在把 provider 配置从底层协议标签重构成面向用户的 product taxonomy，这会放大一个旧问题：provider/model 元数据现在缺少稳定的上游治理机制。官方文档和 live catalog 更适合定义 `baseURL`、`auth`、`region`、产品命名与官方 capability；LiteLLM 这类社区聚合源更适合发现新模型、上下文窗、价格、以及 endpoint 支持面变化，但其字段可信级别不应与官方源等同。

如果没有统一 source registry，taxonomy、provider matrix、settings preset 和 harness 验证会继续各自维护一份不完全一致的事实表，后续每接一个新 provider 都会加剧漂移。

## Goals / Non-Goals

**Goals:**

- 定义统一的 source registry schema，描述来源、可信级别、刷新策略与字段归属。
- 生成一个 repo-owned、可 diff 的标准化 catalog snapshot，作为 Offisim 内部事实底座。
- 让 LiteLLM 成为可消费的上游之一，但只在允许的字段范围内参与合并。
- 把“发现变化”和“对用户暴露变化”拆开，中间保留 review gate。

**Non-Goals:**

- 不在这个 change 里直接改 Settings UI 或 provider taxonomy 展示逻辑。
- 不把运行时 provider 选择改成在线请求第三方 registry。
- 不承诺一次性接完所有 provider 的官方 live catalog；先把 source model 和第一批 adapter 立住。

## Decisions

### 1. Offisim 维护 repo-owned generated catalog，而不是运行时直连外部源

运行时直连 LiteLLM 或官方 catalog 会把可用性、网络波动、字段变更直接带进产品路径。这里改为离线/受控刷新，产出 repo 内的标准化 snapshot 和 diff，供后续 taxonomy 与 matrix 消费。

备选方案是直接在运行时请求上游 registry。没有采用，因为这会引入不可控漂移，也不利于 review 和回滚。

### 2. Source registry 采用显式可信级别和字段归属

每个 source record 都声明：

- `sourceId`
- `sourceKind`
- `trustTier`
- `refreshMode`
- `ownedFields`
- `supportsProviders`

其中字段归属是核心。`endpoint`、`authMode`、`region`、`productName`、`execution lane hints` 这类产品关键字段默认只能由 `official-*` 或 Offisim curated override 拥有；LiteLLM 这类社区源只能补充模型、context window、pricing、capability hints，或提出冲突供人工 review。

备选方案是只设 source 优先级，不记录字段归属。没有采用，因为不同字段的可信源不同，只靠整体优先级会把社区源误抬到产品关键字段上。

### 3. Manual curated override 是最上层、最窄范围的控制面

Offisim 需要保留手工覆盖能力，用来修正上游错误、临时下线 provider、或在产品策略上延后曝光某些能力。这个 override 层优先级最高，但要求显式 provenance，并且尽量窄化到具体字段，避免重新回到“大而全手工表”的旧状态。

### 4. Refresh 输出必须是 diff-first，而不是 silent merge

一次刷新至少产出：

- 原始 source snapshot
- 标准化 merged snapshot
- 冲突和新增项 diff report

后续 provider taxonomy 或 matrix 只有在 merged snapshot 被 review/commit 后才可更新。这样可以把 LiteLLM 的快速变化转成“可见的候选更新”，而不是直接冲进产品。

## Risks / Trade-offs

- [官方源结构化程度不一致] → 允许官方 docs/repo 以手工映射或静态 fixture 先接入，后续再升级为 live fetch。
- [LiteLLM 与官方源冲突频繁] → 社区源默认不能覆盖保护字段，冲突进入 diff report。
- [source registry 增加了一层维护成本] → 用统一 schema、fixture 和 snapshot 取代分散维护，长期成本更低。
- [catalog 可能有刷新滞后] → 保留手工 override 与定期 refresh；产品事实优先稳定，不追求秒级同步。

## Migration Plan

1. 先引入 source registry schema、seed sources 和标准化 snapshot 输出。
2. 接入 LiteLLM 作为第一条社区聚合源，同时补一个最小的官方 source 集合。
3. 让 provider matrix / taxonomy 先从 generated catalog 读数据，但继续保留人工 review gate。
4. 后续再逐步把更多 provider 官方源纳入 refresh 流程。

## Open Questions

- 第一批官方 live catalog 覆盖哪些 provider，哪些先用文档/fixture 代替。
- diff report 最终落在 `openspec/`、独立脚本输出目录，还是单独的 generated manifests 目录。
- 是否需要把 harness 验证结果也回填进 source registry，作为“可用性”这一类衍生字段。
