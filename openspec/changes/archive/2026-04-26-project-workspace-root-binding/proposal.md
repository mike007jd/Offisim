## Why

Project 当前是没有真实承载的 dropdown filter——选中后唯一行为是把 chat 切到 `project.thread_id`，UI 上既没有文件夹绑定，也没有从 Project 视角看任务/产物的入口。`ProjectSelector` 的 inline create 只接 name，Tauri dialog plugin 也没接入，导致没法绑定本地工作目录。空态文案就是冷冰冰一句 "No projects yet"。这一条 change 把 Project 升级成 G 阶段 IDE 的根概念：**name + description + 本地 workspace 文件夹 + 专属 thread + Project 视角的 chat header**——为后续 IDE 文件树面板（G2）让出位。

## What Changes

- **schema**: `projects` 表新增 `workspace_root TEXT` 列（nullable）。`shared-types/ProjectRow` 同步加字段；DB-local migration 026（desktop schema v34）+ 三副本 repos（drizzle / memory / tauri）同步。
- **ProjectService.createProject** 签名改成接 `{ name, description?, workspaceRoot? }` 而不是 positional args；rebind / unbind 走现有 `ProjectRepository.update(id, patch)` 的 `{ workspace_root }` 字段，不新增 mutator。
- **Tauri dialog + opener plugin**: `apps/desktop/src-tauri` 注册 `tauri-plugin-dialog` + `tauri-plugin-opener`，并在 `capabilities/default.json` 加 `dialog:allow-open` + `opener:allow-open-path`。前端通过 `@tauri-apps/plugin-dialog` 的 `open({ directory: true })` 拿绝对路径。
- **Web fallback**: 浏览器侧 folder 字段降级为只读说明 + 文本 hint "Available on desktop"。不为 web 接 File System Access API（路径表达跨平台不一致，权限 ttl 短，G2 文件树时再统一处理）。
- **ProjectCreateDialog**: 旧 inline name-only form 升级成 modal dialog——name（必填）/ description（可选 textarea）/ workspace folder（desktop: picker 按钮 + 显示路径 + clear；web: disabled 文本说明）/ Create + Cancel。从 `ProjectSelector` 下拉的 "New Project…" 触发。
- **ProjectSelector 空态**: "No projects yet" 换成引导态——一行说明 + "Create your first project" CTA，CTA 直开新 dialog。状态行还要显示 active project 的 folder hint（`📁 ~/projects/foo`，截断）。
- **Chat header ProjectContextStrip**: ChatPanel 顶部加一行 chip——选中 project 时显示 `Project · {name} · {folder?}` + "Open folder" action（desktop only）+ "Edit" action（重开 dialog 改 description / folder）。未选中 project 时不显示。team chat 与 direct chat 都要展示这一行。
- **Project 视角任务/产物**: `ProjectListPanel` row 选中后右侧除了 thread 概要，还要看到该 project 关联的 tasks count / deliverables count（已有数据，没暴露）。**这一项是轻量信息披露，不新增数据通道。**
- **Open folder action**: desktop 走 Tauri opener `revealItemInDir` / `openPath` 把 workspace_root 用 OS 文件管理器打开；web 不显示该 action。失败明确 toast。
- **不在 scope**：IDE 文件树面板（左侧 file explorer）、文件读写、git 状态、AI 对 workspace 的工具访问、cross-project deliverable migration。这些是 G2 之后的事，本 change 只把"绑定 + 上下文显示"打通。

## Capabilities

### New Capabilities

- `project-workspace-binding`: Project 持有可选 `workspace_root`，桌面端通过 Tauri dialog 选择本地目录、通过 opener 在 OS 文件管理器中打开；web 端 folder 字段降级为不可用说明。涵盖 schema 字段、create / update 流程、selector 空态引导、ProjectCreateDialog 三字段、Chat header ProjectContextStrip、Open folder action 平台分支。

### Modified Capabilities

_None._ `repository-backend-boundaries` 的 spec 只约束家族切分 / 三 backend 镜像 / 文件大小契约，不约束具体字段；新字段 `workspace_root` 的三 backend 同步要求由 `project-workspace-binding` 自身的 Requirement 1 承担。

## Impact

- **DB schema**: 新增 SQLite migration 026（desktop schema 计入下一个版本）。Postgres `db-platform` 暂不动（platform 侧暂无 project 概念落地）。
- **Tauri**: `Cargo.toml` 加 `tauri-plugin-dialog = "2"` + `tauri-plugin-opener = "2"`，`lib.rs` `.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init())`，`capabilities/default.json` 加两条 permission；`apps/desktop` 还要相应加 npm dep `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-opener`（被 ui-office runtime bridge 消费）。
- **web vite alias**：dialog / opener plugin 需补 browser stub（参考现有 `@tauri-apps/plugin-fs` 的 stub 模式），否则浏览器 dev 会动态 import 404。
- **ui-office**: `ProjectSelector` 重构（拆出 `ProjectCreateDialog` + `ProjectContextStrip`），`useProjects` hook `createProject` 签名扩展，`ChatPanel` header 接 strip。
- **shared-types**: `ProjectRow` 加 `workspace_root: string | null`；新 helper `formatWorkspaceRootHint(root)` 用于 truncate 显示。
- **core**: `ProjectService` 接口扩展 + `boss-node.ts` 调用点改成对象参数。
- **不影响**：scene / SOP / personnel / settings / market 表面。
- **CLAUDE.md**: 根 + `packages/ui-office/CLAUDE.md` 都要补一句 "Project = name + description + optional workspace_root + dedicated thread"，把"Project IDE 概念"从 deferred 状态改成 G1 落地态。
