**AI Company Simulator — Asset & Schema Spec**

**接口级补充规格：Asset Manifest、Install Protocol、Registry API、Local/Platform Schema**

Companion Docs: PRD v1.6 / Tech Stack v1.5\
Date: 2026-03-06\
Goal: 把“能看懂方向”的文档推进到“工程可以直接拆任务”的层级。

------------------------------------------------------------------------

| **Spec focus** | 定义资产包格式、导入/安装状态机、注册表 API 边界，以及 Runtime / Marketplace 的核心数据模型。 |
|:---|:---|
| **1.0 hard rules** | Desktop 作为 reference environment；资产导入为声明式；禁止任意 install hooks / postinstall scripts；模型选择权留在本地运行时。 |
| **Deliverables in this package** | 本 DOCX + manifest JSON Schema + local runtime SQL draft + platform registry SQL draft。 |

# Contents

> 1\. Scope & design rules
>
> 2\. Asset taxonomy and package structure
>
> 3\. Manifest contract
>
> 4\. Install / import protocol
>
> 5\. Registry & marketplace API surface
>
> 6\. Local runtime schema (SQLite)
>
> 7\. Platform registry schema (Postgres)
>
> 8\. Example artifacts
>
> 9\. 1.0 non-goals and upgrade path

# 1. Scope & design rules

这份补充规格不重新定义产品方向，只把 PRD v1.6 和 Tech Stack v1.5 中已经确定的原则落到接口层。它回答四个问题：资产包长什么样、安装时客户端和平台各做什么、本地运行时怎样落表、平台注册表怎样落表。

本规格默认 1.0 采用“开放运行时 + 运营中的目录网站”模型。平台可以托管元数据、截图、审核结果与可选镜像，但不要求长期托管每个用户公司的执行环境。

## 1.1 Hard rules

| **Rule** | **Why it exists** | **Implementation consequence** |
|:---|:---|:---|
| Desktop reference environment | 本地模型、localhost MCP、深度导入、文件系统绑定都更适合桌面端。 | Web 版默认是 constrained mode；manifest 必须声明 supported_environments。 |
| Declarative installs only | 市场资产要能被审计、回滚、比较。 | 1.0 禁止 postinstall script、任意 shell 执行、二进制 installer。 |
| Model choice stays local | 资产是工作方式，不是把用户锁到某个 provider。 | 员工只允许声明 recommended model profiles，不允许强绑 provider/api key。 |
| No secrets in packages | 平台做分发，不做 secret transport。 | 包只能声明 secret slots；真实值由安装后的本地绑定流程填写。 |
| Install ≠ Fork | 使用和再创作是两个不同动作。 | Install pipeline 与 fork lineage 各自落表、各自审计。 |

## 1.2 Package design intent

平台中的 Listing 是目录页面；Package 是可下载/可导入的资产包；Installed Instance 是落到本地公司后的真实对象。一个 Listing 可以对应多个版本化 Package；一个 Package 可以同时安装到多个 Company；一个 Installed Instance 会记录绑定状态、启用状态、来源版本和本地覆盖。

1.0 只要求 package 是“声明式 + 可校验 + 可回滚”的数据载体，不要求它像 npm 那样成为泛用执行平台。

# 2. Asset taxonomy and package structure

资产分类直接影响审核强度、安装提示和默认权限。1.0 建议按风险而不是按市场栏目来分级。

## 2.1 Risk classes

| **Class** | **Typical assets** | **What is allowed** | **Default UX** |
|:---|:---|:---|:---|
| Data asset | office layout, theme, prompts, template copy | 静态配置、展示资源、参数模板 | 普通安装确认 |
| Logic asset | employee, skill, SOP, company template | 声明式流程、tool references、output contracts | 显示依赖、推荐模型、兼容性 |
| Privileged asset | 需要 MCP、外部连接器、文件系统访问的员工/技能 | 声明 capability、secret slots、network/file scope | 高亮风险、要求显式二次确认 |

## 2.2 Package file format

