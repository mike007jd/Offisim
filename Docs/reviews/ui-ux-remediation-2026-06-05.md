# Offisim 全功能系统审计 + 整改 — 2026-06-05

按 2026-06-05 当前代码核对。release `.app` Computer-Use live 验收通过。

## 审计范围与方法

在 2026-06-04 那轮（已闭 P0/P1/P2 的 9-surface 运行时视觉审计）之上，做一次**更宽**的全功能系统审计：

- 对照完整的「GPT 系列 UI/UX 反模式」清单（巨标题/Hero 失控、蓝紫渐变成瘾、emoji 当图标、装饰图表、堆叠卡片、动效单调、弱品牌、漏需求等 21 条）逐 surface 核。
- PM 完整度视角：每个 surface 的状态矩阵（loading / empty / error / populated / 长文 / 多项 / 未连接 / 运行中）、mockup 完成度、边际情况、死码。
- 方法：10-agent fan-out 审计 + 逐条对抗式验证（剔除误报），再人工逐条核源码定夺。

产物：审计原始结论 52 条（对抗验证后确认 46 / 驳回 6）。

## 总体结论：设计底座很克制，不是 GPT-slop

你列的那批反模式，绝大多数在这个仓库里**已被纪律性挡住**，审计实测：

- **字号无失控** — 全仓 0 处裸大字号，type scale 硬封顶 19px（`--off-fs-xl`）。巨标题/Hero/指标数字虚胖无处藏身。
- **无蓝紫渐变成瘾** — accent 是克制的蓝 `#2f6bff`，violet 仅辅助；CSS 里 0 处 indigo/purple 裸色；渐变全是 token 化功能用途（头像/网格/skeleton/品牌徽章）。
- **动效不单调** — 默认是自定义减速曲线 `cubic-bezier(0.2,0,0,1)`，dialog 用 spring，`ease-in-out` 只留给 loading 旋转，reduced-motion 全局兜底。
- **emoji 当图标基本不成立** — 唯一命中是 `CompanyTemplate.icon`（🏢📝🚀🏗️🧠🛠），经追踪是**死数据**，UI 实际渲染的是 lucide 组件。本轮已删除该死字段。
- 状态基元 EmptyState / ErrorState / SkeletonRows 齐备；无 "coming soon" / stub 半成品占位。

真正的问题集中在 **5 类**：① 系统性错误态缺失 ② 假功能控件（写了没人读 / save 丢弃）③ 数据丢失 ④ 诚实度（死态伪装成 live）⑤ 死码。本轮全部处理。

## 已交付整改（按波次）

### W1 — 系统性错误态 + 每 surface ErrorBoundary

问题：`ErrorState` 基元存在但只接进 2 个 surface。query 失败（SQLite 锁、迁移漂移、IPC 错）时，其余 surface 落到「空」态——用户分不清「没数据」和「加载失败」，且无重试路径，可能以为数据丢了。

修复：把 `isError → ErrorState → refetch` 接入 Lifecycle / Activity / Studio / Personnel(Skills·Memory·History) / office(ThreadList·ChatRail) / workspace 全部 6 个 app（Approvals·Calendar·Contacts·Messenger·Workplace）。`SurfaceRouter` 增加 **per-surface keyed ErrorBoundary**——单个 surface render 抛错降级成「pane 内错误页」而非炸掉整壳，导航切换自动复位。

### W2 — 假功能控件诚实化

- **Settings → Appearance（Theme/Density）整段删除**。视觉上完全惰性：无 dark token 集（dark/system 在暗色 OS 下仍渲染 light），无任何 CSS 消费 `data-density`。light-only 是既定设计，提供一个无实效的主题选择器本身就是装样子。
- **Provider 高级字段删除**：Provider variant / Execution lane / Default headers JSON——save 时被 `runtime_provider_profile_upsert` 丢弃、无 live 效果（保留 Access mode：它是真 live gate，控 key 字段显隐）。
- **Runtime 表单诚实披露**：execution mode / tool search / git auto-commit / memory / summarization 这些字段 persist 了但 `desktop-agent-runtime` 硬编 `executionMode:'desktop-trusted'`、不读任何键。改 panehead 文案为「saved as local preferences」，并加诚实 note：「In this build employees run in Offisim's trusted desktop lane; these values are not yet read by the runtime.」（真正接线是后端 epic，越界不做）。
- **Calendar 假 dot 接真数据**：原来 calendar 导航点恒亮，改成只在「今天真有日程」时亮（接 `useWsAgenda`）。
- **Calendar Today/Week**：删掉只有单实义的 Week 段控件 + 让 Today 真正 `scrollIntoView` 到今天（无今天则禁用）+ 去掉借用「拒绝」语义的红色样式。

### W3 — 数据丢失 + 边际护栏

