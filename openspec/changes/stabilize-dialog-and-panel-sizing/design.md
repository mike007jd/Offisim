## Context

Offisim 当前的 dialog/panel 尺寸是各表面自治的：Company creation / Employee Editor / Studio Properties / Settings 各自写 height/max-height/overflow。视觉后果——

- **Tab 切高度跳变**：dialog 没有 `min-h-0` + 内部 `overflow-y-auto` 链路，长 tab content 把 dialog 整体撑高，切回短 tab 又塌回。
- **Sticky footer 盖内容**：narrow viewport 已经有 `responsive-app-shell` 兜底，但 desktop/tablet 上常见"最后一个表单字段被 footer 盖住"，因为 dialog 内容区没预留 footer 高度的 padding-bottom。
- **Cards 套 cards**：主 shell workspace center 外面包一层 `SurfaceCard`，里面工作区表面又自带卡片；Company creation 外层 dialog 卡片 + 内层每个 step 自己 SurfaceCard + step 内每个 input group 又一层 card；视觉上是三层圆角嵌套。
- **Company creation Back 错位**：截图 5/6 显示 Back 在 dialog header 角落，与底部 Company Name input + Start / Open Studio Editor 不在一起，操作流被打断。
- **"Open Studio Editor" 名实不符**：现在按钮只创建公司停在 Office 主界面（或者只切换 active company 不打开 Studio）；用户当文案承诺看待 → 期望点完直接进 Studio edit mode。

A4 立"全局尺寸+流程"契约，落第一批表面（主 shell / Company creation / Employee Editor / Company Profile）。其他表面（SOP / Market / Activity / Studio / Settings）后续 H1 + 各自 phase 跟。

## Goals / Non-Goals

**Goals:**

- 立 panel/dialog 尺寸 SSOT（min-height / max-height / 内部滚动容器）。
- Tab 切换前后 dialog 外框高度差严格 = 0（不依赖内容长度补 padding 假装稳定）。
- Cards-in-cards 第一批 4 surface 落到 ≤ 1 层 visual container。
- Company creation footer 操作行 = `Back | Company Name | Start | Open Studio Editor`，所有按钮同一 horizontal 行。
- "Open Studio Editor" 一次完成 create company + set active + open Studio in edit mode；失败有明确 error，绝不静默只完成一半。

**Non-Goals:**

- 不重做 dialog primitive 库（`DialogShell` / `SurfaceCard` 现有 API 保留，仅修订内部 className/structure）。
- 不动 narrow viewport 行为（`responsive-app-shell` 已兜底）。
- 不做 SOP / Market / Activity / Studio / Settings 这一批 surface 的 sizing/cards 修订（留给 H1 + phase 各自闭环）。
- 不改 dialog close/focus/Escape 协议（`dialog-overlay-protocol` 已闭环）。
- 不引入新 modal library / animation 库。

## Decisions

### D1. Sizing token 落到 Tailwind clamp 而不是 CSS variable

`min-height: clamp(360px, 60vh, 720px)` / `max-height: min(720px, 92vh)` 用 Tailwind arbitrary value 直接写到 dialog primitive 内，不另立 CSS variable 层。

**Why over CSS variable**：repo 现状 Tailwind-first，没有现成的设计 token 注入管线；引入 `--dialog-min-h` 要同时改 `tailwind.config` + global CSS + 各 dialog 类名，增量成本 > 收益。Tailwind clamp 内联表达式直接写在共享 dialog primitive 一处，复用方零成本。

**Trade-off**：将来要让用户自定 dialog 尺寸（设置项 / theme pack）时，得回到 CSS variable 方案。当前 1.0 范围内不存在这需求，先写死。

### D2. 共享 `DialogShell` primitive 包装 `Tabs.Content`

dialog 内有 Tabs 时，外壳 → tabs nav → tabs content 各自 flex-col 链路必须显式：

```
<DialogShell className="flex flex-col min-h-[clamp(360px,60vh,720px)] max-h-[min(720px,92vh)]">
  <DialogHeader />
  <Tabs.Root className="flex flex-col flex-1 min-h-0">
    <Tabs.List />
    <Tabs.Content className="flex-1 min-h-0 overflow-y-auto" />
  </Tabs.Root>
  <DialogFooter />
</DialogShell>
```

关键：每一层都带 `min-h-0`（否则 flex child 默认 `min-height: auto` 撑出 overflow），`overflow-y-auto` 落在 Tabs.Content 不在 DialogShell（否则 footer 也会被滚走）。

**Why**：Radix Tabs 默认 `Tabs.Content` 是 block，没有内部滚动机制；不显式给 `flex-1 min-h-0 overflow-y-auto` tab 切换就会让 dialog 自适应内容高度。

**Alternative considered**：每个 dialog 自己写 className → 现状，被本 change 取消。或者把 sizing 直接写到 Radix Tabs.Content data attribute 选择器 → CSS 层 hidden 行为，不如 className 显式。

### D3. Cards-in-cards 第一批 ≤ 1 层

主 shell 内 workspace center 直接渲染 `WorkspaceRouter` 输出，外面不包 SurfaceCard。Company creation dialog 外壳是 dialog 自身（视觉算 0 层 card），内部每个 step 直接渲染表单字段 + 操作按钮，不嵌 SurfaceCard；如果 step 内有多组字段需要视觉分组，最多 1 层 SurfaceCard 分组。

