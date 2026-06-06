# Offisim UI/UX Audit - 2026-06-06

按 2026-06-06 当前 worktree、用户截图、`Docs/UI_FRAMEWORK_STACK.md`、`Docs/design/.v3-dna-brief.md` 核对。本轮目标不是提出新风格，而是把截图中的异常收敛成明确产品判断、代码归因和后续修复目标。

## 总判断

这些问题不是孤立像素瑕疵，而是 Offisim V3 设计语言执行断裂：

- Office 右 rail 的 outputs、composer、thread list 没有严格遵守“thread-scoped inline + composer footer”的信息架构。
- Personnel / Settings 在宽屏下保留了大量无信息空白，违反 V3 的“dense desktop workbench / everything on screen is evidence”。
- 场景内员工移动已有底层拖拽事件，但主体验仍暴露为巨大 Move HUD，交互路径错位。
- Search、slider/button overlay 属于基础 slot/spacing 失败，说明局部组件没有稳定尺寸契约。

## P0 - Outputs 必须跟 thread 绑定

产品判断：Output 不是“公司最近产物”，也不是“任何 markdown 文件”。它是当前 thread 里 assistant/run 产生、可被用户理解为交付结果的产物。

当前归因：

- `useDeliverables()` 以 `['deliverables', companyId]` 为 query key，并调用 `repos.deliverables.listByCompany(companyId, { limit: 100 })`，没有接收当前 `threadId`。
- `OfficeThread` 接收 `deliverables` 后只判断长度，任何当前 company deliverable 都会触发 pitbar。
- `ConvOutputs` 只渲染传入列表，不知道当前 thread，也不做产物类型过滤。

修复目标：

- `useDeliverables(threadId)` 改为 thread-scoped query；真实 repo 调 `listByCompany(companyId, { threadId, limit })`。
- 新 thread 默认没有 output，除非该 thread 自己产生 deliverable。
- `tmp/`、调试文件、过程文档、内部 UI tool deliverable 不能进入用户 Outputs；需要一个显式 `userVisible` / `final` / `artifactKind` 判定，而不是按文件存在即展示。
- Outputs 区域保留在 right rail 的消息之后、composer 之前，或折叠在 composer footer 的轻量 pit 里；不应盖住 composer 主输入。

验收：

- 新建 thread 后 Outputs 不出现。
- 老 thread 有 output，切到新 thread 后 output 消失，切回老 thread 后恢复。
- `tmp/ui-tool-deliverable.md` 这类临时产物不出现在 Outputs。

## P0 - Composer 必须回到主流 assistant 输入模型

产品判断：输入框是主任务入口；attachments、mode、outputs 是辅助，不应挤成底部杂乱控件。用户截图里的 ChatGPT / Claude 对照说明：主输入区要有清晰输入焦点，工具在 footer，发送控件独立，模式选择小而可扫。

当前归因：

- `OfficeComposer` 使用单行 textarea + 单独工具行，视觉上像表单底栏，不像 assistant composer。
- V3 DNA 明确要求 mode chip 在 composer footer，但当前 composer 没有 mode chip，也没有把 run mode 和 output/attachment 状态合并成清晰 footer grammar。
- Outputs pitbar 单独插在 thread 和 composer 之间，会把 composer 从对话上下文里割裂出来。

修复目标：

- Composer 结构改为：主输入 textarea、footer 左侧工具/附件、footer 中部 mode chip、footer 右侧 send。
- Send 优先 icon+short label 或 icon-only tooltip，保持 30px grammar，不做大块 CTA。
- Outputs/Meeting pit 如果保留，只能是 footer 级别的小 chip；展开内容必须 thread-scoped。
- Placeholder 只表达“发给团队/员工”的当前上下文，不出现项目内部术语。

验收：

- 空 thread 首屏用户视线落点是 composer 输入，而不是 Outputs 或空白。
- footer controls 不挤压输入内容，窗口缩小时不重叠。

## P0 - Search / icon overlay 是基础组件问题

产品判断：放大镜和 placeholder overlay 是不可接受的基础控件缺陷，属于 shared grammar 的稳定尺寸问题。

当前归因：

- `SearchInput` 用绝对定位 icon + `padding-left: 30px`。
- token 为 `--off-search-icon-inset: 10px`、icon 约 16px，理论剩余间距只有 4px；在不同 font/render scale 下容易撞 placeholder。
- wrapper 没有把 icon slot 作为布局列，靠 padding 猜距离。

修复目标：

- SearchInput 改成 grid/flex slot：固定 28-30px leading icon column + input flex。
- input 自身 `padding-left: 0`，placeholder 从 slot 后开始。
- 所有 search 输入复用这个组件，不允许局部重写 icon/inset。

验收：

- Thread search、Personnel search、Workspace contacts search 均不出现 icon/text overlay。
- 125%、150% 缩放下仍不重叠。

## P1 - Appearance 页把主空间给 3D，而不是重复头像

产品判断：Appearance 页的核心价值是“调节后看员工在办公室里的 3D 形态”。2D 头像已在顶部 header 和列表里出现，不需要在右侧占一个大卡片重复展示。

当前归因：

