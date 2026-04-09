# 需求文档：Market 页面重建 (Market Page Rebuild)

## 简介

Offisim 的 Market（包市场）页面需要从零重建为全屏游戏商店风格界面。Market 作为独立全屏页面渲染在 FullPageWorkspaceShell 内（由 navigation-architecture spec 提供精简后的浮动 "← Office" 返回按钮 + 全视口 children）。本次重建将删除现有 `workspace/` 子目录下的 3-pane 组件，替换为 Steam/Epic Games Store/Fortnite Item Shop 风格的全屏卡片网格浏览体验。

本 spec 仅覆盖 Market 页面内容实现，不涉及导航架构变更（由 navigation-architecture spec 处理）。

## 术语表

- **Market_Page**: Market 全屏页面入口组件，路由 Explore/Detail/Manage 三种视图
- **FullPageWorkspaceShell**: 全屏工作区外壳组件（由 navigation-architecture spec 提供），仅含浮动返回按钮 + 全视口 children
- **Explore_Mode**: Market 的浏览模式，包含搜索、过滤和卡片网格
- **Manage_Mode**: Market 的管理模式，包含 Installed/Updates/Published 三个子 tab
- **Detail_View**: 单个 listing 的详情视图，替换卡片网格（非 overlay），左右两栏布局
- **Market_Filter_Bar**: 顶部过滤栏组件，包含搜索框、Kind 下拉、Sort 下拉、模式切换和 Publish 按钮
- **Market_Card_Grid**: CSS Grid 全屏卡片网格组件，使用 auto-fill minmax(280px, 1fr)
- **Market_Listing_Card**: 单张 listing 卡片组件，固定高度 220px，带稀有度配色
- **ListingSummary**: 列表项数据结构，包含 listing_id、title、summary、kind、creator、rating、install_count
- **ListingDetail**: 详情数据结构，扩展 ListingSummary，增加 permissions、tags、latest_version
- **AssetKind**: 市场资产类型枚举：employee、skill、sop、component 等
- **MarketSortOption**: 排序选项类型：relevance、newest、rating、installs
- **Rarity_Color**: 基于 AssetKind 的稀有度配色方案，包含 border、glow、badge 三组颜色
- **Market_Session_State**: Market 页面的会话状态，包含 mode、selectedListingId、search、sort、kind、manageTab
- **Infinite_Scroll**: 滚动到底部自动加载更多结果的交互模式

## 需求

### 需求 1：Market 页面入口与模式路由

**用户故事:** 作为 Offisim 用户，我希望 Market 页面提供 Explore 和 Manage 两种模式，以便在浏览商店和管理已安装包之间自由切换。

#### 验收标准

1. THE Market_Page SHALL 删除现有 `workspace/` 子目录下所有组件文件（MarketWorkspacePage、MarketWorkspaceExplore、MarketWorkspaceDetail、MarketWorkspaceManage、MarketWorkspaceSidebar、MarketWorkspaceContextPane），使用全新组件从零实现
2. THE Market_Page SHALL 删除不再需要的旧组件：MarketplacePanel.tsx、MarketplaceDetailOverlay.tsx、InstalledList.tsx、ListingCard.tsx
3. THE Market_Page SHALL 根据 Market_Session_State 的 mode 字段路由到 Explore_Mode 或 Manage_Mode 视图
4. WHEN Market_Session_State 的 selectedListingId 不为 null 且 mode 为 'explore', THE Market_Page SHALL 渲染 Detail_View 替代卡片网格
5. WHEN 用户从 Explore_Mode 切换到 Manage_Mode, THE Market_Page SHALL 清除 selectedListingId 为 null

### 需求 2：Explore 模式 — 搜索与过滤

**用户故事:** 作为 Offisim 用户，我希望在 Explore 模式下通过搜索、Kind 过滤和排序快速找到需要的包。

#### 验收标准