建议 1.0 统一使用 .aicspkg（zip 容器）作为文件导入格式。Registry 页面可以只保存元数据，也可以为部分资产托管镜像；无论来源如何，本地导入前都需要转成同一套 package descriptor。

| **Path** | **Required** | **Purpose** |
|:---|:---|:---|
| manifest.json | Yes | 包级元数据、兼容性、依赖、签名与 asset 清单。 |
| assets/ | Yes | 真正被安装的 payload；建议按 asset kind 分子目录。 |
| README.md | Recommended | 人类可读说明，供市场页与导入预览使用。 |
| previews/ | Optional | 截图、封面、小图标。 |
| checksums.json | Recommended | 逐文件哈希，便于差异检查和本地验证。 |

## 2.3 Asset kinds in 1.0

建议先把 kind 固定成六类：employee、skill、sop、company_template、office_layout、bundle。bundle 用来表达一组一起发布、一起安装的资产，但 bundle 本身仍然是声明式元数据，不引入安装脚本。

# 3. Manifest contract

manifest 是包的唯一入口文件。客户端、平台审核器、搜索索引、安装器都先看 manifest，再决定是否拉 payload。1.0 manifest 保持 JSON；字段命名以 snake_case / lower_snake_case 为主，便于不同运行时处理。

## 3.1 Top-level structure

建议的顶层对象：spec_version、package、compatibility、lineage、requirements、permissions、assets、distribution、integrity、previews、custom。custom 只允许放命名空间字段，不能覆盖标准字段的语义。

| **Field** | **Type** | **Meaning** |
|:---|:---|:---|
| spec_version | string | manifest 协议版本，例如 1.0.0。 |
| package | object | 包自身身份：id、kind、version、title、summary、license、publisher。 |
| compatibility | object | runtime_range、schema_version、supported_environments、migration notes。 |
| lineage | object | fork/origin/source 关系；为市场溯源与 credit 使用。 |
| requirements | object | capabilities、MCP、optional features、recommended models。 |
| permissions | object | 包声明的权限与风险标签；不含真实 secrets。 |
| assets | array | 包内具体资产条目及其 entrypoint。 |
| distribution | object | 原始下载源、registry mirror、artifact metadata。 |
| integrity | object | package sha256、signature、file hashes。 |
| previews | object | 截图、icon、readme、hero image。 |

## 3.2 Required package fields

| **Path** | **Req?** | **Example** | **Notes** |
|:---|:---|:---|:---|
| package.id | Yes | aics.employee.writer_pro | 全局稳定 ID；小写、点号分段。 |
| package.kind | Yes | employee | 只能是约定 kind。 |
| package.version | Yes | 1.2.0 | 语义化版本，平台与本地都按版本比较。 |
| package.title | Yes | Writer Pro | 人类可读标题。 |
| package.license | Yes | MIT / Custom-Market-EULA | 平台展示与安装确认都会用到。 |
| compatibility.runtime_range | Yes | \>=1.0 \<2.0 | 与 runtime 版本匹配。 |
| compatibility.supported_environments | Yes | \['desktop','docker'\] | 至少声明一个环境。 |
| assets | Yes | \[...\] | 至少有一个 asset。 |
| integrity.package_sha256 | Yes | ... | 文件级别校验基础。 |

## 3.3 Employee-specific guidance

员工是市场中最主要、也最可能和模型相关的资产。建议 employee asset 支持这些字段：persona、responsibilities、input_contract、output_contract、tool_profile、recommended_models、handoff_targets、meeting_behavior、review_policy、default_enabled。

recommended_models 只表达推荐，不表达硬依赖。它可以写成 profile 列表，例如“reasoning-heavy / code-first / cheap-draft / multimodal-review”，由本地 Model Resolver 决定最终映射到哪家 provider 或 agent runtime。

SOP、Skill、Template、Layout 默认不直接绑定模型。它们只在 requirements 中声明 capability 或推荐 profile。

## 3.4 Prohibited content in 1.0

