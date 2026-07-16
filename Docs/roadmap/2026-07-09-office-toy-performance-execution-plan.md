# Office Toy Performance — Execution Plan (verified-iteration-loop)

> **Historical / superseded (2026-07-16):** completed execution ledger. Use
> the [current Codex-alignment tasks](./2026-07-13-ui-ux-consistency-pass/tasks.md),
> [Office art bible](../design/office-art-bible.md), and current release gates.

Companion to `2026-07-09-office-toy-performance-requirements.md`（specs）与
`plan-office-toy-performance-overhaul.md`（决策记录）。依赖排序的实现 backlog，
基于 2026-07-09 深读事实清单（file:line 证据）。每 phase 收口走
`/simplify`（lead 亲自）+ `codex exec` 直审 + findings verify/fix + 门禁复绿
（用户 2026-07-02 gate 指示；禁 token 巨贵的 code-review workflow）。

分支拓扑：`docs/office-toy-performance-package` → `feat/office-toy-p0-spike` →
`feat/office-toy-p1-characters` → … → `feat/office-toy-p6-open-diorama`，每个 phase 一个线性
stacked PR；只 push / 开 PR，不合并、不改 `main`。Checked at 2026-07-11。

## Corrected assumptions（深读核实，执行时勿再踩）

- **座位补位根因已定位**：`scene-layout.ts:581-583` `employees.forEach((employee,index)=>seats[index])`——分座按 roster 数组顺序，无身份绑定。2D/3D 必须继续消费同一个 placement 单源。
- **仅按 employee id 排序仍不满足 B1**：增删较小 id、跨 zone 移动都会改变后续员工的 slot；要同时满足“增删/重排/他人换 zone 不动其余座位”和跨会话稳定，P2 必须先冻结持久 seat-slot registry 契约。拖拽现只把 `workstation_id` 持久化，精确 x/z 不落库；本 epic 又禁止碰 Rust/core schema，因此 registry 必须留在允许的 renderer/shared 边界，不能用排序伪装稳定性。
- **expression 不改脸**：无 morph target（`GltfCharacter.tsx:67-69`），A2 眼神贴片是全新机制，不是"接通现有表情"。
- **ambient 系统不存在**：员工唯一离位来自 dramaturgy beat relocation（`office-projection.ts` + `staging.ts`）；`phone`/`consume` clip 已打包但不可达（`clip-map.ts:20-22`）。Group E 是全新子系统，挂在 renderer 侧、消费现有 modes.ts 门控。
- **prop 枚举与挂手不对称**：5 值枚举 vs 2 个 mesh（`PROP_ATTACH`，`GltfCharacter.tsx:161-175`）；`terminal`/`pointer` 视觉静默缺失。
- **`accentVariant` 是死字段**：vest/jacket/scarf 无几何（`GltfCharacter.tsx:66-68`），A3 直接删。
- **`IDLE_PERFORMANCE` posture 默认 `sit`**（`performance.ts:42-49`）——ambient/座位改动时注意基态语义。
- **UAL raw pack 未入库**：`CHARACTER_ASSETS_RAW_DIR` 必须重建 raw 工作区（`build-character-assets.mjs:73-107`）；rename 表只导入 19/更多 clip，**先核对 pack 全量再决定 sit.type/approval.wait 是挖还是造**。
- **性能既定事实**：无 instancing、LOD 仅 ServerRack、`frameloop="always"` 刻意保留（`OfficeScene3D.tsx:932-938`）、`SCENE_CONTENT_SCALE=1.18` 跨包耦合无 guard（`scene-art-direction.ts:38-43`）。
- **保留机制勿破坏**：`animationTempoForRole`（role→动画速度）、per-employee `phase` 去同步（只影响动画不影响 identity，`GltfCharacter.tsx:430-432`）、rig remount `key={rig.id}`（drei action 缓存）、identity 绝不用 phase。
- **harness 计数会变**：`harness-character-clip-map.mts:143-144` 断言 12960 states（含 prop 维度 6=5 值+undefined）；WorkGesture/prop 枚举一动，计数与断言同步改，这是预期内改动不是回归。

## Phase backlog（依赖序）

| # | Phase | Groups | 闭合 | 风险 | 说明 |
|---|-------|--------|------|------|------|
| 0 | Spike：玩具比例 go/no-go | A1 核心 | R1 | **高** | 1 个玩具 body × 19 clip × 1 张度量同步工位 × laptop 挂手；release .app 截图评审；不过关走升级阶梯（放宽头身比→新骨架重定向） |
| 1 | 角色系统全量 | A1-A5, G1 | 痛点主体 | 中 | 单一玩具体 + 眼神贴片 + schema 演进 + garment 重调 + 岗位配件/工牌 |
| 2 | 座位身份与移动 | B1-B3 | P-5 | 低-中 | 身份稳定分座 + 走路换位 + 拖拽语义；纯 shared 层，2D 同吃 |
| 3 | 动作补全 + 状态机 | C1-C3, G2 | P-1 | 中 | raw pack 核对 → sit.type/approval.wait → proxy 清理 → 枚举/harness 同步 |
| 4 | 状态视觉语言 | D1-D4 | P-3, P-4 | 低-中 | 四态 overlay 收敛 + diegetic 优先 + 指示器随 art bible 重绘 |
| 5 | Ambient 生命感 | E1-E3 | P-2 | 中-高 | 全新确定性调度器；phone/consume 终于可达；seeded 可重放守卫 |
| 6 | Diorama 环境 | F1-F4 | 「简陋」 | 中 | 拆墙地台 + 家具度量派生(R1b) + props 密度 + art bible 落盘 |

依赖关系：P0 → P1 → P2 → P3 → P4 → P5 → P6（PR 线性堆叠；实现上的独立性不改变
stack 顺序）。P1 先建立 `office-art-bible.md` 的角色、色板、圆角与指示器 token，P4 消费；
P6 只补齐环境/灯光/props 章节，避免先消费后建规范。P6 依赖 P1 的 art bible 与 P0 度量。

## P0 contract freeze（2026-07-10）