- `AppearanceTab` 右栏固定 260px，依次渲染 2D 和 3D `PreviewCard`。
- 3D 预览和 2D 预览同级，导致 3D 只能拿到半栏小卡片，用户看到右侧大面积空白。
- 文案还写“drive both the 2D avatar and the 3D preview”，把 2D 和 3D 权重错误地拉平。

修复目标：

- 右侧改为单个主 3D preview panel，吃掉完整可用高度。
- 2D 头像降级为 header/live swatch，或作为 3D panel 内的小角标对照。
- 控制区保持左侧 dense form；主反馈区必须展示 3D 员工完整身体、可旋转、不卡在卡片上边缘。

验收：

- Appearance 首屏不用滚动即可看到完整 3D 人物。
- 2D 不再占用一个独立大卡片。
- 右栏没有无意义空白。

## P1 - Settings 空白区必须承载上下文信息

产品判断：Settings 内容列 720px 是对的，但宽屏右侧不能是空灰区。V3 不是 SaaS 表单页，空白必须变成上下文 preview、status summary 或说明证据。

当前归因：

- `.off-settings` 是 `244px 1fr`，`.off-set-pane` max-width 720px。
- `.off-set-scroll` 只有内容列，没有右侧 companion 区域，宽屏自然露出大面积灰底。

修复目标：

- Settings 主区改成 content column + compact companion rail。
- Provider companion 显示当前 provider health、model route、last test、credential scope。
- Runtime companion 显示当前 effective run mode、tool policy、memory summary、哪些设置已接线/未接线。
- 若某 pane 没有 companion 内容，主列居中但背景不形成巨大空洞。

验收：

- 1440px / 1800px 宽度下右侧不再是空灰面。
- Provider / Runtime / MCP / External Employees 都有明确上下文承载或居中策略。

## P1 - Runtime 文案必须像 agent 产品，不像内部设置表

产品判断：用户需要知道“员工怎么执行任务”，不是知道内部 runtime lane。模式语义应对齐主流 agent：Plan / Human-in-loop / Direct / YOLO。

当前归因：

- `EXECUTION_MODE_OPTIONS` 当前表单值是 `auto` 等内部状态。
- UI 同时出现 `Offisim core / Verified driver / Isolated driver`，这更像工程实现路线，不像用户决策。
- 页面已诚实披露“not yet read by runtime”，但这使它更像 debug pane，而不是产品设置。

修复目标：

- 用户可见 execution mode 改为：
  - Plan：先产出计划再执行。
  - Human-in-loop：关键动作前请求确认。
  - Direct：直接执行常规任务。
  - YOLO：少确认、高自主。
- 底层 value 可以继续映射旧字段，但 UI 不展示 `auto/manual/review every step` 这类半内部名。
- Runtime pane 把“未接线”收进 developer/advanced disclosure，不放在主路径吓用户。

验收：

- 非工程用户能从 label 和一句说明理解差异。
- 页面主路径不出现“values are not yet read by runtime”这种破坏信任的文案；如果必须保留，放到 developer note。

## P1 - 员工移动主路径是场景拖拽

产品判断：办公室场景就是空间 UI。移动员工的主路径应是在场景里抓起员工、看到半透明拖拽化身、看到落点反馈、放下完成。Popover Move HUD 只能是辅助路径。

当前归因：

- `OfficeScene3D` 的 `EmployeeUnit` 已有 pointer down / move / drop，能记录 zone hover 和 drop diagnostic。
- 拖拽状态只高亮 zone rug，没有渲染跟随指针的透明员工 ghost。
- `TeamDock` popover 里 `off-team-zone-picker` 渲染了大块 Move grid，把辅助路径做成了主视觉。

修复目标：

- 拖拽员工时隐藏或弱化原位置员工，同时渲染跟随落点的半透明 3D/2D ghost。
- 目标 zone 用小型 rug highlight + label，不用巨大 HUD。
- Popover 里的 Move 改为 compact “Move to...” dropdown 或小 chips，并放到低权重位置。
- 拖拽失败要有轻量反馈：missed / not moved 不应静默。

验收：

- 抓员工移动过程中能看见透明员工。
- 有明确可放置区域反馈。
- Popover 不再出现占据半个卡片的 Move zone grid。

## P2 - slider/button overlay 同属控件尺寸契约缺失

产品判断：数值、slider、Add button 重叠说明控件组合没有保留稳定轨道宽度和按钮 slot。

修复目标：

- 所有 numeric + slider + action row 使用固定 grid：number slot / slider flex / action slot。
- button 不覆盖 slider track；disabled 状态也保持完整布局。
- 这一类 row 不允许靠 absolute 或负 margin 对齐。

验收：

- 0%、50%、100% slider 位置下，数值、thumb、Add button 都不重叠。

## 修复顺序

1. Output thread scope + output eligibility。
2. SearchInput slot 化，顺手覆盖所有 search。
3. Office composer footer 信息架构。
4. Office scene employee drag ghost + 降级 Move HUD。
5. Personnel Appearance 3D-first layout。
6. Settings companion rail / Runtime 文案。
7. slider/action row 尺寸契约扫描。

这个顺序先修会破坏用户信任的状态错误，再修基础控件，再修信息架构和空间效率。
