## ADDED Requirements

### Requirement: Launcher main window uses a fixed-track grid layout

Launcher 主窗口的根容器 SHALL 使用 CSS Grid 而非 nested flex 控制纵向分段。Grid SHALL 声明恰好 4 个 row track，按从上到下的顺序：(1) header row，(2) 控制区 row（包含 launch 按钮和状态栏），(3) banner row（包含 error / database 提示），(4) 日志 row。前 3 个 track SHALL 使用 `auto` 大小（按 intrinsic 内容撑开），第 4 个 track SHALL 使用 `minmax(0, 1fr)`，并占据所有剩余高度。

#### Scenario: 默认窗口尺寸下渲染 4 段

- **WHEN** launcher 在 800×600 默认 Tauri 窗口尺寸下打开，且无 launch 进行中、无 error、database 状态为 healthy
- **THEN** 根容器渲染 4 段：header / 控制区（launch 按钮 + 状态栏） / 空 banner row（不占可见高度） / 日志区
- **AND** 日志区高度 ≥ 窗口可视高度的 60%

#### Scenario: 矮窗口下上方段不被压缩

- **WHEN** 窗口高度被拉到 Tauri minHeight 480
- **THEN** header / 控制区 / banner row 仍按 intrinsic 高度完整渲染，不被压到 min-content 之下
- **AND** 日志区按剩余高度渲染（即使只剩 1 行高度），日志区内部仍可滚动

#### Scenario: 唯一弹性区是日志区

- **WHEN** 窗口高度从 600 拉到 480
- **THEN** header / 控制区 / banner 段的高度保持不变
- **AND** 日志区高度按差额减少

### Requirement: Launch buttons remain reachable on narrow widths

Launch 按钮区 SHALL 使用响应式 grid，在 viewport 宽度足够时三列并排，在窄宽下退化为两列或单列。任何允许的窗口宽度（≥ Tauri minWidth 640）下，三个 launch 按钮 SHALL 全部可见、可点击，且按钮内 label 不被裁切。

#### Scenario: 默认宽度三列布局

- **WHEN** 窗口宽度 ≥ 768
- **THEN** 三个 launch 按钮（Desktop / Web / Web + LAN）在同一行三列等分排布

#### Scenario: 中等宽度两列布局

- **WHEN** 窗口宽度在 640 到 768 之间
- **THEN** 前两个 launch 按钮（Desktop / Web）排第一行两列等分
- **AND** 第三个按钮（Web + LAN）横跨两列单独占第二行，无右上空白格
- **AND** 每个按钮内 label 文本完整可读，description 文本最长不超过按钮宽度（必要时 truncate）

#### Scenario: 极窄宽度单列堆叠

- **WHEN** 窗口宽度 < 640（虽然 Tauri minWidth 限制 640，但用户放大字号或更改 config 可触发）
- **THEN** 三个 launch 按钮单列纵向堆叠
- **AND** 每个按钮仍可点击且 label 完整可读

### Requirement: StatusBar action buttons remain reachable on narrow widths

StatusBar SHALL 拆成两个独立 region：indicator region（包含 database / platform / frontend 状态、port、LAN 等只读信息）和 action region（包含 Stop / Restart Platform / Start Postgres 按钮）。两个 region SHALL 纵向堆叠（indicator 在上、action 在下），且 indicator region 内部 SHALL 允许 wrap，action region 内部 SHALL 允许 wrap。任何允许的窗口宽度下，所有 action 按钮 SHALL 全部可见、可点击，不被推出可视区。

#### Scenario: 默认宽度 indicator 单行 + button 单行

- **WHEN** 窗口宽度 ≥ 768，且 active mode 为 desktop / web / web_lan、database 为 healthy 且 docker 可用
- **THEN** indicator region 单行排显所有状态指示
- **AND** action region 单行排显 Stop + Restart Platform + Start Postgres 三个按钮，全部可点击

#### Scenario: 窄宽下 indicator 内部 wrap 不污染 button 行

- **WHEN** 窗口宽度被压到 640
- **THEN** indicator region 内部按需 wrap（database / platform / frontend / port / LAN 自动换行）
- **AND** action region 仍独立成段，button 不和 indicator 混排
- **AND** 如果 action region 自身也过宽，button 在其 region 内部按需 wrap 排第二行

#### Scenario: 无 active mode 时 Stop 按钮不渲染但 layout 不抖动

- **WHEN** active_mode 为 null
- **THEN** Stop 按钮不渲染，action region 只渲染剩余 button（Restart Platform 受 platform 是否 external 控制；Start Postgres 受 docker 可用性控制）
- **AND** action region 仍占独立一行（即使为空也不影响 indicator region 的位置）

### Requirement: Banner stack does not steal log viewer height

Error banner 与 Database unreachable banner SHALL 包裹在同一 grid row 内的纵向 flex 容器中，使用 `gap` 间距，不再各自占独立外层 div。当两条 banner 都不显示时，banner row SHALL collapse 到 0 可视高度。当 banner 显示时，banner row 按 intrinsic 高度撑开，日志区 1fr 自动让出对应高度，不影响其他 row。

#### Scenario: 无 banner 时 row collapse

- **WHEN** error 为 null 且 database 状态为 healthy
- **THEN** banner row 不渲染任何可见内容，不占用纵向空间

#### Scenario: 双 banner 同时显示

- **WHEN** error 非 null 且 database 状态为 unreachable
- **THEN** banner row 渲染两条 banner，纵向堆叠并有间距
- **AND** 日志区高度相应减少，但日志区仍占全部剩余空间

### Requirement: Layout uses pure CSS without JS viewport measurement

布局响应 SHALL 完全通过 CSS Grid + Tailwind 响应式断点（`sm` / `md`）+ flex wrap 实现。launcher SHALL NOT 引入 ResizeObserver、MediaQueryList JS hook、或基于 `window.innerWidth` 的状态分支来切换布局。

#### Scenario: 不存在 JS 布局测量

- **WHEN** 检查 `apps/launcher/src/**/*.tsx` 全部源文件
- **THEN** 不存在 `ResizeObserver`、`matchMedia`、`window.innerWidth`、`window.innerHeight` 的引用用于布局判断（已有 `setLogs` / IPC 调用等无关用途不受此限）