P0 只验证升级阶梯第一档：**保留 Quaternius Universal 65-joint 骨架与非 root-motion
动画，程序化生成同骨架玩具胶囊 body**。不得在 spike 中偷换新骨架或用旧 body 换色冒充。

### Source / build contract

- raw 工作区必须完整含五个当前官方免费 CC0 包：Universal Base Characters Standard、
  Universal Animation Library Standard、Universal Animation Library 2 Standard、Kenney
  Furniture Kit、KayKit Furniture Bits Free。源 URL、下载文件 SHA-256、归一化记录见
  `Docs/evidence/2026-07-office-toy/p0/source-manifest.json`；raw 本体不得入库。
- UAL1/UAL2 Standard 实际各含 43 个 clip；不得把官网完整付费包的 120+/130+ 宣传数当作
  免费 Standard 清单。逐 clip 名见 `source-clip-catalog.json`。
- 运行时仍只产出当前 canonical 19 clip；P0 不用 proxy 新增 `sit.type` / `approval.wait`，
  它们在 P3 依据本清单走程序化 additive track。
- 构建器必须可在同一 raw 输入上连续 clean build 两次并得到逐文件相同 SHA-256；提交资产
  总量仍须 ≤ 25 MiB（`25 * 1024 * 1024 = 26,214,400` bytes，与现有门禁精确一致）。

### Character / workstation metric contract

统一度量以 `CHARACTER_HEIGHT = 1.62` 为基准。下表是**设计目标**，不是绕过实际 body/clip
采样的硬编码答案：

| Metric | Formula | P0 value |
|---|---:|---:|
| head height | `CHARACTER_HEIGHT / 2.45`（允许 2.2–2.6 头身） | 0.661 |
| seat top | sampled `sit.idle` butt Y + seated lift | 0.420 |
| chair cushion center | `seatTop - 0.040` | 0.380 |
| desk top | sampled `sit.talk` palm work envelope | 0.768 |
| laptop deck | `deskTop + 0.012` | 0.780 |
| seated body lift | `seatTop - sampled sit.idle butt Y` | 0.170 |
| seated body forward | 同时让臀点进入椅垫平顶、双掌进入桌面 XZ 工作区 | 0.380 |

`body_toy.glb` 必须输出与胶囊表面一致、可被自动采样的命名 landmark：`ToyHeadTop`、
`ToyChin`、`ToyButtContact`、`ToyPalmL/R`、`ToySoleL/R`。P0 harness 以 release 相同的
body scale、clip、seated lift/forward 和 canonical 单人 workstation transform，在 clip
normalized time `0, .25, .5, .75, 1` 采样 world transform，并把逐点结果写入
`Docs/evidence/2026-07-office-toy/p0/oracle-results.json`：

- bind pose：`(HeadTop.y - Chin.y)` 对应 2.2–2.6 头身；`min(SoleL.y,SoleR.y)` 为地面 0。
- `sit.idle @ .5`：`abs(ButtContact.y - seatTop) ≤ 0.05`。
- `sit.idle` 或 `sit.talk @ .5` 的指定工作接触帧：**双掌** Y 均在 `deskTop ± 0.08`，
  且变换到 workstation-local 后，X/Z 均落入桌面 footprint（四边内缩 0.04），禁止只验 Y。
- laptop 自动检查不再使用“anchor 距 hand”这个挂骨后恒真的条件；改验 held prop world AABB
  可见、与手部相交且不穿桌，再由 release 近景确认朝向/读形。
- standing locomotion clips 逐 60Hz 重采样，至少一只鞋底必须处于地面容差 `≤ 0.04`；腾空
  有意图的 clip 只走视觉检查，不用错误的双脚着地规则。

P0 只把**角色 + 单张 canonical workstation 的纵向/接触度量**收进
`workstation-geometry.ts` 单源；P6 才把同一度量铺到所有家具、座位锚点和 obstacle radius，
两者不是重复派生。静态体型与办公室相机距离还必须读成“玩具员工”而非幼儿。

### Animation / visual oracle

- 只使用 `UAL1_Standard.glb` / `UAL2_Standard.glb` 非 RM 源；每个 retained clip 的 root
  translation **全部 keyframe**相对首帧的最大绝对 XYZ 位移均 ≤ `1e-5`，不能只比首尾。
  禁止依靠运行时每帧回拉遮住中途 drift。
- release 诊断驱动契约：`GltfCharacter` 提供仅供 fixture 使用的显式 canonical clip override；
  `VITE_OFFICE_TOY_P0_DIAGNOSTIC=1` 构建的 release `.app` 在 Personnel 角色预览显示
  19-clip sequencer（manifest 顺序、每段 4 秒、当前 clip 标签、暂停/前后切换）。正常构建
  不显示诊断控件，业务 performance mapping 不因 fixture 改写。
- 19 clip 必须通过 sequencer 逐个播完；近景检查自穿模、脚滑、道具穿手、坐姿接触，
  正常 release 的办公室相机与远景检查轮廓/动作可读性。保留 role tempo、per-employee
  phase 去同步与 `key={rig.id}` remount。
- 自动 oracle 命令固定为 `node scripts/harness-character-toy-p0.mjs`；输出 JSON 保留
  `clip/normalizedTime/landmark/workstationLocal/pass`，失败退出 1，不得只写人读日志。
- **go**：自动 oracle 全绿且三档真实 release 视图没有 blocker；继续 P1。**no-go**：先放宽到
  ~3 头身再重测，仍失败才建议新骨架；no-go 是唯一人工暂停闸。

## P1 contract freeze（2026-07-10）

P1 只完善 P0 已验证的单一 `body_toy.glb` lane；不得恢复旧 male/female body、眉毛资产、
`accentVariant` 或运行时 provider 分支。角色规范同步落到
`Docs/design/office-art-bible.md`，P4/P6 只能扩展对应章节，不能另起视觉 token。

### Appearance / silhouette contract