EmployeeEditorDialog 同理：dialog shell 是 0 层，appearance / runtime / skills 等 tab content 直接表单，不再每个 input group 一层 card。

CompanyProfile 面板同理：profile 外壳是 panel container（0 层），内部 metric / settings 区域 ≤ 1 层 card。

**Trade-off**：去 cards 后视觉分组靠间距 + 分隔线 + heading 层级，需要 spacing token 严格执行；如果不严格，会显得"散"。具体 spacing 走 `design-system-consolidation` 已立 token，不在本 change 引新。

### D4. Company creation footer 行布局

footer 单行 grid：`Back | spacer | Company Name input | Start | Open Studio Editor`。narrow viewport 走 `responsive-app-shell` 单列堆叠（Back/Start/Open Studio Editor 仍同列依次堆，Company Name input 顶部）。

**Why over keeping Back in header**：用户 mental model 是"沿着 footer 操作行往右走"——Back 在 header 角落让人怀疑是 dialog close 而不是流程返回。同列后语义清楚：Back = 退一步 / Start = 继续 / Open Studio Editor = 继续并直接进编辑。

### D5. "Open Studio Editor" 三步原子组合

按钮 onClick handler：

```
async function handleOpenStudioEditor() {
  setSubmitting(true);
  try {
    const company = await createCompany(formData);  // 1. create
    await setActiveCompany(company.id);              // 2. activate
    studioStore.openInEditMode(company.id);          // 3. open Studio in edit
    closeDialog();
  } catch (err) {
    setError(err);  // 不闭 dialog，让用户看到失败原因
  } finally {
    setSubmitting(false);
  }
}
```

三步必须串行，任一步失败 dialog 留开 + 显式 error。**绝不**允许"创建成功但未激活"或"激活成功但 Studio 没开"这种半完成态——属于 product closure bar "不要靠 fallback 假装完成"。

**Why over 各自 effect 链**：现状如果是"创建后 effect 监听 active company change → 再 effect 监听 dialog close → 再调 studioStore"——异步链 race + 每步可独立失败。一个 handler 串行最稳。

**Risk**：`createCompany` 现有调用方可能不 await（fire-and-forget）；apply 阶段需要审 onboarding 当前调用栈是 reducer/dispatch 还是 promise，必要时让它 expose 一个 promise-returning helper。

### D6. Spec 拆两个 capability 不合一

`panel-and-dialog-sizing` 管 sizing/scroll/cards-in-cards；`company-creation-flow` 管 Back placement + Open Studio Editor 行为。两件事是不同 concern：sizing 是表面渲染契约（横切），flow 是单一 surface 的端到端行为（纵深）。合一会让 spec 把"全局尺寸规则"和"单 dialog 流程"混成一锅 requirements，未来 query / 扩展 spec 都难。

## Risks / Trade-offs

- [Tab 切换实测可能不止 sizing 一处] → apply 阶段先在 Employee Editor + Company creation 各自切 tab 测，发现还有"内容懒挂载先 0 高度后撑高"造成的瞬时跳动时，用 `Tabs.Content forceMount` + `data-state` CSS 隐藏代替 conditional render；不在本 change scope 强制做，留 followup observation。
- [Open Studio Editor 三步串行可能让按钮 latency 显著] → 串行通常 < 200ms，不需 progress UI；如果实际跑出 > 500ms，加 `Submitting...` 状态。
- [去 cards 后视觉过散] → 靠 `design-system-consolidation` 现有 spacing token；如果 live verify 觉得太散，下一条 H1 `compact-settings-center` 一并调密度，不本 change 回退加 card。
- [`createCompany` API 不返回 promise] → apply 阶段第一步审 + 必要时改成 promise-returning（这步如果改动 repo / store API 较大，单开 followup change，不塞 A4）。
- [Live verify 可能发现某 dialog 一切 tab 仍跳高] → 不是契约失败，是某 dialog 没接 D2 的 className 链路；apply 阶段把 4 个 surface 都过一遍，遗漏的 surface 走 followup observation。

## Migration Plan

无 schema / API / 数据迁移。仅前端容器 + className + 一处 onboarding handler 改写。`/opsx:apply` 串行：

1. 立共享 dialog primitive 的 sizing className（`packages/ui-office/src/components/shared/DialogShell*` 或等价，确认现有 export）。
2. AppLayout 主 shell workspace center 去外层 SurfaceCard 包裹。
3. Company creation footer 行重布局 + Open Studio Editor handler 三步原子化。
4. EmployeeEditorDialog + CompanyProfile 应用 D2 链路 + 去 cards-in-cards。
5. Live verify 三视口 × 4 surface。

回滚：单 commit revert 即可，无 schema 锁。

## Open Questions

- Company creation 当前是否已经在 narrow 单列下让 Back 落到底部？需要 apply 第一步先 grep `Back` 在 onboarding 子树的位置确认，避免重复劳动。
- "Create your own" 是否就是当前 "Open Studio Editor" 按钮的另一处文案？apply 时确认，必要时统一文案到 "Open Studio Editor"（或保留 "Create your own" 视设计倾向，行为契约一致即可）。
