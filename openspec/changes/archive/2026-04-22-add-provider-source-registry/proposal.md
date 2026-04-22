## Why

Offisim 现在的 provider/model 目录主要靠手工维护，随着各家兼容 endpoint、模型命名、上下文窗和 pricing 快速变化，维护成本和漂移风险都在上升。LiteLLM 这类社区聚合源很有价值，但不能直接当唯一真相源；我们需要一层明确的 source registry，定义哪些字段信官方、哪些字段可参考社区、以及变更如何进入产品目录。

## What Changes

- 引入 `provider source registry`，统一登记上游来源、来源类型、可信级别、刷新方式、以及字段归属。
- 定义一个 repo-owned 的标准化 provider/model catalog snapshot，记录每个字段的 provenance，而不是直接把第三方源暴露给产品。
- 增加第一批来源类型：
  - 官方 live catalog / 官方 API
  - 官方文档或官方仓库维护的静态资料
  - 社区聚合源，例如 LiteLLM
  - Offisim 手工 curated overrides
- 规定字段覆盖优先级：高可信官方字段与手工 override 保护 `endpoint`、`auth mode`、`region`、`product naming` 等关键字段，社区源只能补充或提出变更，不得静默覆盖。
- 规定 refresh 结果必须生成可 review 的 diff/snapshot，再进入产品目录或 provider matrix 更新流程。

## Capabilities

### New Capabilities
- `provider-source-registry`: 定义 provider/model 上游来源、可信级别、字段归属、provenance 和 review-gated 更新流程。

### Modified Capabilities

## Impact

- Affected code:
  - provider catalog / matrix generation scripts
  - future provider taxonomy input pipeline
  - source snapshot and diff artifacts under `openspec/` or adjacent tooling
- Affected systems:
  - provider/product catalog curation workflow
  - future automation or CI jobs that refresh upstream sources
- Affected behavior:
  - 新 provider/model 信息不再纯手工散落维护
  - 社区源引入会经过可信级别和 review gate，而不是直接改产品展示