- `bodyType` 只缩放角色 wrapper 的 X/Z，固定 `slim=0.84`、`normal=1.00`、
  `stocky=1.18`；Y 与 `TARGET_HEIGHT_UNITS=1.62` 不变，避免体型改变座椅/桌面接触高度。
- `headShape` 固定三档 Head-bone scale：`round=[1,1,1]`、
  `soft-square=[1.10,0.94,0.98]`、`capsule=[0.90,1.12,0.94]`。头发、眼神贴片都挂在
  Head bone 下共享变换，不新增独立头部资产。
- 保留 6 档 direct-tint skin tone，Personnel 文案仅使用 `Tone 01`…`Tone 06` 与中性明暗描述；
  禁止族裔标签。`gender` 只保留为 persona/2D avatar 输入，不参与 3D body、眉毛或头型选择。
- `accentVariant` 从 renderer appearance 端态、序列化 payload 和 UI 全部删除；prelaunch 不加
  migration/fallback。既有 JSON 中多余 key 由宽松对象边界自然忽略。
- seed identity 的既有盐值保持不变；新增 head shape 使用独立 `headshape` 盐。角色岗位绝不进入
  skin tone seed、palette index 或 default appearance 解析路径。

### Face / hair / garment contract

- `body_toy.glb` 不再烘焙 `ToyEyeDots`；Head bone 下运行时创建四态无嘴眼神：
  `neutral|thinking→neutral`、`happy→happy`、`worried→worried`、`focus→focus`。
  blink 间隔由 employee phase 确定性分布到 2–6s，闭眼 120ms；`reducedMotion` 时不眨眼，
  但静态 expression 仍切换。
- 删除 `brows_01/02.glb` 及 URL/preload/manifest lane。6 个非 bald hairstyle 都必须映射到
  可见且经玩具头适配的 hair mesh；bald 不以眉毛作 hook placeholder。
- 4 套 garment 必须保持外层几何：blazer 有 lapel、shirt 有 placket、sweater 有 crewneck、
  dress 有独立 skirt；所有套装有骨骼跟随袖管，鞋底保持 body mesh 的大鞋轮廓。

### Role / prop contract

- 现有 dramaturgy `Prop` 五值全部可见且不改枚举：`laptop→prop_laptop`、
  `document→prop_clipboard`、`tablet→prop_tablet`、`terminal→prop_terminal`、
  `pointer→prop_pointer`。显式 performance prop 永远覆盖 role default。
- `props.glb` 新增 `prop_clipboard/tablet/terminal/pointer/headset/swatch/checklist/keycard`；
  岗位默认族为 Engineering→laptop、Design→swatch、Product/PM→clipboard、
  QA→checklist、Research→tablet、Operations→headset/keycard。未知岗位回落 clipboard，
  但岗位字符串不参与 appearance 采样。
- 每个角色都有胸前 `roleBadge` 几何；badge 色来自 art bible 的岗位辅助色，不取代衣服色，
  也不编码肤色。岗位默认道具只在 Personnel 预览或 working/active performance 时显示，
  避免 idle 办公室人人永久举物。

### Automated / live oracle

- `node scripts/harness-character-toy-p1.mjs` 验证 appearance 端态、三档 scale、体型差值、
  4 态眼神/blink/reduced-motion、6 发型、4 garment、role/skin 独立性、五值 prop 完整映射、
  glTF node、无 brows、license 与 25 MiB 预算；失败退出 1。
- P0 fixture-only `VITE_OFFICE_TOY_P0_DIAGNOSTIC` seam 在 P1 删除，正常 release 不含 sequencer。
- release `.app` 冷启动至少保留：Personnel 特写（头型/眼神/服装/岗位道具）与办公室多员工
  全景（体型、发型、衣服色与岗位识别）；日志中 WebGL/asset fatal pattern 必须为 0。

## Per-phase tasks

### P0 Spike（go/no-go，独立 stacked PR，产出可运行 spike、证据与结论）
- [x] 重建 raw 工作区：下载/校验完整五包；记录 UAL1/UAL2 Standard 全量 clip 清单 → P3 输入。
- [x] 玩具比例改造试验：骨骼比例重塑（头骨放大、四肢缩短）+ 胶囊 body mesh 皮到同骨架（程序化 glTF 路径）。
- [x] 19 clip 全播（含 sit.enter/exit、walk、carry、celebrate.dance）录屏，检查穿模/滑步/root 偏移。
- [x] 1 张按新度量重推的工位（desk/chair 高度改 `workstation-geometry.ts` 试验值）：坐下 → 手落桌面 → laptop 挂手可见。
- [x] release `.app` 冷启动截图（特写 + 办公室相机距离 + 远景），评审判据：不诡异、不穿帮、动画可接受。
- [x] 结论落盘（go / 放宽头身比 / 新骨架）到本文件 Delivered 区。

### P1 角色系统全量（A）
- [x] 接续 P0 已落地的单一 `body_toy.glb`（旧 male/female 已删除）：复核 `heightUnits` / TARGET_HEIGHT_UNITS 语义，完善 6 档 skin tone direct tint；不得恢复双 body 或旧纹理分流。
- [x] BODY_TYPE_GIRTH 重调（玩具体下 slim/normal/stocky 视觉差异要可读）。
- [x] headShape 三档（round/soft-square/capsule）：head 骨骼非均匀缩放实现 + appearance 字段 + AppearanceTab UI。
- [x] 眼神贴片机制：4 态 eye decal + 眨眼调度（per-phase 去同步、reduced-motion 门控）+ expression 接线。
- [x] 发型适配玩具头（6 hair mesh 重烘焙或缩放适配；brows 评估去留——玩具脸上眉毛可能并入眼神贴片）。
- [x] garments.ts 全量重调（4 outfit 部件比例、大鞋底）。
- [x] schema 演进：删 accentVariant（类型、resolveAppearance、AppearanceTab、garments 引用）；skin tone UI 改 tone 命名；gender 不再选 mesh。
- [x] 岗位配件：props.glb 扩展（clipboard/tablet/headset/swatch/checklist/keycard）+ PROP_ATTACH 补齐 + roleBadge 胸牌 + role→prop 默认映射；prop 枚举与 mesh 对齐（terminal/pointer 补齐或删值）。
- [x] role↔skinTone 独立性静态守卫。
- [x] LICENSES.md 更新；25MB 门禁复核。
- [x] release .app 验证：多员工多样性全景 + 岗位识别截图。

