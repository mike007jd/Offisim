AI Company Simulator — PRD v1.6

开源本地 AI 公司运行时 + 官方人才市场网站 + 可安装资产分发体系 + 多 Agent 协作内核

|     |
|-----|

| **Version** | 1.6 |
|:---|:---|
| **Date** | 2026-03-06 |
| **License** | Open Source Runtime + Operated Marketplace |
| **Revision Goal** | 把 1.0 方向进一步收紧为“多 Agent 协作运行时 + 市场网站 + 资产安装协议”，并明确模型选择权归用户本地运行时 |
| **Primary Audience** | 产品负责人 / 架构师 / 设计与工程协同 |
| **Companion Doc** | AI Company Simulator — Tech Stack v1.5 |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr>
<th>本次修订重点<br />
明确产品三层：My Company Runtime、Asset Distribution、Talent Market Website。<br />
强调多 Agent 协作是产品核心；模型/provider/agent runtime 保持用户本地可替换。<br />
把 Install / Import / Fork / Publish 拆成独立概念，避免“市场页面商品 = 本地实例”的混淆。<br />
新增环境能力矩阵、权限与 Secrets 规则、版本兼容与迁移规则，并禁止 1.0 资产包执行任意安装脚本。</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

**Contents**

1.  **1. Product Definition**

- Positioning & philosophy

- Open-source boundary

- Deployment model

- Environment capability matrix

2.  **2. Core Module: My Company**

- Office scene

- Employees & workstations

- System agents

- Interaction & outputs

- Editors & observability

3.  **3. Asset System & Talent Market**

- Asset categories

- Listing vs Package vs Installed Instance

- Install model

- Manifest

- Trust & governance

4.  **4. SOP, Templates & First-Time Experience**

- SOP as reusable asset

- Default templates

- Onboarding

5.  **5. 1.0 Functional Requirements**

- Runtime

- Marketplace

- Install pipeline

- Platform services

6.  **6. Non-functional Requirements & Metrics**

- Security & privacy

- Performance

- Reliability

- Ecosystem metrics

7.  **7. Glossary**

# **1. Product Definition**

| AI Company Simulator 不是一个把所有东西托管在云端的 SaaS，也不是游戏引擎。它是一个用办公室隐喻包装的本地优先 AI 公司运行时；市场网站负责发现、声誉、分发与交易，真正执行任务的是用户自己的运行环境。产品差异点在多员工协作、交接、会议与可观测性，而不是绑定某个特定模型或 coding CLI。 |
|----|

## **1.1 Product Positioning**

一句话定义：AI Company Simulator = 开源本地 AI 公司运行时（My Company） + 官方人才市场网站（Talent Market） + 可安装资产分发模型（Asset Distribution）。

- 用户以“老板”身份通过自然语言驱动公司运转；Manager 负责路由、PM 负责拆解、员工在工位执行。

- 办公室隐喻不是游戏化包装，而是降低理解成本的语义系统；不会引入经验值、等级、抽卡、数值成长等游戏机制。

- 市场中的员工、Skill、SOP、公司模板不是网站里的静态条目，而是可被本地公司安装、导入、运行和再创作的资产。

- 平台网站负责目录、账户、创作者主页、评分、Fork 溯源、通知、可选交易与分账；不负责替用户长期托管其公司的核心运行时。

## **1.2 Design Philosophy**

| **原则** | **含义** | **对 1.0 的要求** |
|:---|:---|:---|
| Office-first semantics | 通过办公室空间、工位、气泡、会议室、汇报厅来表达抽象 AI 流程 | 所有核心能力都能映射到清晰的现实办公语义 |
| Local-first runtime | 公司数据、LLM 配置、MCP 绑定默认保留在用户控制环境中 | 断开市场后，公司仍可运行 |
| Install before fork | 先把资产安装到本地再使用；Fork 是再创作动作，不等于安装 | Install / Import / Fork / Publish 必须是独立流程 |
| Capability transparency | 外部能力通过 MCP 与权限声明暴露，不隐式授权 | 包只能声明需要的能力，不能携带真实密钥 |
| Model/provider/runtime agnostic | 不把产品锁死在某个模型、provider 或 agent runtime；这些都由用户本地配置决定 | 市场资产只提供推荐信息，运行时最终解析权在用户本地 |
| Multi-agent collaboration first | 老板/Manager/PM/员工之间的协作编排、handoff、meeting、interrupt/resume 是核心体验 | 1.0 先把多员工协作与可观测性做实，不把外部 coding harness 作为产品主概念 |

