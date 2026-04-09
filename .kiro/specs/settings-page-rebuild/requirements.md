# 需求文档：Settings 页面重建 (Settings Page Rebuild)

## 简介

Offisim 的 Settings（设置）页面需要从零重建为全屏游戏设置菜单风格界面（参考 Cyberpunk 2077 / Fortnite 设置）。Settings 作为独立全屏页面渲染在 FullPageWorkspaceShell 内（由 navigation-architecture spec 提供精简后的浮动 "← Office" 返回按钮 + 全视口 children）。本次重建仅删除 `SettingsPage.tsx`，从零创建新的全屏入口组件及其子组件，保留 `SettingsWorkspaceSurface.tsx`（共享 Surface，同时服务 SettingsDialog 和 SettingsPage）和所有 tab 内容组件。

本 spec 仅覆盖 Settings 页面全屏入口的重建，不涉及导航架构变更（由 navigation-architecture spec 处理），不涉及 SettingsDialog 修改。

## 术语表

- **Settings_Page**: Settings 全屏页面入口组件，编排左侧 tab 导航 + 右侧内容区 + 底部 Save 按钮
- **FullPageWorkspaceShell**: 全屏工作区外壳组件（由 navigation-architecture spec 提供），仅含浮动返回按钮 + 全视口 children
- **Settings_Tab_Nav**: 左侧垂直 tab 导航组件，宽度 w-56（224px），深色背景，选中 tab 有 4px accent 左边条
- **Settings_Content_Area**: 右侧内容区容器组件，flex-1，overflow-y-auto，p-8 内边距，底部 sticky Save 按钮
- **Settings_Group_Section**: 设置分组组件，包含标题分隔线和该组内的设置项列表
- **Settings_Row**: 单行设置项组件，标签左对齐 + 控件右对齐，48px 行高
- **Settings_Surface**: SettingsWorkspaceSurface 组件，共享的设置内容渲染面，同时被 SettingsDialog 和 Settings_Page 使用
- **Settings_Controller**: useSettingsWorkspaceController hook 返回的控制器对象，管理所有设置状态
- **Settings_Tab**: 设置页面的 tab 类型：'provider' | 'runtime' | 'mcp' | 'openclaw'
- **Settings_Session_State**: Settings 页面的会话状态，包含 activeTab 字段
- **Provider_Config**: Provider 配置对象，包含 provider、apiKey、model、baseURL、runtimePolicy 等字段
- **PROVIDER_PRESETS**: Provider 预设常量映射，自动填充 baseURL/model/headers
- **hasUnsavedChanges**: 通过 snapshot 比较检测的未保存变更标志

## 需求

### 需求 1：Settings 页面入口与全屏布局

**用户故事:** 作为 Offisim 用户，我希望 Settings 页面以游戏设置菜单风格展示，左侧有垂直 tab 导航，右侧内容区填满剩余空间，整体充分利用全屏空间。

#### 验收标准

1. THE Settings_Page SHALL 删除现有 `SettingsPage.tsx` 文件，使用全新组件从零实现全屏入口
2. THE Settings_Page SHALL 保留现有的 SettingsWorkspaceSurface.tsx（含 useSettingsWorkspaceController hook）、SettingsProviderTab.tsx、SettingsRuntimeTab.tsx、McpConfigPanel.tsx、provider-presets.ts、settings-primitives.tsx 和 SettingsDialog.tsx
3. THE Settings_Page SHALL 编排左右两栏布局：Settings_Tab_Nav（固定宽度 w-56 = 224px）+ Settings_Content_Area（flex-1）
4. THE Settings_Page SHALL 针对 1440px 及以上宽屏优化布局，内容填满视口空间，不使用 max-width 限制或居中窄内容
5. THE Settings_Page SHALL 使用 useSettingsWorkspaceController hook 管理所有设置状态，与 SettingsDialog 共享同一控制器逻辑

### 需求 2：Settings Tab Nav — 左侧垂直 tab 导航

**用户故事:** 作为 Offisim 用户，我希望左侧有清晰的垂直 tab 导航，包含 Provider、Runtime、MCP、Gateway 四个 tab，选中 tab 有醒目的视觉指示。

#### 验收标准

1. THE Settings_Tab_Nav SHALL 固定宽度 224px（w-56），深色背景，与右侧内容区有 1px 分隔线（border-r border-white/10）
2. THE Settings_Tab_Nav SHALL 包含 Provider、Runtime、MCP、Gateway 四个 tab 按钮，垂直排列
3. WHEN 用户点击某个 tab, THE Settings_Tab_Nav SHALL 通过回调更新 Settings_Session_State 的 activeTab 字段
4. THE Settings_Tab_Nav SHALL 为选中的 tab 显示 4px accent 色左边条 + 背景高亮效果
5. FOR ALL Settings_Tab 值（provider、runtime、mcp、openclaw），Settings_Tab_Nav SHALL 渲染对应的 tab 按钮

