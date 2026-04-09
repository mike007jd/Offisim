# 任务：Market 页面重建 (Market Page Rebuild)

## 1. 删除现有组件与创建基础模块
- [x] 1.1 删除 `packages/ui-office/src/components/marketplace/workspace/` 目录下所有文件（MarketWorkspacePage.tsx、MarketWorkspaceExplore.tsx、MarketWorkspaceDetail.tsx、MarketWorkspaceManage.tsx、MarketWorkspaceSidebar.tsx、MarketWorkspaceContextPane.tsx）
- [x] 1.2 删除不再需要的旧组件：MarketplacePanel.tsx、MarketplaceDetailOverlay.tsx、InstalledList.tsx、ListingCard.tsx
- [x] 1.3 创建 `market-rarity.ts` 纯数据模块：导出 `RarityColorScheme` 接口（border/glow/badge/accent 四个字符串字段）、`RARITY_COLORS` 常量（为所有 AssetKind 值映射配色方案：employee=blue-500、skill=purple-500、sop=amber-500、component=emerald-500、company_template=cyan-500、office_layout=rose-500、prefab=orange-500、bundle=indigo-500）、`DEFAULT_RARITY`（slate-500）和 `getRarityColor(kind)` 辅助函数

## 2. 稀有度配色与格式化函数属性测试
- [x] 2.1 <PBT> Property 1: 稀有度配色映射完整性 — 使用 fast-check 从 AssetKind 联合类型中随机选取 kind，验证 getRarityColor(kind) 返回的 RarityColorScheme 的 border、glow、badge、accent 四个字段均为非空字符串。Tag: `Feature: market-page-rebuild, Property 1: Rarity color mapping completeness`
- [x] 2.2 <PBT> Property 2: 安装数格式化不变量 — 使用 fast-check 生成随机非负整数 n，验证 formatInstallCount(n) 返回非空字符串，且 n<1000 时返回 String(n)，n>=1000 时返回以 "k" 结尾的字符串。Tag: `Feature: market-page-rebuild, Property 2: Install count formatting invariant`
- [x] 2.3 <PBT> Property 3: 模式切换清除选中状态 — 使用 fast-check 生成随机 MarketSessionState（mode='explore', selectedListingId 为随机非空字符串），模拟 explore→manage 切换逻辑，验证结果状态的 selectedListingId 为 null。Tag: `Feature: market-page-rebuild, Property 3: Mode switch clears selected listing`

## 3. MarketListingCard 与 MarketCardGrid 组件
- [x] 3.1 创建 `MarketListingCard.tsx`：接受 `ListingSummary` + `onClick` 回调，渲染 220px 高卡片，包含 Kind badge（使用 KIND_ICON + RARITY_COLORS badge 类）、标题（16px bold）、摘要（2 行截断 line-clamp-2）、评分（Star 图标 + 1 位小数）、安装数（formatInstallCount）、creator handle，卡片使用 RARITY_COLORS 的 border + glow 类，hover 时增强发光效果
- [x] 3.2 创建 `MarketCardGrid.tsx`：接受 results/isLoading/isLoadingMore/hasMore/onSelectListing/onLoadMore，使用 CSS Grid `grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 p-6` 渲染 MarketListingCard 列表，isLoading 时显示 8 个骨架卡片（animate-pulse），使用 IntersectionObserver 监听底部哨兵元素实现无限滚动

## 4. MarketDetailView 组件
- [x] 4.1 创建 `MarketDetailView.tsx`：接受 detail/loading/unavailable/onBack/onInstall，渲染全屏两栏布局（左 w-3/5 + 右 w-2/5 border-l），左侧显示 Kind badge + 标题 + 摘要 + 标签列表 + 完整描述，右侧显示版本 + creator + 评分 + 安装数 + Install 按钮 + PermissionsBlock + 兼容性信息
- [x] 4.2 实现 Install 按钮稀有度配色：使用 `getRarityColor(detail.kind).accent` 作为按钮背景色，全宽按钮样式
- [x] 4.3 实现 Detail 加载/不可用状态：loading 时显示左右两栏骨架屏，unavailable 时显示 "Listing unavailable" 提示 + 返回按钮
- [x] 4.4 实现 "← Back to listings" 返回按钮：点击调用 onBack 回调

## 5. MarketManageView、MarketErrorState、MarketEmptyState 组件
- [x] 5.1 创建 `MarketManageView.tsx`：接受 manageTab/onStartInstall/onGoToExplore，渲染全宽行列表（divide-y divide-white/5），每行显示 Kind 图标(24px) + 名称(flex-1) + 版本 + creator + 安装时间 + 操作按钮，无数据时渲染 MarketEmptyState
- [x] 5.2 创建 `MarketErrorState.tsx`：接受 error/onRetry，渲染游戏风格 "Connection Lost" 全屏居中界面，包含 WifiOff 图标 + 标题 + 错误描述 + Retry 按钮（带脉冲动画）
- [x] 5.3 创建 `MarketEmptyState.tsx`：接受 variant/onAction/actionLabel，根据 variant（no-results/no-installed/no-updates/no-published）显示不同图标、文案和操作按钮

## 6. MarketFilterBar 组件
- [x] 6.1 创建 `MarketFilterBar.tsx`：固定高度 h-16，水平排列 px-6，包含搜索输入框（flex-1, Search 图标, placeholder "Search packages..."）、Kind 下拉（使用 KIND_FILTERS）、Sort 下拉（使用 SORT_OPTIONS）、Explore/Manage 切换按钮组、Publish 按钮
- [x] 6.2 实现 Manage 模式下的过滤栏变体：隐藏 Kind/Sort/Publish，显示 Installed/Updates/Published 子 tab 按钮行

## 7. MarketPage 入口组件与集成
- [x] 7.1 创建 `MarketPage.tsx`：接受 MarketSessionState + onSessionStateChange + onStartInstall，编排垂直布局（MarketFilterBar + 内容区），根据 mode + selectedListingId 路由到 MarketCardGrid / MarketDetailView / MarketManageView / MarketErrorState
- [x] 7.2 集成 useMarketplace hook：通过 useEffect 同步 sessionState 的 search/kind/sort 到 hook 的 setQuery/setKind/setSort
- [x] 7.3 集成 useListingDetail hook：当 mode='explore' 且 selectedListingId 非 null 时加载详情，检测 unavailable 时 Toast 提示
- [x] 7.4 实现模式切换回调：explore→manage 时清除 selectedListingId，manage→explore 时保留过滤器状态
- [x] 7.5 集成 PublishDialog：管理 publishDialogOpen 状态，Publish 按钮点击打开对话框
- [x] 7.6 实现 Reset filters 回调：将 search 重置为 ''、sort 重置为 'relevance'、kind 重置为 'all'

## 8. 清理引用与编译验证
- [x] 8.1 更新 `packages/ui-office/src/components/marketplace/index.ts` 导出：移除已删除组件的导出，新增 MarketPage、MarketSessionState 等导出
- [x] 8.2 更新所有引用已删除组件的文件（如 App.tsx 中的 MarketWorkspacePage 导入），替换为新的 MarketPage 组件
- [x] 8.3 运行 TypeScript 编译检查（`tsc --noEmit`），修复所有因组件删除和替换导致的类型错误
- [x] 8.4 运行 Biome lint 检查，确保所有新文件符合项目规范（2-space indent, single quotes, trailing commas）