## **1.3 Open Source Boundary**

| **模块** | **开源状态** | **说明** |
|:---|:---|:---|
| My Company Runtime | ✅ 开源 | 办公室场景、员工系统、工位/MCP Hub、Manager/HR/PM、SOP、Library、Pitch Hall、办公室编辑器、员工编辑器、本地 LLM Gateway、基础安装器。 |
| Asset Package Spec | ✅ 开放规范 | Manifest、兼容性字段、权限声明、完整性校验、来源信息等应公开，便于社区资产可移植。 |
| Talent Market Website / Registry | ❌ 平台运营 | 公开目录、创作者页、评分、发布审核、通知、账户体系、可选交易与分账。 |
| Commercial Operations | ❌ 平台运营 | 风控、纠纷处理、提现、税务、审查、推荐算法、赞助与付费能力。 |

## **1.4 Product Layers**

| **层** | **核心职责** | **用户感知** |
|:---|:---|:---|
| My Company Runtime | 执行任务、保存本地公司数据、管理工位权限、生成产出 | “我自己的 AI 公司” |
| Asset Distribution | 解析资产包、兼容检查、安装/升级/回滚、导入/导出 | “把资源装进我的公司” |
| Talent Market Website | 浏览、搜索、创作者声誉、发布、下载入口、通知、可选交易 | “发现并获取资源的网站” |

## **1.5 Operating Strategy**

1.0 的运营策略采用 Reputation-first：先把开源运行时和生态做出来，用名声、作品案例、创作者信誉和社区传播换增长；变现能力保留，但不要求在首发期就把平台做成重交易中心。

- 首发阶段：运行时免费、市场以目录与分发为主、支持创作者主页、公开评分、安装链接、捐赠入口。

- 早期营收：以 GitHub Sponsors / Buy Me a Coffee / 平台赞助为主，可选平台会员与精选曝光位。

- 后续商业化：在生态成熟后再开启付费资产、平台抽成、创作者分账、提现与税务流程。

## **1.6 Deployment Model**

| **部署方式** | **目标用户** | **说明** |
|:---|:---|:---|
| Hosted Web | 想立刻试用的所有用户 | 官方托管、浏览器即用、最轻学习成本，但受浏览器沙箱限制。 |
| Desktop App (macOS first) | 重视隐私、本地工具集成、需要深度安装体验的用户 | 本地运行、支持文件系统、deep link、本地模型、localhost MCP。 |
| Docker Self-host | 想自部署、保留控制权的个人或团队 | 自托管网站与平台服务；UI 仍以浏览器访问为主，能力取决于部署网络与配置。 |

## **1.7 Environment Capability Matrix**

说明：Desktop 是 1.0 的 reference environment；Hosted Web 与 Docker Self-host 共用浏览器约束，除非某项能力被部署方显式迁移到宿主机侧。

| **能力** | **Hosted Web** | **Desktop** | **Docker Self-host** |
|:---|:---|:---|:---|
| 离线运行现有公司 | 部分可用（依赖浏览器持久化） | 完全可用 | 部分可用（浏览器端持久化） |
| 导入/导出本地资源包 | 通过文件选择器 | 完全可用 | 通过文件选择器 |
| Link Install（一键安装） | 可用，但受浏览器限制 | 完全可用（推荐） | 可用 |
| File Import（zip/manifest） | 可用 | 完全可用 | 可用 |
| localhost MCP / 本地命令行工具 | 默认不支持 | 支持 | 仅部署主机侧可配置 |
| Editor MCP Server | 默认不支持 | 支持 | 仅部署主机侧可配置 |
| Ollama / 本地模型 | 默认不支持 | 支持 | 部署主机侧可配置 |
| 本地 Secrets 安全存放 | 有限 | 支持 | 取决于部署实现 |
| 市场浏览与安装目录 | 支持 | 支持 | 支持 |

# **2. Core Module: My Company**

| My Company 是开源运行时本体。它必须在不依赖市场平台的前提下独立完成：组织 AI 员工、保存公司结构、绑定工具权限、执行任务、生成产出。 |
|----|

## **2.1 Office Scene**

办公室场景是默认主界面，采用 2D 俯视图。它承载部门分区、走廊动线、家具布局、工位、会议室、图书馆、机房、汇报厅等空间语义。

- 视觉目标：真实办公室而非游戏地图；程序美术生成，无重手绘依赖。

- 交互目标：拖拽员工入座、移动家具、划定部门区域、查看员工状态气泡、从空间理解工作流。