### 需求 3：Tab 内容渲染 — 四个 tab 对应正确内容

**用户故事:** 作为 Offisim 用户，我希望切换 tab 时右侧内容区显示对应的设置内容，Provider 和 Runtime tab 使用现有组件，MCP 和 Gateway tab 渲染独立面板。

#### 验收标准

1. WHEN Settings_Session_State 的 activeTab 为 'provider', THE Settings_Content_Area SHALL 渲染 SettingsProviderTab 组件，传入 Settings_Controller
2. WHEN Settings_Session_State 的 activeTab 为 'runtime', THE Settings_Content_Area SHALL 渲染 SettingsRuntimeTab 组件，传入 Settings_Controller
3. WHEN Settings_Session_State 的 activeTab 为 'mcp', THE Settings_Content_Area SHALL 渲染 McpConfigPanel 组件
4. WHEN Settings_Session_State 的 activeTab 为 'openclaw', THE Settings_Content_Area SHALL 渲染 OpenClawSettings 组件
5. FOR ALL Settings_Tab 值，切换 tab SHALL 渲染对应的内容组件，不渲染其他 tab 的内容

### 需求 4：Settings Content Area — 右侧内容区与 Save 按钮

**用户故事:** 作为 Offisim 用户，我希望右侧内容区可滚动浏览设置项，底部有醒目的 Save 按钮，在有未保存变更时高亮提示。

#### 验收标准

1. THE Settings_Content_Area SHALL 使用 flex-1 占据剩余宽度，overflow-y-auto 支持垂直滚动，p-8 内边距
2. THE Settings_Content_Area SHALL 在底部显示 sticky Save 按钮（sticky bottom-0）
3. WHEN Settings_Controller 的 hasUnsavedChanges 为 false, THE Save 按钮 SHALL 显示为 disabled 状态（opacity-50 cursor-not-allowed）
4. WHEN Settings_Controller 的 hasUnsavedChanges 为 true, THE Save 按钮 SHALL 显示为 accent 色高亮 + 脉冲动画效果
5. WHEN 用户点击 Save 按钮, THE Settings_Page SHALL 调用 Settings_Controller 的 handleSave() 方法保存配置

### 需求 5：未保存变更检测

**用户故事:** 作为 Offisim 用户，我希望系统准确检测我是否修改了设置，以便在有未保存变更时提醒我保存。

#### 验收标准

1. THE Settings_Controller SHALL 通过 JSON.stringify snapshot 比较机制追踪 hasUnsavedChanges 状态
2. WHEN 用户修改任何设置项后 snapshot 与加载时的 snapshot 不同, THE Settings_Controller SHALL 将 hasUnsavedChanges 设为 true
3. WHEN 用户保存设置后, THE Settings_Controller SHALL 更新 loadedSnapshot 为当前 snapshot，使 hasUnsavedChanges 恢复为 false
4. WHEN 用户尝试在 hasUnsavedChanges 为 true 时离开 Settings 页面, THE Settings_Controller SHALL 通过 requestDismiss 显示确认对话框

### 需求 6：Settings Group Section 与 Settings Row — 设置项布局

**用户故事:** 作为 Offisim 用户，我希望设置项按功能分组展示，每组有清晰的标题分隔线，每个设置项标签和控件对齐整齐。

#### 验收标准

1. THE Settings_Group_Section SHALL 显示分组标题（半透明分隔线 + 粗体标签），下方渲染该组的设置项列表
2. THE Settings_Row SHALL 固定高度 48px，水平排列：标签左对齐 + 控件右对齐
3. THE Settings_Row SHALL 支持多种控件类型：toggle switch（开关）、dropdown（下拉选择）、text input（文本输入）

### 需求 7：视觉设计约束 — 游戏设置菜单风格

**用户故事:** 作为 Offisim 用户，我希望 Settings 页面呈现游戏设置菜单的沉浸式视觉体验，深色主题、accent 色高亮、紧凑排列。

#### 验收标准

1. THE Settings_Page SHALL 使用深色主题，Settings_Tab_Nav 使用深色背景（如 bg-slate-950/60）
2. THE Settings_Page SHALL 确保 MCP tab 和 Gateway tab 渲染的 McpConfigPanel 和 OpenClawSettings 在全屏宽度下正确填充
3. THE Settings_Page SHALL 确保 Settings_Surface 的修改同时适用于 SettingsDialog 和 Settings_Page 两种入口，保持行为一致
