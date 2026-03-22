# Offisim Studio 3D Editor + Multi-Company System

## Session Handoff — 2026-03-22

### What was completed this session

**Prefab System Pipeline (fully wired):**
- `PrefabInstanceRepository` added to `RuntimeRepositories` interface
- Memory + Drizzle + Tauri SQLite implementations complete
- `usePrefabInstances` hook loads from DB (not hardcoded anymore)
- `EditorProvider` saves to DB via `saveToRepo` callback
- Company templates auto-generate prefab instances on creation
- `@agentclientprotocol/sdk` added, subscription adapter written

**Subscription Provider (订阅制):**
- `LlmProvider` type adds `'subscription'`
- `SubscriptionAdapter` implements `LlmGateway` via ACP protocol (JSON-RPC over stdio)
- Settings UI has "订阅制 (Subscription)" option — no API key needed
- Dynamic `require()` keeps `node:child_process` out of browser bundles

**Scene + UI Fixes:**
- ChatDrawer auto-expand on employee chat click
- Scene ↔ App selectedEmployeeId bidirectional sync
- WorkstationMesh3D laptop orientations fixed (screens face employees)
- 2D employee overlap root cause found: CSS `transform` animation overriding SVG attribute `transform` (fixed by Codex — two-layer `<g>` structure)
- Optional callback safety (AgentPanel, RightSidebar, AgentCard)
- EditorToolbar Save → localStorage persistence

**First-pass Offisim Studio (OfficeEditorOverlay):**
- 2D SVG editor with PrefabPalette sidebar + properties panel + placement
- Works but user rejected it — wants 3D editor like game engines

### Current repo health

- Core: 472 tests passing
- Renderer: 145 tests passing
- TypeCheck: all packages clean
- Known issue: Tauri first-launch "Initializing..." button (Codex fix pending verification)
- Known issue: `theme-provider.test.tsx` existing failure (unrelated)

---

## Next Phase: Offisim Studio 3D Editor + Multi-Company

### 用户愿景

> "就像很多游戏引擎或者工坊一样，可以拖拽元素到地块上，选择公司地块规格，或者让用户自由拼接。系统里缺了多公司的概念。"

对标产品：Roblox Studio、Unity Scene Editor、Cities Skylines Workshop、Satisfactory

### 核心概念：Offisim = Runtime + Studio

```
┌─────────────────────────────────────────────────────┐
│  Offisim Runtime (当前的 3D/2D 视图)                  │
│  - 看公司运行状态                                     │
│  - 员工在工作、开会、聊天                              │
│  - 实时 KPI、事件流                                   │
│  - 不能编辑布局                                       │
└─────────────────────────────────────────────────────┘
                        ↕ 切换
┌─────────────────────────────────────────────────────┐
│  Offisim Studio (新的 3D 编辑器)                      │
│  - Three.js 3D 视图 + OrbitControls                  │
│  - 左侧: Prefab Palette (拖拽)                       │
│  - 右侧: Properties Panel (选中物件属性)              │
│  - 底部: 地块规格选择 / 自由拼接                      │
│  - 顶部: 工具栏 (移动/旋转/删除/吸附网格)            │
│  - 可以编辑布局、保存、切回 Runtime 看效果             │
└─────────────────────────────────────────────────────┘
```

### 新概念：多公司 (Multi-Company)

当前系统硬编码 `COMPANY_ID = 'company-001'`。需要引入：

```
用户 (User)
 └── 拥有多个公司 (Companies)
      ├── Company A: "AI Agency" (Agency Lite 模板)
      │   └── Office A: 3x3 地块, 5 employees, 自定义布局
      ├── Company B: "Content Studio" (Content Studio 模板)
      │   └── Office B: 2x2 地块, 3 employees
      └── Company C: "R&D Lab" (从零开始)
           └── Office C: 自由拼接, 8 employees
```

**数据模型变更：**
- 新增 `users` 表（或直接用 localStorage user profile）
- `companies` 表已有 `company_id`，只需去掉硬编码
- 新增"公司切换器" UI（像 Slack workspace switcher）
- 每个公司有独立的 employees、prefab instances、office layout

### 地块系统 (Plot System)

**预设地块规格：**
| 规格 | 尺寸 (3D units) | 适合 | 描述 |
|------|-----------------|------|------|
| 小型工作室 | 20×15 | 1-4人 | 创业车库 |
| 标准办公室 | 40×30 | 5-15人 | 当前默认 |
| 大型办公楼 | 60×45 | 16-40人 | 多部门 |
| 园区 | 80×60 | 40-100人 | 企业总部 |
| 自由模式 | 用户定义 | 任意 | 拖拽地块拼接 |