- 反馈目标：所有关键进度通过空间中的动作与气泡可视化，而非仅靠日志面板。

## **2.2 Employee System**

每个员工都是可配置 Agent 实例，拥有角色、个性配置、Skill、履历、版本历史，以及可选的创作者推荐模型说明。真正采用哪个 provider、模型或 agent runtime，由用户本地运行时解析与调度。

| **员工维度** | **要求** |
|:---|:---|
| Role / Title | 支持普通员工与系统员工（Manager / HR / PM），显示名称可改但系统职责固定。 |
| Model Profile / Resolver | 员工可携带推荐模型档位或成本/质量偏好，但最终 provider / model / runtime 由本地 LLM Gateway 与用户策略解析。 |
| Personality / Instructions | 通过低门槛面板配置，也支持高级文本模式。 |
| Skills | 以 Skill Card 形式挂载，可测试、可组合、可上架、可复用。 |
| Version History | 每次重大修改形成可回滚快照；支持对比来源与 Fork 链。 |

## **2.3 Workstations, MCP Hub & Server Room**

核心原则：权限留在工位，能力随人走。工位声明 MCP slots；员工坐下时拿到可用工具，离座时权限被撤回。

- Workstation 绑定的是能力槽位与可暴露工具，不是具体员工身份。

- Rack 保存外部服务连接信息；Slot 只声明该工位允许暴露哪些工具；Employee 不直接持有平台级授权。

- 工具最小权限暴露必须是产品默认；员工切换工位后权限自动切换。

## **2.4 System Agents**

| **系统 Agent** | **职责** | **边界** |
|:---|:---|:---|
| Manager | 所有老板输入的第一道路由层，决定是招聘、拆解、直接执行还是澄清。 | 不负责底层执行，不持有长期业务状态之外的特殊超权。 |
| HR | 招聘、绩效追踪、岗位建议、入职管理、市场检索。 | 不直接进行复杂任务拆解。 |
| PM | 把模糊目标拆解为结构化任务图（DAG），分配并监控执行。 | 不永久拥有市场/支付权限。 |

## **2.5 Bubble System, Interaction & Outputs**

- Bubble System：员工头顶气泡表达 Idle / Working / Searching / Meeting / Queued / Error / Reporting 等状态，以及关键进度、引用数、成本与错误原因。

- Default Interaction：老板默认通过聊天输入指令，Manager 路由后由 PM/员工执行；也支持点开员工进行一对一对话。

- Meeting Room：用于 Brainstorm、Kickoff、Standup、Review 等显式会议；老板插话时流程可暂停并响应。

- Library：支持 PDF / TXT / MD / DOCX / URL 等资料接入，员工检索时必须带来源与引用信息。

- Pitch Hall：所有正式产出在此汇报、微调与下载，支持 DOCX / PPTX / PDF / CSV / XLSX / HTML / 代码等格式。

## **2.6 Editors & Observability**

1.0 需要两个正式编辑器：Office Editor 与 Employee Editor；同时保留 Boss Dashboard、Notification Center 与 Error Handling 作为运行时可观测性基础设施。

| **模块** | **1.0 要求** |
|:---|:---|
| Office Editor | 拖拽布局、部门区划、工位属性、空间类型、主题与默认模板生成。 |
| Employee Editor | 角色配置、个性面板、Skill 管理、版本历史、测试对话。 |
| Boss Dashboard | 成本、状态、错误、队列、产出与关键 KPI 聚合。 |
| Notifications | 本地事件 + 市场通知统一呈现。 |
| Error Handling | 失败原因可读、支持重试/换人/换模型/查看来源。 |

# **3. Asset System & Talent Market**

| 市场网站不是运行时本体。它的职责是把资产变成可发现、可评价、可获取、可追溯的对象；真正被安装和执行的是 Package，而不是网页条目。 |
|----|

## **3.1 Asset Categories**

| **资产类型** | **用户看到的价值** | **安装后落地形态** |
|:---|----|:---|
| Employee | 一个可上岗、可面谈、可再训练的员工模板；可附创作者推荐模型说明 | 本地 employee instance + 关联 skills / config snapshot |
| Skill Card | 可复用能力单元；默认不绑定具体模型 | 挂到员工或系统 Agent 上的 skill binding |
| SOP | 可复用工作流 / DAG；默认模型无关 | 本地 workflow template，可直接执行或继续编辑 |
| Company Template | 一整套公司结构、员工、布局与 SOP 初始盘；模型选择在安装后本地解析 | 新公司初始化模板 |
| Office Layout | 办公室布局与空间配置；模型无关 | 局部或整套布局导入 |

