## Context

Project 在 Offisim 的现状是"会议日程式 dropdown filter"——`projects` 表持有 name / description / status / 一个绑定的 `thread_id`，`ProjectSelector` 顶栏 chip 切换后只把 chat session 切到对应 thread。`createProject` 入口是下拉菜单里 inline name input（一行），没有 description、没有 folder 选择器，空态文案就是 "No projects yet"。这次改的核心是：让 Project 承载 IDE workspace 的根概念——绑定本地工作目录、暴露 chat 上下文、为 G2 文件树面板留出接口。

仓库里相关实情：
- `packages/db-local/src/schema.ts:265` 的 `projects` 表有 `thread_id` 但**无 `workspace_root` 列**；最新 migration 是 `025_skills_table.sql`，desktop 嵌入式迁移到 v33（`packages/db-local/src/migrations/`）。
- `packages/shared-types/src/project.ts` 的 `ProjectRow` 同样没有 `workspace_root`。
- `packages/core/src/runtime/repos/projects/{drizzle,memory}.ts` + `apps/web/src/lib/tauri-repos/projects.ts`（三副本）都按现 schema 实现。`update(id, patch)` 已是 generic patch 通道。
- `packages/core/src/services/project-service.ts` 的 `createProject(name, description?)` 是 positional-arg API，被 `boss-node.ts:327` 与 `useProjects.ts:45` 消费。
- `packages/ui-office/src/components/project/ProjectSelector.tsx` 是 inline-create 下拉，`ChatPanel.tsx:153` 已经从 `activeProject?.thread_id` 推导 `activeThreadId`——chat thread 绑定逻辑**已经存在**，本 change 不动这部分。
- Tauri 侧 `apps/desktop/src-tauri/Cargo.toml` 当前只有 `tauri-plugin-fs / sql / cors-fetch / deep-link / single-instance`，**没有 dialog / opener plugin**。`capabilities/default.json` 同样未授权 `dialog:*` / `opener:*`。
- 浏览器侧 vite 已有 `@tauri-apps/plugin-fs` / `plugin-sql` 的 stub 模式（`apps/web/src/polyfills/tauri-plugin-*.ts`）——新接入的 `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-opener` 必须沿用此 stub 模式，否则 web dev mode 动态 import 会 404。

## Goals / Non-Goals

**Goals:**
- `projects` row 持有 nullable `workspace_root: string`，desktop 通过 Tauri dialog 选择本地目录，web 端字段降级为不可用说明（不接 File System Access API）。
- `ProjectSelector` 的 inline form 升级为 modal `ProjectCreateDialog`，三字段（name / description / workspace folder）；空态文案换成引导态 + 主 CTA。
- `ChatPanel` 顶部加 `ProjectContextStrip`：选中 project 时显示 `Project · {name} · {folder?}` + Open folder 按钮（desktop only）+ Edit 按钮（重开 dialog 改 description / folder）。team chat / direct chat 都展示。
- `ProjectListPanel` row 选中后右侧 summary 暴露已绑 folder（hint 文本）+ tasks count + deliverables count。
- 三 repo backend（drizzle / memory / tauri）严格同步落 `workspace_root`。
- 桌面端 Tauri 注册 `tauri-plugin-dialog` + `tauri-plugin-opener`，`capabilities/default.json` 加对应 permission，npm 端补 `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-opener` 包，vite alias 补 browser stub。

**Non-Goals:**
- 实际的 IDE 文件树面板、文件读写、git 集成——G2 后续 change。
- AI agents 对 workspace_root 的工具访问（list / read / write file）——同上。
- platform 侧 `db-platform` 的 schema 镜像——platform 暂无 project 概念落地，不动。
- 浏览器 File System Access API 集成——跨平台路径表达 / 权限 ttl / 安全模型与 Tauri 不一致，G2 重新统一处理。
- workspace_root 实际存在性 / 可读性校验——只存路径字符串，路径有效性留给 OS 文件管理器自然报错。
- 把 workspace_root 用作 git auto-commit / vault root——vault 仍走 `companies/<companyId>/...` 既有逻辑，两条路不混。
- cross-project deliverable migration / 旧 project 批量补 folder。