> **•** 任何 install hook、postinstall script、shell 片段、binary bootstrapper。
>
> **•** 真实 API keys、OAuth refresh tokens、cookie、session、SSH 私钥。
>
> **•** 隐式网络权限；必须由 requirements / permissions 显式声明。
>
> **•** 要求 Hosted Web 直接访问本地文件系统或本地 CLI 的行为。

# 4. Install / import protocol

安装协议要同时覆盖三种来源：市场页一键安装、直接 URL 导入、文件导入。无论入口如何，客户端最终都走同一条状态机，这样才能统一回滚、重试、审计和可观测性。

## 4.1 Intake sources

| **Source** | **Trigger** | **Normalized outcome** |
|:---|:---|:---|
| Market install | 点击 listing 的 Install | 先取 registry descriptor，再下载 package 或镜像。 |
| URL import | 粘贴 package URL / signed descriptor | 先抓 manifest，再按 hash 校验 payload。 |
| File import | 拖拽 .aicspkg 或选择文件 | 直接在本地解析 zip 容器。 |

## 4.2 State machine

| **State** | **Owner** | **Purpose** | **Failure path** |
|:---|:---|:---|:---|
| discovered | client | 记录入口和目标 company。 | invalid_source |
| fetched | client | 拿到 descriptor / package。 | fetch_failed |
| validated | client | 校验 manifest、hash、schema、signature。 | validation_failed |
| review_required | client + user | 展示依赖、权限、推荐模型、secret slots。 | user_declined |
| ready_to_commit | client | 本地事务前最后检查。 | preflight_failed |
| materializing | client | 解包、写表、写文件、建实例。 | rollback |
| binding_pending | client + user | 填写 secret slots、选择模型 profile、映射 workspace。 | stays_pending |
| active | client | 安装完成并可启用。 | n/a |
| rolled_back | client | 清理半成品，保留失败审计。 | terminal |

## 4.3 Review screen contract

review_required 阶段至少显示五类信息：来源与发布者、版本与兼容范围、将安装哪些 assets、声明的 capabilities / secret slots、推荐模型 profile。安装确认只代表“允许导入这些声明”，不等于立即授予秘密值或启用所有高权限行为。

binding_pending 可以在安装后立即完成，也可以先以 disabled 状态保留，等用户稍后再绑定。

## 4.4 Rollback rules

materializing 必须是事务式的：数据库写入、文件复制、索引变更、启用状态切换要么全部成功，要么全部回滚。失败后保留 install_transaction、error_code、error_detail、source descriptor 和审计日志，但不留下半安装状态的活跃资产。

# 5. Registry & marketplace API surface

平台 API 分成两层：public read APIs 和 authenticated write APIs。公开读接口服务于 SEO 页面、客户端搜索、版本查询和安装预览；写接口服务于发布、评论、个人库、未来交易与创作者后台。

## 5.1 Public read APIs

| **Method** | **Path** | **Auth** | **Purpose** |
|:---|:---|:---|:---|
| GET | /v1/listings | No | 搜索与筛选，返回 listing 摘要。 |
| GET | /v1/listings/{slug} | No | 市场详情页。 |
| GET | /v1/listings/{slug}/versions | No | 查看版本历史。 |
| GET | /v1/packages/{package_id}/descriptor | No | 返回安装器需要的 descriptor。 |
| GET | /v1/creators/{handle} | No | 创作者主页、资产列表与 reputation summary。 |
| GET | /v1/reviews/{listing_id} | No | 公开评论与评分。 |

## 5.2 Authenticated APIs

| **Method** | **Path** | **Auth** | **Purpose** |
|:---|:---|:---|:---|
| POST | /v1/publish-sessions | Yes | 创建一次发布会话。 |
| PUT | /v1/publish-sessions/{id}/manifest | Yes | 上传或更新 manifest 草稿。 |
| PUT | /v1/publish-sessions/{id}/artifact | Yes | 上传 package 文件或登记外部 artifact。 |
| POST | /v1/publish-sessions/{id}/submit | Yes | 提交审核。 |
| POST | /v1/reviews | Yes | 发表评论/评分。 |
| GET | /v1/me/library | Yes | 已安装/已收藏/未来已购买资产。 |
| POST | /v1/install-sessions | Yes or optional | 生成带审计的安装 descriptor；免费资产可允许匿名。 |