1. THE Market_Filter_Bar SHALL 包含搜索输入框（flex-1）、Kind 下拉选择器、Sort 下拉选择器、Explore/Manage 模式切换按钮和 Publish 按钮，固定高度 64px（h-16）
2. WHEN 用户在搜索框中输入文本, THE Market_Page SHALL 调用 setQuery(search) 更新搜索查询
3. WHEN 用户选择 AssetKind 过滤器, THE Market_Page SHALL 调用 setKind(kind) 按资产类型过滤列表
4. WHEN 用户选择排序方式, THE Market_Page SHALL 调用 setSort(sort) 按 MarketSortOption 排序结果
5. WHEN 用户点击 "Reset filters" 操作, THE Market_Page SHALL 将 search 重置为空字符串、sort 重置为 'relevance'、kind 重置为 'all'
6. WHEN 用户点击 "Publish" 按钮, THE Market_Page SHALL 打开 PublishDialog 对话框

### 需求 3：Explore 模式 — 卡片网格与无限滚动

**用户故事:** 作为 Offisim 用户，我希望以全屏卡片网格浏览 Market 中的包，卡片按资产类型有不同的视觉风格，滚动到底部自动加载更多。

#### 验收标准

1. THE Market_Card_Grid SHALL 使用 CSS Grid 布局 `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`，gap 为 20px（gap-5），填满视口宽度
2. THE Market_Listing_Card SHALL 固定高度 220px，显示 AssetKind badge、标题、摘要（2 行截断）、评分（星级）、安装数和 creator handle
3. THE Market_Listing_Card SHALL 根据 AssetKind 使用对应的 Rarity_Color 方案：employee 使用 blue-500、skill 使用 purple-500、sop 使用 amber-500、component 使用 emerald-500
4. WHEN 用户将 Market_Card_Grid 滚动到底部且 hasMore 为 true, THE Market_Page SHALL 调用 loadMore() 加载更多结果
5. WHEN 用户点击一张 Market_Listing_Card, THE Market_Page SHALL 更新 Market_Session_State 的 selectedListingId 为该 listing 的 listing_id
6. WHILE 数据正在加载（isLoading 为 true）, THE Market_Card_Grid SHALL 显示加载骨架屏
7. WHEN 搜索和过滤结果为空, THE Market_Page SHALL 显示空状态界面，包含 "No packages found" 文案和 "Reset filters" 按钮

### 需求 4：Detail 视图 — 全屏两栏详情

**用户故事:** 作为 Offisim 用户，我希望点击卡片后看到包的完整详情，以便了解权限、版本和描述后决定是否安装。

#### 验收标准

1. THE Detail_View SHALL 替换卡片网格渲染（非 overlay），使用左右两栏布局：左侧 60% 为 Hero 区域，右侧 40% 为元数据区域
2. THE Detail_View 左侧 SHALL 显示 AssetKind badge、标题、摘要、标签列表和完整 markdown 描述
3. THE Detail_View 右侧 SHALL 显示版本号（latest_version）、creator handle、评分、安装数、Install 按钮、权限列表（PermissionsBlock）和兼容性信息
4. THE Detail_View 的 Install 按钮 SHALL 使用该 listing 的 AssetKind 对应的 Rarity_Color 作为 accent 色
5. WHEN 用户点击 Install 按钮, THE Market_Page SHALL 调用 onStartInstall(listingId, latest_version) 触发安装流程
6. WHEN 用户点击 Detail_View 顶部的 "← Back to listings" 按钮, THE Market_Page SHALL 将 selectedListingId 重置为 null，返回卡片网格
7. WHILE Detail_View 正在加载详情数据（loading 为 true）, THE Detail_View SHALL 显示加载骨架屏
8. IF Detail_View 加载的 listing 不可用（unavailable 为 true）, THEN THE Detail_View SHALL 显示 "Listing unavailable" 提示并提供返回按钮

### 需求 5：Manage 模式 — 已安装包管理