- **Personnel 切换员工不再静默丢弃未保存编辑**：复用既有 `showDiscardConfirm` bar，切换前若 Profile/Appearance/Tool 有 dirty 编辑则拦截确认。
- **Lifecycle 公司名 overflow + 长度**：hero 名 `overflow-wrap`，列表名 ellipsis，创建/重命名输入 `maxLength=60`。
- **Activity 默认窗口自动放宽**：默认 "Today" 在今天为空但有历史时，自动放宽到最窄的非空窗口，避免首屏假「无事件」。

### W4 — 诚实降级（死态不伪装 live）

- **Personnel roster** 删掉永远显示 "idle" 的多态 presence pill + 永不触发的 "Recovery pending" chip（`presence` 是 fixture-only，release 恒 idle）。保留真实的 `disabled` chip。
- **Workplace** 删掉恒为 0 的「X working now」。
- **Profile「Current workstation」** 不再对已坐工位的员工谎称 "Unassigned"（原条件依赖从不被填充的 `deskLabel`）；改用真实的 `workstationId` 判断。
- **Approvals** 改成诚实的 triage/review 视图：gate 的解决是 run 内 thread 作用域的 in-memory 路径（`InteractionService.pending`），与跨公司 DB 队列解耦，且 `resolveInteraction` 成功/失效都返回 null 无法区分——所以**不做假接线**（会对多数行静默 no-op 并误导「已批准」），改去掉伪装成可交互的 scope 段控件、把死的 Approve/Deny 换成诚实引导「在发起会话里响应」。完整 triage-resolve 是后端 epic（按 interactionId 重水化 pending），记为 deferred。

### W5 — Office 2D 场景接真实数据

问题（mockup 不完整）：2D 场景用 fixture `useOfficeScene()` 画死的 16×12 三 zone 假地板，且遍历 fixture placement（员工 ID 永不匹配真 roster）→ **2D 永远显示假地板 + 0 个员工**，与 3D 严重不一致。

修复：抽出共享 `scene/scene-layout.ts`（zoneDefs 构建 / seat 数学 / floor 推导 / archetype 映射），3D 纯抽取零行为变化，2D 改用 `useOfficeLayout(companyId)` + 真 roster。**live 验收：2D 现在显示真实 7 个 zone + 9 个真员工坐进各 zone，与 3D 同源。**

### W6 — 空态/边际打磨

- Studio 空场景（真实零 zone）给专门的「Empty scene · Create first zone」EmptyState（区分「有 zone 但未选中」）。
- Studio layout 加载失败不再伪装成「preview mode」，改显真错误 banner + Retry。

### W7 — 死码清理

- 删整个图表子系统：`UsageChart`（孤儿组件，零渲染点 + `type="monotone"` 装饰贝塞尔）+ `useUsageSeries` + `UsagePoint` 类型 + `usageSeries` fixture。
- 删 `CompanyTemplate.icon` emoji 死字段（6 处）。
- 删本轮产生的孤儿 CSS（personnel presence pill）。

## 门禁 / 验收

全绿：

- `pnpm --filter @offisim/desktop-renderer typecheck`
- `pnpm --filter @offisim/desktop-renderer build`
- `pnpm --filter @offisim/desktop build`（release `.app` 已打包）
- `pnpm check:ui-hygiene`
- `pnpm check:ui-ux-drift`
- biome 格式化已应用到全部触碰文件（剩余诊断均为预存、不在 `validate` 门禁内、且在未改动行）。

release `.app` Computer-Use live 验收（exact worktree 路径，pid 8470）：
- W5 2D 场景真 zone+真员工 ✅
- ACT-2 默认自动放宽到 "Last 7 days" 显历史 ✅
- W2 Runtime pane 无 Appearance + 诚实 note ✅
- W4 Personnel roster 干净无假 pill ✅
- Lifecycle 真数据 + 克制 hero + 无 emoji ✅
- Office 真场景 + 无 bell + dock IDLE ✅
- Settings 720px 内容列 ✅

## 已 accepted / deferred（不阻塞上线）

- **Approvals 完整 triage-resolve**：需后端按 interactionId 重水化 pending（跨层 epic）。本轮已做诚实化。
- **Runtime 表单真接线**：execution mode / memory / summarization 需后端读取（越界）。本轮已做诚实披露。
- **预存的不可见死码**（modifier 级）：`.off-act-detail.is-bare` / `.off-team-status.is-online` / `.off-kv-caps`(display:none) / `ExternalEmployee.connected` VM 字段 / History fork-provenance（mapper 硬编 null）。不阻塞门禁、不可见、属未接线脚手架，留作独立卫生 change。
- **Meeting.tsx + MeetingTray**：被 OfficeThread 渲染但 `run-store.meeting` 无 producer → 恒渲染 null。是有意的未来功能脚手架（渲染空、不伪装），保留。
- **P3 polish**：market 空连接 registry 无可做动作（不加无去处按钮）/ market 卡片名+handle 独立截断 / Activity payload 深度护栏 / office 空团队首跑引导。低概率或无清晰动作，留作后续。
