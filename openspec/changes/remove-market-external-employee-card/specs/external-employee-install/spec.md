## REMOVED Requirements

### Requirement: Market workspace exposes discovery entry for external A2A agents

**Reason**: Q1 决策（2026-04-24）—— Market 永远只展示 Offisim 自家生态。外部员工接入是独立的 A2A 系统，业务边界与 Market 商店分离。原本 pinned 在 Market Explore grid + Manage Installed 顶部的"Connect external A2A agent"入口属于业务越界，应整体撤除。

**Migration**: 用户接入外部 A2A agent 的唯一入口改为 Settings → External Employees tab（已存在，参见 Requirement "Settings workspace exposes an External Employees management tab"）。该 tab 同样持有 `ExternalEmployeeInstallDialog`，3-step discovery → preview → confirm 流程不变。所有 discovery / brand inference / persistence / dispatch / render 行为契约保持不变；删除的只是 Market 表面的入口卡片。