**用户故事:** 作为 Offisim 用户，我希望在 Manage 模式下查看和管理已安装的包、可用更新和已发布的包。

#### 验收标准

1. THE Market_Manage_View SHALL 提供三个子 tab：Installed、Updates、Published，使用全宽行列表（非卡片网格）
2. THE Market_Manage_View 的每一行 SHALL 显示 AssetKind 图标、包名称、版本号、creator handle、安装日期和操作按钮
3. WHEN 用户切换 Manage 子 tab, THE Market_Page SHALL 更新 Market_Session_State 的 manageTab 字段
4. WHEN Manage 模式下没有已安装的包, THE Market_Page SHALL 显示空状态界面，包含 "No packages installed" 文案和 "Browse the store" 按钮（点击切换到 Explore_Mode）

### 需求 6：错误状态与空状态

**用户故事:** 作为 Offisim 用户，我希望在网络错误或无数据时看到清晰的游戏风格提示，以便了解状态并采取行动。

#### 验收标准

1. IF Market_Page 加载数据时发生网络错误, THEN THE Market_Page SHALL 显示游戏风格的 "Connection Lost" 全屏错误界面，包含错误图标、错误描述和 Retry 按钮
2. WHEN 用户点击 Retry 按钮, THE Market_Page SHALL 重新触发数据加载
3. THE Market_Empty_State SHALL 根据上下文显示不同文案：Explore 无结果时显示 "No packages found" + Reset filters 按钮，Manage 无数据时显示 "No packages installed" + Browse the store 按钮

### 需求 7：稀有度配色映射

**用户故事:** 作为 Offisim 开发者，我希望 AssetKind 到稀有度配色的映射是一个可测试的纯数据模块，确保每种资产类型都有完整的配色方案。

#### 验收标准

1. THE market-rarity 模块 SHALL 导出 RARITY_COLORS 常量，为每个 AssetKind 值映射包含 border、glow 和 badge 三个 Tailwind CSS 类名字符串的配色方案
2. FOR ALL AssetKind 值，RARITY_COLORS 映射 SHALL 包含该 kind 的条目，且 border、glow、badge 字段均为非空字符串
3. THE market-rarity 模块 SHALL 导出 getRarityColor(kind: AssetKind) 辅助函数，返回对应的配色方案，对未知 kind 返回默认灰色方案

### 需求 8：安装数格式化

**用户故事:** 作为 Offisim 开发者，我希望安装数格式化函数正确处理各种数值范围，确保显示的数字简洁易读。

#### 验收标准

1. THE formatInstallCount 函数 SHALL 将 1000 以下的数值原样返回为字符串
2. THE formatInstallCount 函数 SHALL 将 1000 至 9999 的数值格式化为带一位小数的 "k" 后缀（如 1234 → "1.2k"）
3. THE formatInstallCount 函数 SHALL 将 10000 及以上的数值格式化为不带小数的 "k" 后缀（如 12345 → "12k"）
4. FOR ALL 非负整数 n，formatInstallCount(n) SHALL 返回非空字符串

### 需求 9：全屏布局与视觉设计约束

**用户故事:** 作为 Offisim 用户，我希望 Market 页面充分利用全屏空间，呈现游戏商店的沉浸式视觉体验。

#### 验收标准

1. THE Market_Page SHALL 针对 1440px 及以上宽屏优化布局，卡片网格填满视口空间，不使用 max-width 限制或居中窄内容
2. THE Market_Page SHALL 使用深色主题，卡片和 UI 元素使用半透明背景 + backdrop-blur 效果
3. THE Market_Listing_Card SHALL 在 hover 时增强 Rarity_Color 边框发光效果
4. THE Market_Page SHALL 保留现有的 marketplace-meta.tsx（KIND_ICON、KIND_FILTERS、SORT_OPTIONS）、PermissionsBlock.tsx 和 PublishDialog.tsx 组件
