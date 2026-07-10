# Office Toy Performance — Execution Plan (verified-iteration-loop)

Companion to `2026-07-09-office-toy-performance-requirements.md`（specs）与
`plan-office-toy-performance-overhaul.md`（决策记录）。依赖排序的实现 backlog，
基于 2026-07-09 深读事实清单（file:line 证据）。每 phase 收口走
`/simplify`（lead 亲自）+ `codex exec` 直审 + findings verify/fix + 门禁复绿
（用户 2026-07-02 gate 指示；禁 token 巨贵的 code-review workflow）。

分支拓扑：`docs/office-toy-performance-package` → `feat/office-toy-p0-spike` →
`feat/office-toy-p1-characters` → … → `feat/office-toy-p6-diorama`，每个 phase 一个线性
stacked PR；只 push / 开 PR，不合并、不改 `main`。Checked at 2026-07-10。

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
- [ ] 接续 P0 已落地的单一 `body_toy.glb`（旧 male/female 已删除）：复核 `heightUnits` / TARGET_HEIGHT_UNITS 语义，完善 6 档 skin tone direct tint；不得恢复双 body 或旧纹理分流。
- [ ] BODY_TYPE_GIRTH 重调（玩具体下 slim/normal/stocky 视觉差异要可读）。
- [ ] headShape 三档（round/soft-square/capsule）：head 骨骼非均匀缩放实现 + appearance 字段 + AppearanceTab UI。
- [ ] 眼神贴片机制：4 态 eye decal + 眨眼调度（per-phase 去同步、reduced-motion 门控）+ expression 接线。
- [ ] 发型适配玩具头（6 hair mesh 重烘焙或缩放适配；brows 评估去留——玩具脸上眉毛可能并入眼神贴片）。
- [ ] garments.ts 全量重调（4 outfit 部件比例、大鞋底）。
- [ ] schema 演进：删 accentVariant（类型、resolveAppearance、AppearanceTab、garments 引用）；skin tone UI 改 tone 命名；gender 不再选 mesh。
- [ ] 岗位配件：props.glb 扩展（clipboard/tablet/headset/swatch/checklist/keycard）+ PROP_ATTACH 补齐 + roleBadge 胸牌 + role→prop 默认映射；prop 枚举与 mesh 对齐（terminal/pointer 补齐或删值）。
- [ ] role↔skinTone 独立性静态守卫。
- [ ] LICENSES.md 更新；25MB 门禁复核。
- [ ] release .app 验证：多员工多样性全景 + 岗位识别截图。

### P2 座位身份与移动（B）
- [ ] `employeePlacements` 改身份稳定分座（zone 内按 employee id 排序绑 seat slot；评估是否需要显式 seat 字段——需要则走 prelaunch schema 三步）。
- [ ] 换位走路编排：reassign / relocation 回家 / 新入座统一走 sit.exit → A* walk → sit.enter 流水（现有 posture promote 机制复用）。
- [ ] 拖拽落点回退路径：非 zone 落点 → 走回原座（非瞬移）。
- [ ] harness：分座稳定性守卫（增删/重排 roster、跨 zone 移动，断言其余座位不变）。
- [ ] release .app 验证：拖人录屏（P-5 闭合证据）。

### P3 动作补全 + 状态机（C）
- [ ] 按 P0 采集的 pack 全量清单决策：sit.type / approval.wait 挖现成 vs 程序化叠加合成（build script 内 additive track）。
- [ ] rename 表 + CLIP_NAMES + CLIP_META 扩展；总量 ≤24。
- [ ] WorkGesture 加 `approval-wait`（或等价）；performanceForBeat/performanceForActivity 映射更新；clip-map proxy 清理。
- [ ] phone/consume 可达性预留接口（真正消费在 P5）。
- [ ] harness-character-clip-map 计数/断言同步；全量 pnpm validate 相关子集复绿。
- [ ] release .app 验证：打字 vs 交谈 vs 阅读对比截图（P-1 闭合证据）。

### P4 状态视觉语言（D）
- [ ] 四态 overlay 体系实现：indicators.tsx + OfficeScene3D 状态叠加整合重绘（working/approval/blocked/selected），旧 CharacterAction 路径整合。
- [ ] diegetic 编排：approval=approval.wait+clipboard、blocked=headshake+担忧眼、delivering=carry 向交付架。
- [ ] workload 气泡/marker/chips/delivery shelf/flow lane 视觉重绘（语义不动）。
- [ ] 2D ink 表与语义对齐（视觉重绘不做）。
- [ ] release .app 验证：三态同屏截图 5 秒可辨（P-3/P-4 闭合证据）。

### P5 Ambient 生命感（E）
- [ ] ambient 调度器：seeded 随机、45s–4min 频率、同屏离位 ≤2、目的地锚点（water-cooler/书架/邻座）、行为脚本（walk→consume/inspect.open/idle.talk→walk 回）。
- [ ] run 抢占：活跃 beat 员工不参与；beat 到达 ≤1s 中断 ambient。
- [ ] modes.ts 门控扩展（focus/reduced-motion 全关离位层）。
- [ ] harness：seeded 重放守卫 + 抢占守卫。
- [ ] release .app 验证：2 分钟录屏（P-2 闭合证据）。

### P6 Diorama 环境（F）
- [ ] RoomShell 重做：删墙/玻璃隔断/墙面板，地台厚度+倒角，ZoneRug 升级，背景渐变+雾调参。
- [ ] R1b 全量：workstation-geometry 常量从角色度量派生重推；obstacleRadius 表与座位锚点重调；SCENE_CONTENT_SCALE 跨包耦合补 guard。
- [ ] props 密度 50–100：Kenney/KayKit 管线扩展 + 高重复家具评估 InstancedMesh + 合批。
- [ ] 灯光/后处理随新材质校准；60fps 预算复核（必要时 dpr/AO 降档策略）。
- [ ] `Docs/design/office-art-bible.md` 落盘（比例/色板/bevel/饱和度/指示器规范）。
- [ ] release .app 验证：全景 + 任意 orbit 角度无穿帮（「简陋」闭合证据）。

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