## **3.2 Listing vs Package vs Installed Instance**

| **概念** | **定义** | **是否在用户本地产生状态** |
|:---|:---|:---|
| Listing | 市场网站中的公开条目，包含描述、截图、评分、作者、版本、安装入口。 | 否 |
| Package | 可下载/导入的资产包，包含 manifest 与 payload。 | 否（直到被安装） |
| Installed Instance | 装进某个本地公司后的真实实例，拥有本地状态与后续修改。 | 是 |
| Fork | 在已有资产基础上进行再创作并形成新的发布谱系。 | 是（先安装/编辑后发布） |

## **3.3 Install Model**

- Link Install：从市场详情页发起安装。桌面端优先通过 deep link / app protocol 拉起本地应用；Web 端可走登录态下载 + 浏览器导入。

- File Import：用户从任何来源拿到资产包（zip + manifest.json），再在本地公司中导入。

- Direct URL / External Registry：允许把下载地址指向 npm、GitHub Releases、对象存储或其他兼容源；平台可以只保存元数据与来源链接。

- Install 与 Fork 必须分开：Install 是为了使用资产，Fork 是为了修改后形成新谱系。

- 1.0 的资产包默认采用声明式导入，不允许任意 install hooks / postinstall scripts；需要额外绑定时，只能通过本地显式授权向导完成。

## **3.4 Package Manifest (规范级字段)**

| **字段** | **作用** |
|:---|:---|
| asset_id / package_id | 全局唯一标识符。 |
| kind | employee / skill / sop / company_template / office_layout。 |
| version | 当前包版本。 |
| engine_range | 兼容的运行时版本范围。 |
| schema_version | 包内数据结构版本。 |
| license | 使用许可。 |
| fork_origin | 来源资产与版本，用于溯源与版税链。 |
| dependencies | 依赖的其他资产或最小运行时能力。 |
| required_mcps / required_tools | 所需外部能力声明。 |
| recommended_model_profile / tested_profiles（可选） | 主要用于 Employee 资产的创作者推荐说明；帮助用户理解适配的模型档位，但不强制绑定 provider 或具体模型。 |
| integrity_hash | 完整性校验值。 |
| signature / publisher_id | 发布者签名与身份。 |
| source_url | 实际下载地址。 |

## **3.5 Versioning, Compatibility & Migration**

- 安装前必须检查 engine_range、schema_version、dependencies 与 required capabilities；模型信息只作为提醒或推荐，不形成强制阻塞。

- 升级时允许 preview diff、兼容检查、migration 预览与失败回滚。

- 本地实例升级后保留 provenance：记录来源包、安装时间、升级链与用户本地修改。

- 不兼容的资产不得静默安装；需要清晰提示是引擎过旧、依赖缺失还是权限未绑定。

## **3.6 Trust, Permissions & Secrets**

- 市场资产只能声明所需能力，不能携带真实 API keys、OAuth tokens、cookie、私有数据库密码等 secrets。

- 安装后由用户在本地重新绑定连接；高风险资产必须明确展示其要求的 MCP、工具类型与风险等级。

- 带 MCP 声明的员工/Skill/SOP 需要显示权限摘要：读取什么、写入什么、是否能执行命令、是否会触发外部副作用。

- 平台要保留举报、下架、签名验证、作者验证与风险提示机制。

## **3.7 Publish, Moderation & Reputation**

- 发布前执行基础校验：manifest 完整性、结构合法性、来源签名、敏感信息扫描、截图与文案审查。

- 市场条目需要创作者页、评分、Fork 链、更新记录、兼容版本、安装数/收藏数等信誉信号。

- AI 审核可以做首层过滤，但不能替代平台治理；高风险能力与纠纷仍需人工介入路径。

## **3.8 Monetization Phases**

| **阶段** | **定位** | **收费策略** |
|:---|:---|:---|
| Phase 0 | 名声与生态优先 | 免费目录 + 捐赠 / 赞助 / Buy Me a Coffee / Sponsors |
| Phase 1 | 平台能力完善 | 可选创作者会员、精选位、团队特性，不强制付费 |
| Phase 2 | 交易与分账 | 付费资产、平台抽成、创作者分账、提现与合规流程 |

# **4. SOP, Templates & First-Time Experience**

## **4.1 SOP as Reusable Asset**

SOP 是从成功任务中沉淀出来的 DAG 资产：它既是运行时工作流，也是可被市场分发的知识单元。