## 5.3 Descriptor payload

descriptor 是平台返回给客户端安装器的最小可信单元。它不需要把整个 package 内联进去，只要给出 package_id、version、download_url、mirror_policy、sha256、signature、listing metadata、compatibility 摘要、risk summary 即可。

{

"descriptor_version": "1.0.0",

"package_id": "aics.employee.writer_pro",

"version": "1.2.0",

"download_url": "https://cdn.example/.../writer-pro-1.2.0.aicspkg",

"sha256": "9f2c...ab",

"risk_class": "logic_asset",

"supported_environments": \["desktop", "docker"\],

"recommended_models": \["reasoning-heavy", "cheap-draft"\]

}

## 5.4 Publish pipeline

发布侧建议采用 publish session，而不是一次性巨型上传。session 生命周期：created → manifest_uploaded → artifact_verified → submitted → moderation_pending → approved / rejected → listed。这样可以分别处理 manifest 校验、文件哈希、截图提取和审核结果。

# 6. Local runtime schema (SQLite)

本地 schema 目标不是把所有 UI 状态都持久化，而是支撑：资产安装、版本追踪、绑定状态、多 agent 执行、审计与回滚。建议按四个分区建表：runtime core、asset state、orchestration、telemetry。

## 6.1 Core tables

| **Table** | **Key** | **Purpose** | **Notes** |
|:---|:---|:---|:---|
| companies | company_id | 本地公司实体。 | 包含 status、default_model_policy、workspace_root。 |
| employees | employee_id | 员工实例。 | 指向来源 asset 与当前 workstation。 |
| workstations | workstation_id | 工位/房间位置。 | 管理 seat occupancy 与 office scene。 |
| racks | rack_id | MCP 服务注册。 | 不存真实密钥，只存 binding profile。 |
| slots | slot_id | 能力槽位。 | 定义某服务在本地暴露出的 capability set。 |
| installed_packages | installed_package_id | 每次安装的包记录。 | 记录 source、version、manifest_hash、enable_state。 |
| installed_assets | installed_asset_id | 包内 asset 的本地实例记录。 | 支持 per-asset enable/override。 |
| asset_bindings | binding_id | secret slots / model profiles / workspace mappings。 | 状态为 pending / bound / invalid。 |
| install_transactions | install_txn_id | 安装事务与回滚审计。 | 记录 state machine、error_code、actor。 |

## 6.2 Orchestration tables

| **Table** | **Key** | **Purpose** | **Retention** |
|:---|:---|:---|:---|
| graph_threads | thread_id | 每个 boss task / meeting / long-running flow 的主线程。 | 长期保留 |
| graph_checkpoints | checkpoint_id | durable checkpoints。 | 按策略清理 |
| task_runs | task_run_id | 任务级执行单元。 | 长期保留 |
| tool_calls | tool_call_id | 每次工具调用与结果摘要。 | 长期保留 |
| handoff_events | handoff_id | 员工之间的 handoff。 | 长期保留 |
| meeting_sessions | meeting_id | 会议上下文与轮次。 | 长期保留 |
| runtime_events | event_id | 较轻量的 timeline / bubble / status 事件。 | 可裁剪 |

## 6.3 Column-level notes

> **•** installed_packages.source_type: registry \| url \| file
>
> **•** installed_assets.asset_kind: employee \| skill \| sop \| company_template \| office_layout \| bundle
>
> **•** asset_bindings.binding_type: model_profile \| secret_slot \| workspace_map \| mcp_slot
>
> **•** graph_threads.entry_mode: boss_chat \| meeting \| install_flow \| background_sync
>
> **•** tool_calls.review_state: none \| pending \| approved \| blocked

# 7. Platform registry schema (Postgres)