## Decisions

### D1. workspace_root 是 projects 表上的列，不另立表

**选择**: 直接给 `projects` 表加 `workspace_root TEXT NULL` 列，shared-types `ProjectRow` 跟随。

**理由**: 1-1 关系（一个 project 至多一个 workspace），跨表关联只增加 join 与一致性成本。`thread_id` 已是同样的"项目级 1-1 资源"模型，新字段沿用同位置最自然。

**对比**: 单独 `project_workspaces(project_id PK, workspace_root)` 表能为未来 multi-root 留口子，但 G1 / G2 都没 multi-root 需求；如果将来真的要，再加表迁移。

### D2. Tauri plugin 选型——dialog + opener

**选择**: 注册 `tauri-plugin-dialog`（folder picker）+ `tauri-plugin-opener`（在 OS 文件管理器中打开路径）。

**理由**:
- `tauri-plugin-dialog` 的 `open({ directory: true })` 是官方 folder picker，跨平台一致返回绝对路径字符串，权限粒度可在 capabilities 控制。
- `tauri-plugin-opener` 提供 `revealItemInDir(path)` / `openPath(path)`，比通过 `Command::new("open")` 自己 spawn shell 命令更稳——后者跨平台分支多（Linux 没统一 file manager 命令）。
- 两个 plugin 都已被 Tauri 2 ecosystem 标准化，兼容已注册的 `tauri-plugin-fs` 等。

**对比**:
- 自己写 Rust command 包 `std::fs::read_dir` + `osascript` / `xdg-open`：跨平台分支多，安全审计面更大；放弃。
- 用 `tauri-plugin-fs::pick_folder`（如果有）：fs plugin 当前没暴露 folder picker，dialog plugin 才是该用的入口。

### D3. Web fallback —— 静默禁用，不接 File System Access API

**选择**: 浏览器模式下 `ProjectCreateDialog` 的 folder 行变成只读 hint："Workspace folder · Available on desktop"；不显示 picker 按钮，不写 workspace_root；ProjectContextStrip 也不显示 folder 段。

**理由**:
- File System Access API（`window.showDirectoryPicker`）拿到的是 `FileSystemDirectoryHandle`，**不是路径字符串**——和 Tauri 路径模型不兼容，强行存的话两端语义分裂。
- handle 的权限 ttl 短（标签页关闭即失效），需要 IndexedDB 持久化 + 重启时重新探测权限——这套在 vault 已经踩过坑（`companies/<id>/skills/...` vault directory handle 持久化），增加一份 G1 暂不消化。
- 目标用户（PM / 产品 / 实际开发）会在 desktop 用，web 是 "live AI 验证 + demo" 场景（CLAUDE.md 已经定调），folder 不可用不算阻塞。

**对比**:
- 在 web 上接 FSAccess API 并把 handle 索引化存 IndexedDB：实现复杂，G2 文件树面板做时统一来；本 change 不预支。
- web 下让用户手输路径字符串：路径既不能验证又不能用，纯垃圾输入。放弃。

### D4. ProjectCreateDialog 是 modal，复用 `dialog-shell.tsx` SSOT

**选择**: 拆出 `ProjectCreateDialog.tsx`（`packages/ui-office/src/components/project/`），复用 `@offisim/ui-core/dialog-shell.tsx` 的 `DIALOG_SIZING_CLASS` 常量，遵循 `panel-and-dialog-sizing` canonical spec（min/max-h clamp / 内部滚动）。

**理由**: A4 已落 `panel-and-dialog-sizing` SSOT，新 dialog 必须复用而不是再写一份 inline modal。Edit dialog（已绑 project 后改 description / workspace）可同源——`ProjectCreateDialog` 接 `mode: 'create' | 'edit'` + 可选 `initial: ProjectRow`。