- PM 在任务完成后可将成功路径保存为 SOP 模板。

- SOP 必须记录所需角色、输入/输出接口、依赖工具与验证样例；创作者可附推荐员工配置或推荐模型说明，但不形成强绑定。

- SOP 在本地可直接执行，也可作为市场资产发布、安装与 Fork。

## **4.2 Default Company Templates**

1.0 需要提供少量官方默认模板，帮助新用户在 1 分钟内看到可运行的公司。模板属于资产体系的一部分。

| **模板方向**   | **包含内容**                         | **目标人群**          |
|:---------------|:-------------------------------------|:----------------------|
| Content Studio | 写作者/研究/设计/社媒运营基本盘      | 内容创作者            |
| Product Team   | PM / Research / Design / QA 协作模板 | 独立开发者或小团队    |
| Agency Lite    | 客户沟通、交付、模板化 SOP           | 自由职业者/小型工作室 |

## **4.3 First-Time User Experience**

- 首次进入时，HR 先交付一个最小可运行团队，而不是让用户面对空白编辑器。

- 用户可以直接给老板下指令，30–60 秒内看到气泡、协作过程与首个可下载产出。

- 新手流程中允许“以后再配置”模型与外部工具；但需要明确哪些能力未启用。

# **5. 1.0 Functional Requirements**

| **产品面** | **1.0 必须具备** | **验收标准** |
|:---|:---|:---|
| Runtime | Boss chat、Manager routing、PM DAG、员工执行、气泡反馈、Pitch Hall 输出。 | 能够从一句自然语言指令走到正式产出下载。 |
| Office | 办公室场景、工位拖拽、部门与基础布局编辑。 | 用户能看懂并操作公司结构。 |
| Employees | 员工创建/编辑、Skill 绑定、版本历史、面谈式入职。 | 用户不需要碰 prompt 也能完成基础配置。 |
| Permissions | Rack / Slot / Employee 三级权限模型。 | 能力跟工位走，离座即撤权。 |
| Marketplace | 公开目录、详情页、创作者页、安装入口、评分与 Fork 溯源。 | 外部用户能发现并获取资产。 |
| Install Pipeline | Link Install、File Import、兼容检查、失败回滚。 | 安装结果可预测、可恢复。 |
| Publishing | 资产发布、审核、版本更新、下架/举报。 | 平台可控地管理 UGC。 |
| Observability | 成本、状态、错误、通知、队列与下载记录。 | 用户能理解系统当前在做什么。 |

# **6. Non-functional Requirements & Metrics**

| **类别** | **要求** |
|:---|:---|
| Security | 市场包不能携带 live secrets；权限声明必须可见；高风险资产有明显提示。 |
| Privacy | 公司核心数据默认不上传平台；断开平台后本地公司仍可运行。 |
| Performance | 首屏可感知 \< 1s；首个有效产出 \< 60s；办公室场景 60fps 稳定。 |
| Reliability | 长任务支持恢复；安装失败可回滚；错误具备可读解释。 |
| Compatibility | 包与引擎的版本边界清晰；安装与升级前有显式检查。 |
| Operations | 市场具有审核、通知、创作者身份与下架机制。 |

## **6.1 Success Metrics**

| **指标**                 | **定义**                                | **目标** |
|:-------------------------|:----------------------------------------|:---------|
| Time to First Output     | 新用户拿到第一个正式产出的时间          | \< 60s   |
| Task Completion Rate     | AI 团队自主完成任务成功率               | \> 80%   |
| Boss Intervention Rate   | 需要老板频繁中断/重做的任务比例         | \< 20%   |
| Install Success Rate     | 资产安装成功率（含兼容检查后通过）      | \> 95%   |
| Asset Reuse / Fork Depth | 资产被安装、复用并继续 Fork 的程度      | 持续增长 |
| Creator Activation       | 注册创作者中成功发布至少 1 个资产的占比 | 持续增长 |

# **7. Glossary**

| **术语**                  | **定义**                               |
|:--------------------------|:---------------------------------------|
| My Company                | 用户自己的本地 AI 公司运行时。         |
| Talent Market             | 官方市场网站与注册表。                 |
| Listing                   | 市场页面中的公开条目。                 |
| Package                   | 可下载/可导入的资产包。                |
| Installed Instance        | 安装到本地公司后的真实对象。           |
| Fork                      | 基于已有资产继续修改并形成新谱系。     |
| Rack / Slot / Workstation | MCP 服务、权限槽位、工位三层授权模型。 |