平台 schema 主要服务于目录、创作者身份、版本化包、审核和声誉，不承载用户公司运行态。即使未来加入付费能力，交易表也应附着在 registry schema 旁边，而不是侵入 local runtime schema。

## 7.1 Core registry tables

| **Table** | **Key** | **Purpose** | **Notes** |
|:---|:---|:---|:---|
| users | user_id | 账户主体。 | Auth.js user 记录与最小 profile。 |
| creator_profiles | creator_id | 公开创作者页。 | handle、bio、verification_state。 |
| listings | listing_id | 市场条目。 | slug、kind、visibility、status。 |
| listing_versions | listing_version_id | 条目与 package version 的映射。 | 支持 latest / draft / retired。 |
| package_versions | package_version_id | 真正的可安装版本记录。 | hash、compatibility、artifact pointer。 |
| artifacts | artifact_id | 实际文件或外部引用。 | storage_backend、object_key、external_url。 |
| lineage_edges | edge_id | fork / derivative 关系。 | 供 credit、谱系图和搜索使用。 |
| reviews | review_id | 评分与评论。 | 可挂 moderation state。 |
| moderation_jobs | job_id | 审核任务。 | manifest scan、risk flags、status。 |

## 7.2 Optional but recommended tables

前期即使不收费，也建议预留这些表：creator_metrics、listing_metrics_daily、favorites、collections、install_receipts、donations。这样 reputation-first 运营期的数据不会丢。

如果未来再做交易，只需要额外引入 orders、licenses、payout_accounts、payout_events，而不是推翻现有 listing / package 结构。

# 8. Example artifacts

下面给出一个简化的 employee package manifest 例子，重点展示推荐模型、能力声明和 asset 条目。完整字段约束见随附的 JSON Schema。

{

"spec_version": "1.0.0",

"package": {

"id": "aics.employee.writer_pro",

"kind": "employee",

"version": "1.2.0",

"title": "Writer Pro",

"summary": "Long-form writing employee with review handoff.",

"license": "MIT",

"publisher": {"creator_handle": "alice"}

},

"compatibility": {

"runtime_range": "\>=1.0 \<2.0",

"schema_version": "2026-03",

"supported_environments": \["desktop", "docker"\]

},

"requirements": {

"required_capabilities": \["chat", "docs.write"\],

"required_mcps": \[\],

"recommended_models": \[

{"profile": "reasoning-heavy", "reason": "outline and critique"},

{"profile": "cheap-draft", "reason": "bulk drafting"}

\]

},

"permissions": {

"risk_class": "logic_asset",

"declares_secrets": false,

"filesystem_scope": "workspace",

"network_scope": "limited"

},

"assets": \[

{

"asset_id": "writer-pro-default",

"kind": "employee",

"path": "assets/employee.writer-pro.json",

"entrypoint": "default",

"default_enabled": true

}

\]

}

## 8.1 Review screen minimum fields

| **UI block** | **Must show** | **Why it matters** |
|:---|:---|:---|
| Source | creator, listing slug, version, hash | 用户要知道装的是谁发布的哪一版。 |
| Compatibility | runtime_range, supported_env, schema_version | 避免桌面/Web/Docker 装错。 |
| What will be installed | asset kinds, count, names | Install 与 Fork 的心智分离。 |
| Permissions | risk class, MCP needs, file/network scope | 高风险资产要显式可见。 |
| Bindings required | secret slots, model profiles, workspace mapping | 安装成功不代表立即可运行。 |

# 9. 1.0 non-goals and upgrade path

1.0 不做的事情：任意安装脚本、平台强托管用户公司运行时、市场资产强绑 provider、复杂依赖求解器、自动执行本地 CLI agent。

1.0 之后可以平滑扩展：增加 paid license / receipts；增加 registry mirror policy；允许更丰富的 bundle 关系；为高信任资产增加签名链与 verified publisher。

最重要的是先把“资产是可安装、可审计、可回滚的声明式对象”这条底座打稳。这样 PRD 的办公室语义、Tech Stack 的 runtime / registry / install protocol 三层，才能真正收口成一个可交付的 1.0。