**对比**: 在 `ProjectSelector` 下拉里继续 inline form：放不下三字段（name / description / folder picker 行 + button），UX 拥挤；放弃。

### D5. ProjectContextStrip 是 ChatPanel 内 child，不是 AppLayout 全局 chrome

**选择**: 在 `ChatPanel.tsx` 顶部、existing tab strip 上方塞 `ProjectContextStrip`，仅当 `activeProject != null` 时渲染；`activeProject == null` 时 strip 完全消失（不留空 row）。

**理由**:
- Project 概念的影响范围是 chat thread + folder + tasks，不是全 workspace；放在 AppLayout header 会和 OfficeToolBar / WorkspaceTabs 抢视觉权重。
- ChatPanel 已经在消费 `activeProject` prop，binding 本来就在这一层。

**对比**: 放在 OfficeWorkspace header bar：office 不是唯一带 chat 的表面（Personnel direct chat 也用 ChatPanel），放在 ChatPanel 内更聚焦。

### D6. createProject API 改成对象参数

**选择**: `ProjectService.createProject(input: { name: string; description?: string; workspaceRoot?: string | null })` —— positional 升级到 named。

**理由**: 三个可选字段位置耦合（current `(name, description?)` 已经差点该叫 named param），新加 workspaceRoot 是明确拐点。`useProjects.ts:45` 的 `createProject` callback 同步改签名。

**调用点**: `boss-node.ts:327` + `ProjectSelector` `onCreateProject` callback chain + `ProjectCreateDialog` submit handler。

### D7. 平台分支用同一 hook，runtime 决策

**选择**: 新建 `packages/ui-office/src/lib/folder-picker.ts`，导出 `pickWorkspaceFolder(): Promise<string | null>` 与 `revealWorkspaceFolder(path: string): Promise<void>`；hook 里用 `isTauri()` 判定，desktop 调 plugin，web 抛 `FolderPickerUnavailableError`（UI 层提前 disabled，不应触达此分支）。

**理由**: tauri vs web 分支不应散在 dialog 组件 / context strip / project list panel 里——单点抽象。`isTauri()` 真相在 `__TAURI_INTERNALS__`（CLAUDE.md gotcha 已警告，不要用 `window.__TAURI__`）。

### D8. 数据迁移——纯增量，无 backfill

**选择**: SQL 迁移只 `ALTER TABLE projects ADD COLUMN workspace_root TEXT;`（NULL 默认）。已有 project rows 自然 workspace_root = NULL，UI 表现为"未绑定 folder"，用户可在 ProjectContextStrip Edit 行为里补绑。

**理由**: 没有 backfill 候选（没人知道用户的本地路径），也没有降级阻塞（NULL 是合法的 workspace_root 状态——chat thread 仍然工作）。

## Risks / Trade-offs

- **Tauri capabilities 漏配权限 → folder picker 静默 no-op**: `default.json` 必须同时加 `dialog:default` / `dialog:allow-open` 与 `opener:default` / `opener:allow-reveal-item-in-dir` / `opener:allow-open-path`，缺一项前端就拿不到对话框。
  → Mitigation: live verify 第一轮就验 desktop release `.app` 能弹出 folder picker，`offisim-desktop` dev binary 不算最终验收（与 C0 同 caveat）。

- **workspace_root 实际存在性不校验 → 用户后续路径失效**: 用户可能挪了文件夹 / 删了路径，`projects.workspace_root` 静态指向死路径。
  → Mitigation: 不在 G1 校验（增 fs 探测复杂度、跨平台权限差异大）；在 ProjectContextStrip Open folder action 里失败 toast 明确文案 "Folder not found at <path>. Edit project to rebind."，让用户自己重绑。