**自由拼接模式：**
- 用户从地块库中拖出 "地块方块" (plot tiles)
- 每个 tile 是一个 zone (如 10×10 的空间)
- tiles 可以拼接成任意形状的办公空间
- 类似 Minecraft 的区块概念

### 3D Studio 编辑器技术方案

**复用现有基础：**
- Three.js + @react-three/fiber（已有）
- OrbitControls（已有）
- Prefab 3D Mesh 组件（WorkstationMesh3D, BookshelfMesh3D 等，已有 7 种）
- Prefab Catalog（28 个定义，已有）
- PrefabInstanceRepository（刚接通）

**需要新建：**
1. **StudioCanvas.tsx** — 独立的 Three.js 场景（不是 Office3DView 的 edit mode）
   - 网格地面 (infinite grid helper)
   - 天空盒/环境光（编辑模式下的中性光照）
   - Gizmo 控件（移动/旋转/缩放，用 @react-three/drei 的 TransformControls）
   - 吸附网格 (snap to grid)

2. **PrefabDragDrop** — 从 palette 拖到 3D 场景
   - Palette 里的 prefab 条目支持 HTML drag
   - 拖到 3D canvas 时转换为 3D 坐标
   - Ghost preview（半透明预览物件跟随鼠标）
   - 落地时创建 PrefabInstance

3. **SelectionSystem** — 3D 物件选择
   - Raycaster 点击选择
   - TransformControls 附着到选中物件
   - 多选 (Shift+Click)
   - 框选 (Box Select)

4. **PlotEditor** — 地块编辑
   - 地块边界可视化（发光边框）
   - 地块大小调整 handle
   - Zone 标签和颜色

5. **StudioToolbar** — 顶部工具栏
   - 工具切换: Select / Move / Rotate / Place
   - Grid Snap 开关
   - Undo/Redo (Command pattern)
   - Camera views (Top / Front / Perspective)

6. **CompanySwitcher** — 公司切换器
   - 侧边栏或 header 下拉
   - 显示所有公司列表 + 创建新公司
   - 切换时加载对应公司的 Runtime

### 实施优先级

**Phase 1: 3D Studio 基础 (最高优先)**
- StudioCanvas with grid + TransformControls
- Prefab 3D 放置 + 选择 + 移动/旋转
- 保存到 PrefabInstanceRepository
- 替换当前的 2D OfficeEditorOverlay

**Phase 2: 地块系统**
- 预设地块规格选择
- 地块边界和 zone 可视化
- 地块大小动态调整

**Phase 3: 多公司**
- 去掉 COMPANY_ID 硬编码
- Company 列表 + 切换器 UI
- 每公司独立数据隔离
- 公司创建 wizard 集成地块选择

**Phase 4: 高级编辑器功能**
- Undo/Redo
- 多选 + 批量操作
- 自由地块拼接
- 编辑器内员工放置（分配到工位）

---

## Starter Prompt for Next Session

```
我要开始做 Offisim Studio 3D 编辑器。

背景：
- 项目是 Offisim（AI 公司运行时 + 办公室模拟器）
- 当前有一个 2D SVG 编辑器（OfficeEditorOverlay），用户体验很差，要替换成 3D 编辑器
- Prefab 系统已经完成：28 个 prefab 定义、7 种 3D Mesh 组件、PrefabInstanceRepository 已接入 RuntimeRepositories
- Three.js + @react-three/fiber 已在项目中使用（Office3DView.tsx）
- @react-three/drei 已安装（TransformControls、OrbitControls 可用）

设计文档：`docs/superpowers/plans/2026-03-22-offisim-studio-3d-editor.md`

Phase 1 目标：
1. 新建 StudioCanvas.tsx — 独立 Three.js 3D 编辑场景（grid + 环境光 + OrbitControls）
2. 左侧 PrefabPalette — 从 palette 选中 prefab 后点击 3D 地面放置
3. 3D 物件选择 — Raycaster 点击选中，TransformControls 移动/旋转
4. 右侧 PropertiesPanel — 选中物件的属性编辑（位置/旋转/删除）
5. 保存到 DB — 通过 PrefabInstanceRepository
6. 替换 OfficeEditorOverlay 里的内容为 StudioCanvas

同时引入多公司概念：
- 去掉 COMPANY_ID 硬编码
- 公司列表 + 切换器
- 每公司独立 prefab instances / employees / layout

先读 spec，再写 implementation plan，然后执行。
关键文件：
- 现有 3D 视图: packages/ui-office/src/components/scene/Office3DView.tsx
- Prefab Meshes: packages/ui-office/src/components/scene/prefabs/
- Editor 状态管理: packages/ui-office/src/components/scene/editor/EditorMode.tsx
- Prefab Catalog: packages/renderer/src/prefab/builtin-catalog.ts
- DB Repo: packages/core/src/repos/prefab-instance-repository.ts
```