### P2 座位身份与移动（B）
- [x] `employeePlacements` 改身份稳定分座：renderer 按 company 持久化 `employee id → zone id + slot index`，首次分配按 employee id 排序取最低空 slot；roster 重排、增删、他人跨 zone 不重编号。seat catalog 固定为与当前 roster 人数无关的 16-slot 前缀稳定目录；只持久化 slot，不持久化 x/z，不改 Rust/core schema。
- [x] 换位走路编排：reassign / relocation 回家 / 新入座统一走 sit.exit → A* walk → sit.enter 流水（现有 posture promote 机制复用）。
- [x] 拖拽落点回退路径：非 zone 落点 → 走回原座（非瞬移）。
- [x] harness：分座稳定性守卫（初始 id 排序、增删/重排 roster、跨 zone 移动、存储 roundtrip/坏数据重置、2D/3D 单源 wiring，断言其余 slot 与坐标不变）；移动 wiring 守卫锁定 sit.exit → A* walk → sit.enter、drop-origin 回座和 repository-success-first zone reassign。
- [x] release .app 验证：拖人录屏（P-5 闭合证据）。

### P3 动作补全 + 状态机（C）
- [x] 按 P0 采集的 pack 全量清单决策：sit.type / approval.wait 挖现成 vs 程序化叠加合成（build script 内 additive track）。
- [x] rename 表 + CLIP_NAMES + CLIP_META 扩展；总量 ≤24。
- [x] WorkGesture 加 `approval-wait`（或等价）；performanceForBeat/performanceForActivity 映射更新；clip-map proxy 清理。
- [x] phone/consume 可达性预留接口（真正消费在 P5）。
- [x] harness-character-clip-map 计数/断言同步；全量 pnpm validate 相关子集复绿。
- [x] release .app 验证：打字 vs 交谈 vs 阅读对比截图（P-1 闭合证据）。

### P4 状态视觉语言（D）
- [x] 四态 overlay 体系实现：indicators.tsx + OfficeScene3D 状态叠加整合重绘（working/approval/blocked/selected），旧 CharacterAction 路径整合。
- [x] diegetic 编排：approval=approval.wait+clipboard、blocked=headshake+担忧眼、delivering=carry 向交付架。
- [x] workload 气泡/marker/chips/delivery shelf/flow lane 视觉重绘（语义不动）。
- [x] 2D ink 表与语义对齐（视觉重绘不做）。
- [x] release .app 验证：三态同屏截图 5 秒可辨（P-3/P-4 闭合证据）。

### P5 Ambient 生命感（E）
- [x] 契约冻结：45s–4min 是每名员工独立、seeded、与 roster 顺序无关的“到期/尝试”节奏，不承诺每次都物理离位（16 人 + 离位硬上限 2 + 30s 社交在数学上无法保证全员 4 分钟内离位）。首轮 45–120s 且优先 water/library/social，容量/锚点不足时确定性降级为原位 phone/坐姿微动作；不排队、不补发、不形成 catch-up burst。后续每次尝试 45–240s。
- [x] ambient 调度器：seeded 随机、45s–4min 频率、同屏离位 ≤2、目的地锚点（water-cooler/书架/邻座）、行为脚本（walk→consume/inspect.open/idle.talk→walk 回）。
- [x] run 抢占：活跃 beat 员工不参与；beat 到达 ≤1s 中断 ambient。
- [x] modes.ts 门控扩展（focus/reduced-motion 全关离位层）。
- [x] harness：seeded 重放守卫 + 抢占守卫。
- [x] release .app 验证：2 分钟录屏（P-2 闭合证据）。

### P6 Diorama 环境（F）
- [x] RoomShell 重做：删墙/玻璃隔断/墙面板，地台厚度+倒角，ZoneRug 升级，背景渐变+雾调参。
- [x] R1b 全量：workstation-geometry 常量从角色度量派生重推；obstacleRadius 表与座位锚点重调；SCENE_CONTENT_SCALE 跨包耦合补 guard。
- [x] props 密度 50–100：**批准实现偏离**——不新增 Kenney/KayKit 外部资产与 license surface，改为扩展既有 prefab/dressing 管线：33 个真实语义 prefab + 28 个同 art-bible 的 procedural low props，四组 InstancedMesh、共享材质、真实 prefab 数抑制，最终 61 active floor props。该实现满足密度/合批/视觉合同，且比新增外部资产更可重复。
- [x] 灯光/后处理随新材质校准；60fps **预算合同**复核：保留 `frameloop="always"`、DPR `[1,1.75]`、half-resolution AO、SMAA 与 instancing；Retina 窗口录屏在 capture overhead 下为 57.105fps 且无可见 stall/黑帧。此证据证明预算配置与 delivery surface 连续性，不宣称 direct GPU profiler 的 exact 60fps trace。
- [x] `Docs/design/office-art-bible.md` 落盘（比例/色板/bevel/饱和度/指示器规范）。
- [x] release .app 验证：全景 + 任意 orbit 角度无穿帮（「简陋」闭合证据）。

## Per-phase gate（每个出 diff 的 phase）

1. 实现（可并行处子代理分工，小 phase lead 直做）。
2. `/simplify` phase diff（lead 亲自）。
3. `codex exec` 直审清理后的 diff（勿用后台 codex-rescue——2026-07-04 验证不可靠）。
4. findings 对照 live 代码核实；确认的修，by-design 的写明理由拒。
5. 相关 `pnpm validate` 子集复绿（typecheck + character-clip-map/scene-cue/office-projection/scene-staging 等受影响 harness）；注意 `validate>log 2>&1` 无 trailing echo 退出码陷阱。
6. 用户可见/runtime phase：release `.app` 冷启动实证（`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`）——编译绿 ≠ 验证；3D 视觉必须真截图/录屏。