- **web 用户失望期望落差**: 用户在 web 上点 "New Project"，看到 folder 字段是 disabled hint，可能会困惑。
  → Mitigation: ProjectCreateDialog 在 web 模式 folder 行下方加一行 muted hint："Folder binding is desktop-only — your project will still get a dedicated chat thread."（CLAUDE.md 已定调 web 是 demo / live AI entry，desktop 是正式工作流）。

- **空态引导 CTA 与 office onboarding 撞车**: 新公司 Office 首屏空态 / first-run wizard 已有自己的引导流，新加的 "Create your first project" CTA 不能在 onboarding 进行中再 push 一次。
  → Mitigation: 空态显示在 `ProjectSelector` 下拉打开 + projects.length === 0 时；不强行向 Office 主区注入引导卡，避免重复。

- **`ProjectRepository.update(id, patch)` 已存在但 patch 类型可能没含 workspace_root**: 三副本 update 都需要扩 `Partial<Pick<ProjectRow, 'name' | 'description' | 'status' | 'workspace_root'>>`。
  → Mitigation: shared-types 显式声明 `ProjectUpdatePatch` 类型，三副本签名一致。

- **`generateId('proj')` + `projectThreadId` 组合在已有 thread_id 列上 FK 工作**: 加 workspace_root 不影响 thread 创建顺序，但 migration 必须确保 `ALTER TABLE` 不破坏已有索引 `idx_projects_company`。
  → Mitigation: 单纯加列不动索引；live verify 跑一次 `pnpm --filter @offisim/desktop dev` 确认 v34 迁移在已有数据库上不炸。

- **空 description 与 default 置换**: 旧 inline create 永远把 description 设为 NULL；新 dialog 把 textarea trim 完空字符串依然写 NULL（不是 ""）。
  → Mitigation: `ProjectService.createProject` 内显式 `description: input.description?.trim() || null`；workspace_root 同 trim 逻辑。

- **CLAUDE.md / project-list 上 spec 文档过时**: G1 之前 CLAUDE.md "Project IDE deferred" 文案要换。
  → Mitigation: archive gate 三查时对齐根 CLAUDE.md + `packages/ui-office/CLAUDE.md`。

## Migration Plan

1. shared-types 加 `workspace_root` + `ProjectUpdatePatch` → build。
2. db-local schema 改列 + 新 migration 026 + desktop `lib.rs::migrations()` 加 v34 → build → 跑一次 desktop dev 确认迁移不炸。
3. 三 repo backend 同步落 → build core → tauri-repos build。
4. ProjectService API 改名 → boss-node + useProjects 调用点跟改 → core build → ui-office build。
5. Tauri plugin 注册 + capabilities + npm dep + vite stub → desktop build / web dev 双跑 smoke。
6. UI 拆分：ProjectCreateDialog / ProjectContextStrip / 升级 ProjectSelector / 升级 ProjectListPanel right summary → ui-office build → web build。
7. live verify：web @5176 + desktop release `.app` 双线，覆盖 create / pick folder / open folder / edit / unbind 五条路径。

**Rollback**: workspace_root 列保留（数据无害）；UI 层回滚到旧 ProjectSelector inline form 的话，新字段被忽略（NULL 行为兼容）。Tauri plugin 注册移除即可。无 destructive 步骤。

## Open Questions

- **Q1**: ProjectContextStrip 的 Edit action 是直接打开 ProjectCreateDialog 的 edit mode，还是跳转 Personnel 那种 dedicated workspace？G1 默认前者（modal edit），后续 G2 IDE 概念里 Project 自己有 workspace 时再升级。
- **Q2**: 是否需要在 ProjectSelector trigger chip 上直接显示 folder hint（`Project · ~/foo`）？默认 **不显示**——chip 已经够窄，folder 留给 ContextStrip。
- **Q3**: Tasks count / Deliverables count 在 ProjectListPanel 的来源——`useProjectAssignments` 已订阅 employee 关联，tasks / deliverables 是否要新建轻量 hook？默认沿用 ProjectListPanel 内现有的 thread-scoped 任务/产物订阅（如已有），否则用最简 count query 不订阅事件流。
