# 任务：Settings 页面重建 (Settings Page Rebuild)

## 1. 删除现有组件与创建布局原子组件
- [x] 1.1 删除 `packages/ui-office/src/components/settings/SettingsPage.tsx`（保留 SettingsWorkspaceSurface.tsx、SettingsProviderTab.tsx、SettingsRuntimeTab.tsx、McpConfigPanel.tsx、SettingsDialog.tsx、provider-presets.ts、settings-primitives.tsx）
- [x] 1.2 创建 `SettingsGroupSection.tsx`：接受 title + children，渲染分组标题行（text-xs font-semibold uppercase tracking-wider text-slate-500 + flex-1 h-px bg-white/10 分隔线）+ children 容器（space-y-1），外层 mb-6
- [x] 1.3 创建 `SettingsRow.tsx`：接受 label + description(可选) + children，渲染 48px 高行（h-12 flex items-center px-2 rounded-lg hover:bg-white/[0.02]），左侧标签区（flex-1 min-w-0，标签 text-sm text-slate-200，描述 text-xs text-slate-500）+ 右侧控件区（flex-shrink-0 ml-4 渲染 children）

## 2. SettingsTabNav 组件
- [x] 2.1 创建 `SettingsTabNav.tsx`：接受 activeTab + onTabChange，定义 SETTINGS_TABS 常量数组（provider/Bot、runtime/Cpu、mcp/Plug、openclaw/Workflow），渲染 w-56 flex-shrink-0 border-r border-white/10 bg-slate-950/60 py-6 容器，内部垂直排列 tab 按钮
- [x] 2.2 实现 tab 按钮样式：每个按钮 w-full h-12 flex items-center gap-3 px-5 text-sm transition-colors，选中状态 border-l-[4px] border-cyan-400 bg-white/[0.06] text-white，未选中状态 border-l-[4px] border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]，图标 h-4 w-4

## 3. SettingsContentArea 组件
- [x] 3.1 创建 `SettingsContentArea.tsx`：接受 activeTab + controller（ReturnType<typeof useSettingsWorkspaceController>），渲染 flex flex-1 flex-col min-h-0 容器，内部分为滚动内容区（flex-1 overflow-y-auto p-8）和底部 sticky Save 栏
- [x] 3.2 实现 tab 内容路由：activeTab='provider' 渲染 SettingsProviderTab(controller)，'runtime' 渲染 SettingsRuntimeTab(controller)，'mcp' 渲染 McpConfigPanel，'openclaw' 渲染 OpenClawSettings
- [x] 3.3 实现 sticky Save 按钮栏：sticky bottom-0 border-t border-white/10 bg-slate-950/80 backdrop-blur-sm px-8 py-4，Save 按钮全宽，hasUnsavedChanges=false 时 opacity-50 cursor-not-allowed bg-white/10 text-slate-500，=true 时 bg-cyan-500 hover:bg-cyan-400 text-white，isSaving 时显示 "Saving…"，saveError 时显示红色错误文本

## 4. SettingsPage 入口组件
- [x] 4.1 创建新的 `SettingsPage.tsx`：接受 SettingsPageProps（sessionState/onSessionStateChange/onBack/onSave/onSaveSuccess），调用 useSettingsWorkspaceController({ isActive: true, onDismiss: onBack, onSave, onSaveSuccess }) 获取 controller，渲染 flex h-full 容器包含 SettingsTabNav + SettingsContentArea
- [x] 4.2 实现 tab 切换回调：SettingsTabNav 的 onTabChange 通过 onSessionStateChange 更新 sessionState.activeTab

## 5. 属性测试
- [x] 5.1 <PBT> Property 1: Tab 导航完整性 — 使用 fast-check 从 ['provider', 'runtime', 'mcp', 'openclaw'] 中随机选取 tab 值，验证 SettingsContentArea 根据 activeTab 渲染对应的内容组件（provider→SettingsProviderTab 存在、runtime→SettingsRuntimeTab 存在、mcp→McpConfigPanel 存在、openclaw→OpenClawSettings 存在）。Tag: `Feature: settings-page-rebuild, Property 1: Tab navigation renders correct content`
- [x] 5.2 <PBT> Property 2: 未保存变更检测不变量 — 使用 fast-check 生成随机设置值对象对（两个包含 preset/apiKey/model/baseURL 等字段的对象），模拟 snapshot 比较逻辑（JSON.stringify），验证：当两个对象 JSON.stringify 结果相同时 hasUnsavedChanges 为 false，不同时为 true。Tag: `Feature: settings-page-rebuild, Property 2: Unsaved changes detection invariant`

## 6. 清理引用与编译验证
- [x] 6.1 确认 `packages/ui-office/src/components/settings/` 目录的导出：新 SettingsPage 导出与旧接口兼容（SettingsPageProps 保持 sessionState/onSessionStateChange/onBack/onSave/onSaveSuccess 签名）
- [x] 6.2 确认所有引用 SettingsPage 的文件（如 App.tsx）无需修改导入路径（文件名不变，仅内容重建）
- [x] 6.3 运行 TypeScript 编译检查（`tsc --noEmit`），修复所有因组件重建导致的类型错误
- [x] 6.4 运行 Biome lint 检查，确保所有新文件符合项目规范（2-space indent, single quotes, trailing commas）