## Hard rules carried in

- Pi Agent 唯一 runtime，本 epic 纯表现层，不碰 wire/provider。
- 渲染改动全走 `apps/desktop/renderer` + `packages/shared-types` + `scripts/`；2D/3D 单源（scene-layout/staging/cue frame），禁 3D 侧 fork。
- Prelaunch：不写迁移；schema 改动走 schema.sql 端态 + bump `LOCAL_SCHEMA_VERSION`；旧库丢弃重建。
- 资产 25MB 门禁；新外部资产 CC0/明确可商用 + LICENSES.md。
- better-sqlite3 ABI 不匹配时 `pnpm rebuild`（2026-07-04 地雷）。
- Seafile 同步竞态可能注 NUL——大文件写后校验。
- 幻影窗挡截图：`killall NotificationCenter ProblemReporter`。

## Close-out（backlog 清空后）

- `dead-code-and-docs-cleanup-loop`：清死资产（旧 body_male/female、brows 若删、旧指示器路径）。
- `ui-ux-audit-loop`：确认 UI/UX 未漂移。
- 最终全量 `pnpm validate` + desktop release build + 六项最终验收截图（requirements 包末节）。

## Delivered

### P0 Spike — GO（2026-07-10）

- **branch / commit / PR**：`feat/office-toy-p0-spike` / `b48e85b1` / [#18](https://github.com/mike007jd/Offisim/pull/18)，stack base 为文档包 [#13](https://github.com/mike007jd/Offisim/pull/13)。
- **实现**：保留 Quaternius Universal 65-joint skeleton，程序化生成 2.472 头身 `body_toy.glb`；删除旧 `body_male.glb` / `body_female.glb` runtime lane；重烘焙 19 个 canonical non-root-motion clips；统一角色、椅面、桌面、坐姿与 held-laptop 度量。
- **自动 oracle**：`node scripts/harness-character-toy-p0.mjs` → 21/21；`pnpm harness:character-clip-map` → 12,960 states / 19 clips；同 raw 输入 clean build 两次 aggregate SHA-256 均为 `c62390f45b88dcf22b8c80b74b57a4cf633ce6da97086d5f373c6df7ad49f55a`；资产总量 1,734,710 bytes / 26,214,400 bytes。
- **全量门禁**：`pnpm validate` PASS；renderer typecheck/build PASS；Rust `cargo test` 149/149 PASS；diagnostic release `.app` build/sign PASS。
- **review**：三条并行 simplify lane 最终 PASS；独立 cold review 最终 PASS。确认并修复的 blocker/important：三角面反绕、textureless skin ratio tint 过曝、臀点只验 Y 未验椅垫平顶 X/Z；P0 diagnostic seam 明确留到 P1 删除。
- **release live**：当前 worktree 精确 `.app`，PID 33174，CGWindowNumber 137587。19 clips 全播视频 `Docs/evidence/2026-07-office-toy/p0/release-19-clips.mp4`；特写、正常办公室距离、最大距离截图及窗口/哈希记录见 `release-live-verification.json`。
- **结论**：**GO，继续 P1**。同骨架玩具体在自动接触、ground/root guards 与三档 release 视图均无 blocker；不放宽到 3 头身，不换骨架。发型、4 态眼神、garment 全量适配与岗位道具保持为 P1 正式 scope。

### P1 角色系统全量 — Delivered（2026-07-10）

- **branch / implementation commit / PR**：`feat/office-toy-p1-characters` / `b5e369bf` / [#21](https://github.com/mike007jd/Offisim/pull/21)，stack base 为 P0 [#18](https://github.com/mike007jd/Offisim/pull/18)。
- **实现**：单一玩具体端态；三档 XZ girth 与三档 head shape；4 态眼神 + 2–6s/120ms deterministic blink；6 发型、4 garment、role badge、五值 dramaturgy prop 与岗位默认道具；删 `accentVariant` / baked eyes / brows；gender 只进入 persona/2D avatar；palette 与自定义色 UI 单源；art bible 落盘。
- **自动 oracle**：`node scripts/harness-character-toy-p1.mjs` → 32/32（包含可执行 scale/blink/reduced-motion/prop precedence/garment oracle 与 production wiring guards）；P0 oracle 21/21；clip-map 12,960 states / 19 clips；资产目录、manifest byte、node/bone、license 与 25 MiB 预算 exact，当前总量 1,500,109 bytes。
- **全量门禁**：`pnpm validate` exit 0；renderer typecheck/build PASS；Rust `cargo test --locked` 149/149 PASS；当前 worktree release `.app` build/sign 与 `codesign --verify --deep --strict` PASS；GitNexus pre-commit change graph 为 medium，仅触达 Office/Personnel/asset-builder flows。
- **review**：三条 simplify lane 四轮收敛到 0 blocker / 0 important；独立 cold review 最终 PASS。确认并修复的重点包括 prop/attach/oracle false-green、hair head-envelope、palette/custom color 单源、gender 3D rig churn、reduced-motion 漏接、逐帧 visibility/geometry/material 重复和 GitNexus scope 污染。
- **release live**：精确 `.app` bundle SHA-256 `046e488e1ae2756c9fc2d6e5f181db922eff9e7663aaefa042beb7d73d3b3e02`，PID 90747，CGWindowNumber 138618。Computer Use 验证八员工全景、QA checklist、Designer swatch、Curly+Capsule+Stocky+Dress、gender 2D-only、Reset 无持久化；5,212 行 unified log 中产品 WebGL/asset/panic/uncaught/black-screen/renderer-crash pattern 为 0。截图、哈希和逐项记录见 `Docs/evidence/2026-07-office-toy/p1/release-live-verification.json`。
- **结论**：**P1 完成交付，继续 P2**。P0 diagnostic seam 已删；角色视觉、资源、schema、props 与验收 oracle 均收口，未引入 Pi/Rust runtime 改动。

### P2 座位身份与移动 — Delivered（2026-07-10）

- **branch / implementation commit / PR**：`feat/office-toy-p2-seating` / `046abf81` / [#24](https://github.com/mike007jd/Offisim/pull/24)，stack base 为 P1 [#21](https://github.com/mike007jd/Offisim/pull/21)。
- **实现**：renderer 按 company 持久化语义 `employeeId → zoneId + slot`，固定 16-slot roster-independent catalog，只由当前 layout 派生 x/z；roster 重排、增删、他人换 zone 与冷启动均不移动未受影响身份。单一 16 人 capacity 同时约束 repository、Personnel 与 external install。真实 roster/layout 未同时 ready 前不生成 synthetic placement。移动状态机覆盖原座 atomic `sit.exit`、A* walk、站/坐姿到达、新员工 zone-edge entry、非 zone drop-origin 回座、reduced-motion 中途 snap 与严格 pathfinder failure；zone reassign 只在 repository 成功后更新共享 cache。
- **自动 oracle**：`pnpm harness:office-seating-p2` → 32/32，覆盖 registry roundtrip/坏数据直接重置、增删/重排/跨 zone 稳定性、16 唯一 slot 与 17 人显式拒绝、可执行 movement phases、2D/3D 单源、pending company switch、post-success cache 与 repository capacity；P1 oracle 32/32、scene-staging 34/34、scene-cue 87/87、office-projection 50/50、dramaturgy-modes 16/16、clip-map 12,960 states / 19 clips 均复绿。
- **全量门禁**：`pnpm validate` exit 0；renderer typecheck/build PASS；Rust `cargo test --locked` 149/149 PASS；release `.app` build/sign 与 `codesign --verify --deep --strict` PASS。GitNexus staged change graph 为 medium，只触达 4 条 OfficeScene/OfficeStage process；未触达 Pi wire/provider/host/Rust command surface。既有 dead-code warning 仍仅 3 条：`hashString`、`selectionForClip`、`clipUsesSeatedOffset`。
- **review**：三条 simplify lane 与独立 cold review 最终均为 0 blocker / 0 important。确认并修复的重点包括 17+ 人共享 slot、pending/company-switch mass movement、mid-move reduced motion、有效拖拽从错误 origin 起步、atomic sit-exit 被 performance 切断、standing anchor 卡住、新员工瞬移、pathfinder no-route 错误直线 fallback，以及 optimistic cache/registry failure race。
- **release live**：精确当前 worktree `.app`，binary SHA-256 `d83c0b2d4f379f084f29a12f920314a552bf195409102cca3e627e3b91e02f85`，PID 84330，CGWindowNumber 138989。Computer Use 验证 Jamie Reeves Product → Rest → Product 的真实换区与两类到达姿态；Ryan Torres 非 zone drop 显示 `Drop on a zone` 并从 ghost 点走回不变原座；真实退出/冷启动后座位稳定。拖拽录屏、前/中/后截图、两份 app diagnostic JSON、测试数据恢复、签名/哈希与日志分类见 `Docs/evidence/2026-07-office-toy/p2/release-live-verification.json`；产品 panic/WebGL/asset/uncaught/black-screen/renderer-crash pattern 为 0。
- **结论**：**P2 完成交付，继续 P3**。身份稳定座位、动作化换位、非 zone 回走、跨会话稳定和 16 人上限均已由 oracle 与 release 真交互双证据闭合；测试改动的 Ryan/Jamie 最终均通过产品 UI 恢复为 `zone-product`。

### P3 动作补全 + 状态机 — Delivered（2026-07-10）

- **branch / implementation commit / PR**：`feat/office-toy-p3-actions` / `e3bd67c5` / [#25](https://github.com/mike007jd/Offisim/pull/25)，stack base 为 P2 [#24](https://github.com/mike007jd/Offisim/pull/24)。
- **实现**：保留 P0 的 19 个原 clip，并在 asset builder 内烘焙完整 `sit.type` / `approval.wait`，最终 canonical set 为 21 / 24；write/edit 映射真实坐姿打字，approval 映射 amber clipboard wait，permission failure 保持 red blocked；phone/consume 只留 P5 typed seam。独立 playback FSM 收口 atomic sit.exit/sit.enter、walk remount、rapid reversal、stale finish、single destination crossfade、bounded one-shot 与 reduced-motion semantic pose。
- **自动 oracle**：`pnpm harness:character-actions-p3` PASS，直接打开真实 GLB 验证 exact clip/manifest/CLIP_NAMES、track/quaternion/root、semantic pipeline、FSM、60 Hz 几何接触与 loop seam；clip-map 17,280 states / 21 clips，P1 32/32、P2 32/32 均复绿。相同 raw 输入 clean build 两次所有文件哈希一致，资产总量 1,531,846 / 26,214,400 bytes。
- **全量门禁**：`pnpm validate` exit 0；renderer typecheck/build PASS；Rust `cargo test --locked` 149/149 PASS；当前 worktree release `.app` build/sign 与 `codesign --verify --deep --strict` PASS；GitNexus staged graph 为 low risk，无异常 execution-flow fan-out。既有 dead-code warning 仅 `hashString`、`clipUsesSeatedOffset`。
- **review**：独立 cold review 最终 0 blocker / 0 important / 0 minor；runtime simplify 确认并修复 3 important + 4 minor，asset simplify 最终 0 blocker / 0 important。重点闭合 entry/drop standing mount、walk remount down-sink、sit.exit 双 crossfade、stale finish/race、rapid reversal、celebration/headshake 错误循环与 approval/blocked 语义混淆。
- **release live**：精确当前 worktree `.app`，binary SHA-256 `00ac7129823f3206d4ef91a6aecd79d15b5ef6c13d505ccdc34a27496727ac6a`，PID 12973，CGWindowNumber 238。Computer Use 冷启动后真实 Pi `openrouter/free` run 完成 read/write；talking、read、type 三态截图可辨；真实 Ask-mode `rm -rf` 进入 `awaiting-approval`，Reject 后命令未执行，并与外部 provider 429 的 red blocked 截图明确分离。21,382 行 unified log 中产品 panic/WebGL/asset/uncaught/black-screen/renderer-crash pattern 为 0；证据见 `Docs/evidence/2026-07-office-toy/p3/release-live-verification.json`。
- **资产基线修正**：保留 `props.glb` 与 manifest head-radius/byte-ledger 修正；P1/P2 committed bytes 无法由最终 builder + exact frozen raw 重现，恢复旧 bytes 会让 clean full build 再次变脏，当前输出才是 deterministic builder truth。
- **结论**：**P3 完成交付，继续 P4**。动作资产、语义映射、播放状态机、approval/blocked 分流、自动 oracle、独立 review 与 release 真交互均闭合；未修改 Pi wire/provider/host/Rust command surface。

### P4 状态视觉语言 — Delivered（2026-07-10）

- **branch / implementation commit / PR**：`feat/office-toy-p4-visual-language` / `a10f0b25` / [#26](https://github.com/mike007jd/Offisim/pull/26)，stack base 为 P3 [#25](https://github.com/mike007jd/Offisim/pull/25)。
- **实现**：共享 frame 只保留 `idle / working / approval / blocked` 四态，优先级固定为 blocked > approval > working > idle，selected 正交叠加；旧 `CharacterAction` / `ActionHalo` / legacy performance lane 删除。单一指示器词汇使用 exact art-bible ink、typed `T/B/P/C/R/X` 去重、slate warning 与显式 blocked 人名牌。approval 继续 `approval.wait + clipboard`，blocked 继续 worried + headshake；artifact beat 走真实 carry/handoff + document 到物理 delivery shelf，唯一真实 anchor 才拥有 delivering。2D 只消费同一 status/ink，不重做画面。
- **自动 oracle**：`pnpm harness:office-visual-language-p4` → 50/50，覆盖四态同帧、状态优先级、selection 正交、指示器唯一所有权、reduced-motion、typed marker、真实交付架/唯一 anchor、employee-less delegated artifact 归属、static flow packet 与旧 lane 不回流；scene-cue 87/87、office-projection 50/50、P3 character-actions 均复绿。
- **全量门禁**：`pnpm validate` exit 0；renderer typecheck/build PASS；Rust `cargo test --locked` 149/149 PASS（P4 无 Rust 改动）；当前 worktree release `.app` build/sign 与 `codesign --verify --deep --strict` PASS。GitNexus change graph 为预期 HIGH：共享 projection、OfficeScene2D/3D 与角色渲染主路径共 9 条已知场景流程；无 Pi wire/provider/host/Rust command surface 扩散。既有 dead-code warning 仅 `hashString`、`clipUsesSeatedOffset`。
- **review**：三条独立 code/simplify review 最终均 PASS。首轮 5 秒盲审确认 working/approval 但指出 blocked 人物归属含糊；修复为 `Alex C. · BLOCKED`、去除重复 failure flow 文案并重做 release 后，最终盲审四项全 PASS：三态人物对应、blocked 归属、amber/red 区分、无 selected 冷蓝外圈。
- **release live**：精确当前 worktree `.app`，binary SHA-256 `ae2bf3d965851384609a5544cad2fb5051551b3b7c1437c1303f7682cd83a800`，PID 75434，CGWindowNumber 744，1440×884。Computer Use 冷启动后用真实 Pi `openrouter/free` 同屏形成 Alex blocked、Maya approval、Marcus working，返回会话列表并最大化 stage 后截图；证据 SHA-256 `c5525a2e2b44569e66d0614b7ede7ed15eba5b4508b425b437c628fb60d802b`。最终所有测试 run 清到 8 人 IDLE、无 pending approval/active control；逐项记录见 `Docs/evidence/2026-07-office-toy/p4/release-live-verification.json`。
- **结论**：**P4 完成交付，继续 P5**。状态语言、diegetic 证据、typed resource、交付架、2D 语义同源、自动 oracle、独立 review 与 release 真交互均闭合；未修改 Pi/Rust runtime surface。

### P5 Ambient 生命感 — Delivered（2026-07-11）

- **branch / implementation commit / PR**：`feat/office-toy-p5-ambient-life` / `72688738` / [#27](https://github.com/mike007jd/Offisim/pull/27)，stack base 为 P4 [#26](https://github.com/mike007jd/Offisim/pull/26)。
- **实现**：renderer 内单一 deterministic ambient scheduler；每员工 seed 与 roster 顺序解耦，首轮 45–120s、后续 45–240s，不排队/补发/catch-up。refreshment/library/social/phone/seated-shift 五类行为走真实 clip 与 A*；office 同屏最多 2 人离位、4 人 active，fixture reservation、可达 fallback、route revision 与 floor bounds 均为硬约束。run、drag、fixture、surface、focus、reduced-motion 都能抢占或清理 ambient。
- **自动 oracle**：`pnpm harness:office-ambient-p5` → 66/66；P2 seating 32/32、scene-staging 34/34、scene-cue 87/87、P4 visual-language 50/50、clip-map 17,280 states / 21 clips 均复绿。
- **全量门禁**：`pnpm validate` exit 0；renderer typecheck/build、UI framework hygiene、当前 worktree release `.app` build/sign 与 `codesign --verify --deep --strict` PASS。GitNexus 为预期 HIGH：15 条共享 Office scene process，均由受影响 harness 与 release live 覆盖；未触达 Pi wire/provider/host/Rust command surface。
- **review**：独立 cold review 与 simplify review 最终均 PASS、0 confirmed finding。确认修复 catch-up burst、fixture double-book、multi-owner busy、surface switch、preemption blank frame、chair/obstacle target、route revision/floor bounds 以及 outside-start drag-return 回归。
- **release live**：精确 `.app` binary SHA-256 `4c28303ab759bf71a694746caf7f564562edbf681a2701b94205be39db7a4cfd`，PID 69224，CGWindowNumber 1133。125.133 秒无加速录屏跨 5/30/60/90/120 秒抽检完整，观察 Marcus/Maya 离位并回归；对同一视频 00:00–00:18 每 2 秒解码复核，Product 红衣坐姿角色的头、躯干和手部持续微动而座椅锚点不变。Focus 55.133 秒验证 active 收尾后不再新离位；真实 Pi `openrouter/free` run 形成 Marcus working 抢占并返回 `OK`。5,396 行 unified log 中产品 fatal/WebGL/asset/uncaught/black-screen/renderer-crash pattern 为 0；完整哈希与证据见 `Docs/evidence/2026-07-office-toy/p5/release-live-verification.json`。
- **结论**：**P5 完成交付，继续 P6**。P-2 由 deterministic oracle、两分钟真实观察、mode quiet 与真实 run scene ownership 双证据闭合。

### P6 开放式 Diorama 环境 — Delivered（2026-07-11）

- **branch / implementation commits / PR**：`feat/office-toy-p6-open-diorama` / `d63cfb54` + cleanup `5a117306` + annotation fix `afc08cd7` / [#28](https://github.com/mike007jd/Offisim/pull/28)，stack base 为 P5 [#27](https://github.com/mike007jd/Offisim/pull/27)。
- **实现**：旧三面墙、玻璃隔断与墙板生产路径删除，替换为有厚度/倒角的开放展示地台、严格分层 floor/bands/grid、薄圆角 ZoneRug 和随 camera 平移的封闭渐变 studio backdrop。工位尺寸从玩具角色度量派生，非工位障碍改读共享 prefab footprint；canonical 33 个语义 prefab + 28 个低装饰组成 61 个 active floor props，装饰由单一 slot template 生成、按真实 prefab 数抑制并以 4 组 InstancedMesh 渲染。灯光、雾、half-resolution AO、SMAA、DPR 与显式 continuous frameloop 同步校准；Office/Studio annotation 统一为 camera-safe primitive，由每 Canvas 一个 bounded scheduler 做 depth-tested/self-excluding occlusion、hidden/inert ownership 与语义 z-index 分层；art bible 环境合同落盘。
- **自动 oracle**：`pnpm harness:office-diorama-p6` → 58/58、61 floor props；P5 ambient 66/66、P2 seating 32/32、P4 visual-language 50/50、scene-cue 87/87 与 P3 actions 均复绿。oracle 包含无墙/玻璃 production source、精确 bevel envelope、无 coplanar z-fighting、camera-follow backdrop、100 prop hard cap、共享 navigation footprint、camera-safe annotation scheduler、工位不重叠/地台包含、后处理与 art-bible 守卫。
- **全量门禁**：`pnpm validate` exit 0；renderer typecheck/build、`pnpm check:deadcode`（0 findings）、UI framework hygiene、UI/UX drift、当前 worktree release `.app` build/sign 与 `codesign --verify --deep --strict` PASS。GitNexus staged graph 为预期 HIGH，集中在 OfficeScene3D/OfficeStage/OfficeSurface 与 Studio annotation 消费面；未触达 Pi wire/provider/host/Rust command surface。
- **review**：三条 simplify lane 与独立 cold review 最终均 PASS，0 blocker / 0 important / 0 minor。确认修复薄圆角几何 envelope、地台/地毯层级 z-fighting、自由平移离开有限背景、renderer-only obstacle 半径、custom layout prop overflow、透明地毯 overdraw、foliage token、fastener/shadow 绘制、obsolete exports，以及 label 穿 rack/被遮挡仍可点击/逐 label raycast 问题。
- **release live**：精确 `.app` binary SHA-256 `a94f06cf041bf2e18b52906b2710447c7f8b60ab5075647c26e82cc0f6947652`、bundle aggregate SHA-256 `7ff3604994a550483936b2fb79a9095a5e470e0dc4bbda656ed64b0b751422e6`，PID 70671，CGWindowNumber 1575。Computer Use 冷启动后默认全景与低角 orbit 均无围墙/纸片/黑洞/层级闪烁；15.015 秒真实 orbit 录屏 858 帧、平均 capture 57.105fps，均匀抽帧完整且无可见 hitch/黑帧。3,430 行 unified log 中产品 fatal/WebGL/asset/uncaught/black-screen/renderer-crash pattern 为 0；唯一 launchservices WebContent CRASHSTRING 经持续存活与全程交互归类为 macOS service warning。证据见 `Docs/evidence/2026-07-office-toy/p6/release-live-verification.json`。
- **结论**：**P6 完成交付，进入 Epic close-out**。开放玩具办公沙盘、R1b 家具/导航耦合、50–100 props 密度、性能预算配置与无可见 hitch 的 delivery-surface 证据、art bible、独立 review 与 release 真交互均闭合；不把 57.105fps capture 写成 exact 60fps GPU trace。

### Epic Close-out — Delivered（2026-07-11）

- **最终六项验收**：P1 玩具角色特写/全景、P3 type/talk/read 三态、P5 125.133 秒离位 + 00:00–00:18 坐姿微动、P4 working/approval/blocked 同屏、P2 58.667 秒 Maya Development → Art & Design `drag → walk → sit.enter` 且其余座位不动、P6 默认/低角开放地台与 15.015 秒 orbit，全部逐项 PASS；哈希、时序和映射见 `Docs/evidence/2026-07-office-toy/epic-closeout.json`。
- **cleanup / audit**：`dead-code-and-docs-cleanup-loop` 删除 old body/brows/P0 seam/legacy walls-glass/old indicators/obsolete exports；`pnpm check:deadcode` 最终 0 findings。`ui-ux-audit-loop` 的 framework hygiene 与 UI/UX drift 均 PASS。`Body_Skin_Dark` / `SkinDark` / `skinReference` 因 P0 light+dark 资产与 regeneration contract 仍真实耦合而保留，不冒充 dead code 删除。
- **stack / external CI**：#13/#18/#21/#24/#25/#26/#27/#28 均 OPEN、MERGEABLE，线性 base 正确；未 merge、未碰 main。GitHub Actions 两个 job 均 0 step，annotation 明确为账户付款/支出上限导致未启动，归类 external billing block，不冒充代码测试失败；本地完整门禁与 release 证据均已闭合。
- **结论**：**backlog、confirmed findings 与 required evidence 均为 0**；Epic 在允许 scope 内完整交付。
