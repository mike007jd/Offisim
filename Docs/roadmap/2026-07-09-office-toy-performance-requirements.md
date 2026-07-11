# Office Toy Performance — Requirements Package

## Current Time Baseline
- Checked at: 2026-07-09.
- Purpose: 把 2026-07-09 grill-me 会话拍板的 Office 表现层大改（决策记录：`plan-office-toy-performance-overhaul.md`）落成可执行需求包。
- Status: requirements only。执行顺序、任务拆分、门禁在 companion `2026-07-09-office-toy-performance-execution-plan.md`。
- Supersedes: GPT 5.5 Pro 原始建议中的 tower/城市/多楼层部分（明确不做本轮）；现有半写实人形角色方向。

## Product Decision

Offisim 的 3D office 必须从「半写实人形占位资产 + 静态座位棋盘」变成「玩具感办公沙盘」：低多边形玩具胶囊小人在开放式地台上真实地工作、移动、等待、交付，状态一眼可读，办公室活着但不喧闹。

已拍板方向（不复议）：
- 角色 = 玩具感胶囊小人（2.2–2.6 头身，头大身短、四肢圆短、大鞋底）。
- 生产路径 = 同骨架换体、免费优先（保 Quaternius Universal 骨架 + 19 clip 动画库 + 程序化 garment + 构建管线）。升级阶梯：①同骨架重塑 → ②放宽至 ~3 头身 → ③新骨架+全库重定向（最后手段）。
- 脸 = 点眼无嘴 + 眼神贴片表情 + 周期眨眼。
- 空间 = 拆围墙，开放式玩具地台 diorama（为将来堆叠成 tower 留路）。
- 活跃度 = 中档低频微行为；真实 run 永远抢占 ambient。
- 家具尺寸与角色度量强耦合（R1b）：桌椅高度从角色身体尺寸派生，不同步即穿帮。

## 用户点名痛点（验收必须逐条闭合）

1. **P-1 演得不像真在工作**：坐姿打字用聊天动作顶替（`clip-map.ts:9-24` 记录的 proxy），状态切换生硬。
2. **P-2 没有生命感**：无任何 ambient 行为系统（已核实：员工唯一离位来自 dramaturgy beat relocation），idle 像雕像馆。
3. **P-3 状态可读性差**：扫一眼看不出谁在干嘛/谁卡住/谁在等审批。
4. **P-4 视觉元素杂乱廉价**：现有环/气泡/标记不成体系。
5. **P-5 座位补位怪相**：`scene-layout.ts:581-583` 按 roster 数组索引分座，座位与员工身份无绑定；拖走一人全体前移，有人"飘过来补位"。

## Current Source References（代码事实基线，2026-07-09 核实）

- 角色渲染：`GltfCharacter.tsx`（TARGET_HEIGHT_UNITS=1.62 :113；BODY_TYPE_GIRTH slim0.9/normal1/stocky1.13 :139-144；坐姿偏移 SEATED_BODY_LIFT/FORWARD :130-133；prop 挂手表 PROP_ATTACH 只有 laptop→hand_l、book→hand_r :161-175）。
- 动作：19 clip（`clip-map.ts:27-47`），来源 Quaternius UAL1（12 clip rename 表 `build-character-assets.mjs:126-139`）+ UAL2（7 clip :140-148）。**raw pack 未入库**（需 `CHARACTER_ASSETS_RAW_DIR`，:73-107），UAL 全量 clip 清单未核对——开工时重下核对，勿凭记忆。
- 表现状态：`CharacterPerformanceState`（`packages/shared-types/src/dramaturgy/performance.ts:31-39`）= locomotion×posture×workGesture(9)×socialGesture(4)×expression(5)×prop(5?)×intensity(3)；**无 status 字段**，指示器由旧 `CharacterAction` enum（`indicators.tsx:15`）+ workload cue 驱动。
- 关键既存事实（写 spec 时已消化）：
  - `expression` 只影响 clip 选择，**不改脸**（无 morph target，`GltfCharacter.tsx:67-69`）——眼神贴片是全新机制。
  - `phone`/`consume` clip 已打包但从 performance state **不可达**（`clip-map.ts:20-22`）。
  - `prop` 枚举 5 值，`terminal`/`pointer` 无任何手持 mesh（视觉不显示）。
  - `accentVariant`（vest/jacket/scarf）data-only 无几何（`GltfCharacter.tsx:66-68`）。
  - 拖拽只持久化 zone 归属（`queries.ts:268-278` → `workstation_id`），精确坐标只进 diagnostic。
  - `IDLE_PERFORMANCE` 默认 posture=`sit`（`performance.ts:42-49`）。
  - 无 GPU instancing；LOD 仅 ServerRack；`frameloop="always"` 是刻意的（mixer/glide 依赖 useFrame）。
  - `SCENE_CONTENT_SCALE=1.18` 与 `system-zone-prefab-layout.ts` 跨包耦合且无 guard（`scene-art-direction.ts:38-43`）。
  - 2D 场景与 3D 共享 `scene-layout` / staging inputs / SceneCueFrame，角色为 canvas 手绘双圆盘（`OfficeScene2D.tsx:706-716`）。
  - `animationTempoForRole`（role→动画速度）与 per-employee `phase` 去同步机制已存在，须保留。

---

## Requirement Group A: 玩具胶囊角色系统

### A1. 玩具比例 body（同骨架换体）
新 body mesh 皮到现有 Quaternius Universal 骨架（保留骨骼层级与命名），比例重塑为 2.2–2.6 头身：头大、躯干短、四肢圆短、手为圆手（mitten 级简化可接受）、大鞋底。**单一 neutral 玩具体取代 male/female 双 body**——性别不再选 mesh；silhouette 多样性由 bodyType girth（保留 slim/normal/stocky）+ headShape 承担。低纹理依赖：色块 + AO + bevel 质感，材质延续现有 tint 管线（skin/top/bottom multiply tint）。

Acceptance:
- 全部现有 clip（19 个 + 新增）在新 body 上播放无肢体穿模、无脚部滑移到不可接受程度（release .app 观察）。
- 坐进按新度量调好的工位后：手落在桌面区、laptop 在手、臀在椅面（P0 spike 的 go/no-go 判据）。
- 单角色资产体积不高于现状同级（25MB 总门禁不破，`build-character-assets.mjs:109`）。
- 远景（相机 maxDistance）下轮廓可读：能分辨体型、发型、外套颜色。

### A2. 脸部：点眼无嘴 + 眼神贴片 + 眨眼
基础脸 = 两个点眼、无嘴。新增眼神贴片机制（贴图 swap 或 decal plane，不做面部骨骼/morph）：普通圆点 / 开心弯弧 / 担忧斜眼 / 专注眯眼，共 4 态；随 `expression`（happy→开心、worried→担忧、focus→专注、neutral|thinking→普通）切换。周期性眨眼（随机 2–6s 间隔，闭眼 100–150ms），reduced motion 下禁用眨眼、表情静态切换。

Acceptance:
- 员工进入 failure beat（worried）与 celebrate（happy）时，办公室相机距离下能看出眼神变化。
- 眨眼不同步（沿用 per-employee `phase` 去同步）。
- `prefers-reduced-motion` 下无眨眼动画，表情仍正确。

### A3. 外观 schema 演进
`EmployeeAppearance`（`avatar.ts:17-29`）调整：
- `skinColor` 语义不变，但 UI 呈现改为 tone-01…06 中性命名（Warm light / Fair warm / Tan / Brown / Deep / Warm orange 类描述性文案），**禁族裔标签**；6 个 hex（`SKIN_TONES`，avatar.ts:64）可随新美术微调但保持 6 档自然色。
- `gender` 保留字段但不再选 body mesh（单一玩具体）；只影响发型默认倾向与 DiceBear 2D 头像。
- 新增 `headShape: 'round' | 'soft-square' | 'capsule'`——由 head 骨骼/mesh 非均匀缩放实现，不做独立头部资产。
- `accentVariant`（vest/jacket/scarf）**删除**：data-only 无几何的死字段，prelaunch 直接清（含 AppearanceTab UI 与 resolveAppearance）。
- 强约束沿用：skin tone 只属于 appearance；role/能力/性格与 skin tone 独立采样；新增静态守卫断言 role→skinTone 无固定映射。

Acceptance:
- Personnel AppearanceTab 能编辑新字段集，无预填臆测默认值。
- 同一 seed 的既有员工重新解析后外观稳定（hash 派生路径不变）。
- prelaunch 原则：不写 appearance 迁移，旧库照常丢弃重建。

### A4. 衣服几何适配玩具体
`garments.ts` 的程序化服装（blazer/shirt/sweater/dress 四套，骨骼刚性 attach）按新 body 度量重调：torso shell、袖、领、lapel、placket、下装比例全部随玩具体重推。衣服必须读作"外层几何"而非贴身换色（现有正确方向强化）：blazer 有 lapel、shirt 有领+placket、sweater 有厚度、dress/裙有独立轮廓。鞋加大（玩具比例的大鞋底属于 body 或独立 shoe 几何，方向可读）。

Acceptance:
- 4 套 outfit 在全部动作（含 sit.enter/exit、walk、carry）下无严重穿插。
- 远景能凭轮廓区分 blazer vs sweater vs dress。

### A5. 岗位配件与工牌
岗位识别靠配件+工牌+工位道具，不靠肤色/性别/体型。props.glb 扩展：clipboard、tablet（独立于 book）、headset、色板 swatch、checklist/放大镜、keycard/server tag；胸前 roleBadge（小色块工牌，role→badge 图形/色）。`prop` 枚举与挂手 mesh 对齐：`terminal`/`pointer` 或补真实 mesh 或从枚举收敛——不允许"有枚举无视觉"的静默缺失。岗位映射：Dev=laptop、Designer=swatch/tablet、PM=clipboard、QA=checklist、Researcher=book/document、Ops=headset/keycard。

Acceptance:
- 选中任一员工，不看侧栏也能从配件+工牌判断岗位类别。
- 每个 `prop` 枚举值都有可见挂手表现（或该值已被删除）。
- harness：clip-map 状态空间守卫随 prop 维度变化同步更新。

## Requirement Group B: 座位身份与移动

### B1. 座位绑定员工身份（修 P-5 根因）
座位分配从「roster 数组顺序 × seats[index]」（`scene-layout.ts:581-583`）改为**身份稳定分配**：同 zone 内按 employee id 稳定排序（或显式 seat slot 字段）映射座位；roster 增删/重排/他人换 zone 不得改变其余员工的座位。座位归属跨会话稳定（同一 zone 成员集合不变则座位不变）。

Acceptance:
- 拖走员工 A 到别的 zone，B/C/D 的座位纹丝不动——不再有任何"补位"。
- 新员工入职坐进空位，不挤动老员工。
- 2D 与 3D 座位一致（共享 `employeePlacements` 单源）。

### B2. 换位必须走路
任何座位变化（拖拽 reassign、dramaturgy relocation 回家、新分配）员工用现有 A* 寻路走过去（`scene-pathfinding.ts`），不瞬移、不漂移。glide fallback 仅保留为 pathfinder 缺失时的兜底。走路期间 locomotion=walk（带 carry 判定），到位后播 sit.enter 入座。

Acceptance:
- 拖拽落到新 zone 后：员工从原位起身（sit.exit）→ 走路绕过家具 → 到新座位 → sit.enter 坐下，全程可观察。
- reduced motion 下允许直接切换（沿用 modes.ts 门控语义）。

### B3. 拖拽语义收敛
拖拽=改 zone 归属（现有 `reassign` → `workstation_id` 持久化保留），落点必须在 zone 上才生效（现有行为保留）；不做精确手摆坐标持久化（超出本轮）。拖拽中 ghost、hover zone rug 高亮等现有反馈保留并随新 art bible 重绘。

Acceptance:
- 拖到非 zone 区域：员工回原座位（走回去，不瞬移），提示保留。

## Requirement Group C: 动作补全与状态机精修

### C1. 新增核心 clip
- `sit.type`（P0）：坐姿键盘动作，替换 `sit.talk` 打字 proxy。
- `approval.wait`（P0）：等待审批专用姿态（如 clipboard 抱持/抬手示意），amber 状态专属。
- 优先从 UAL1/UAL2 raw pack 未导入 clip 中挖（重下 pack 核对全量清单——rename 表只导入了 19 个，pack 里有更多）；没有现成的用程序化姿态叠加（sit.idle 基座 + 手臂前伸/手部起伏 additive track，在 build script 内合成）。总 clip 控制在 ~24 内。

Acceptance:
- 员工执行 write/edit 类 activity 时播 `sit.type`，与 `sit.talk`（真交谈）视觉可区分。
- 等审批员工播 `approval.wait` + amber 指示，与 blocked（红 + headshake）不混淆。

### C2. proxy 清理与可达性补齐
- seated `type/note/annotate` → `sit.type`（删 proxy）。
- `phone`/`consume` 接入可达路径：ambient 层（Group E）作为微行为消费（茶水间喝水=consume、接电话=phone）。
- `WorkGesture` 枚举扩展（如 `approval-wait`）与 `performanceForBeat`/`performanceForActivity` 映射更新；`clipForPerformance` 保持 deterministic + total。

Acceptance:
- `clip-map.ts` 头部 proxy 注释块清空或只剩明确接受的长期代理。
- harness-character-clip-map 状态空间计数随枚举变化更新，全状态有定义。
- 打包 clip 无不可达死资产（每个 clip 至少一条真实触发路径）。

### C3. 状态过渡平滑
姿态转换（sit.enter/exit promote 机制保留）、crossfade 时长按新动作调优；celebrate 短促克制（≤2.5s 回归工作态）；blocked/approval 姿态明确但不循环夸张。

Acceptance:
- 连续状态切换（working→approval→working→delivering）无 T-pose 闪帧、无动作跳变。

## Requirement Group D: 状态视觉语言重做（修 P-3/P-4）

### D1. Overlay 收敛为四态体系
地面/头顶 overlay 收敛：working（轻蓝/绿 halo + typing dots）、approval（amber，恒 amber 绝不用红——现有 PRD 规则保留）、blocked（红 marker + 姿态）、selected（高亮 ring + 名牌）。idle 仅低对比 base disc。旧 `CharacterAction` enum 驱动的指示器与 workload cue 整合成一套视觉体系，删冗余层。

### D2. Diegetic 优先
状态首先由动作+道具+眼神表达（approval=专用姿态+clipboard、blocked=headshake+担忧眼、delivering=carry 走向交付架），overlay 是第二层确认而非唯一信号。

### D3. workload/交付/流向随 art bible 重绘
workload ×N 气泡、resource marker（六类 glyph）、chip 行、delivery shelf、flow lane 语义全部保留，视觉按玩具 diorama 风格统一重绘（圆角、低饱和、统一 bevel 语言）。

### D4. 2D 场景语义同步
2D 只吃共享源修复（座位、状态语义、ink 表对齐），视觉重绘不在本轮。

Acceptance（Group D 整体）:
- 5 秒扫视测试：不点选任何人，能指出谁在工作、谁在等审批、谁被阻塞（三态截图对比可辨）。
- amber 与红永不混用；同屏出现 approval+blocked 时可区分。
- 指示器风格与角色/环境同属一个设计体系（不再是"贴在模型上的 UI 碎片"）。

## Requirement Group E: Ambient 生命感层（修 P-2，全新子系统）

### E1. 微行为调度器
新建 ambient 调度层（renderer 内确定性系统，非 AI 驱动）：
- 常驻层：工位姿态微动（呼吸已有、加偶发换姿势/伸展 seated 变体）、眨眼（A2）。
- 低频离位层：每员工每 45s–4min 随机触发一次微行为——去茶水间（walk→consume→walk 回）、去书架（walk→inspect.open→回）、短交谈（走到邻座 idle.talk/sit.talk 30s）、接电话（phone）。同屏离位人数硬上限（≤2），触发用 seeded 随机保确定性可测。
- 现有 water-cooler/书架/rest zone 装饰 prefab 升级为 ambient 目的地锚点。

### E2. Run 抢占规则
真实 run 事件（dramaturgy beat）到达时该员工立刻中断 ambient（走回工位或就地进入 beat 表现），ambient 不得延迟或遮蔽任何真实工作表现；有活跃 beat 的员工不参与离位 ambient。

### E3. 门控沿用
`modes.ts` 语义扩展：reduced motion / focus mode → ambient 离位层全关（微动保留静态安全项）；office 模式默认中档；cinematic 可放宽上限。

Acceptance:
- 无 run 的办公室观察 2 分钟：至少可见 1–2 次离位微行为 + 常驻微动，但从不超过 2 人同时离位。
- 注入 run 事件后该员工 ≤1s 内中断 ambient 进入工作表现。
- focus/reduced-motion 下办公室安静，无离位走动。
- harness：ambient 调度器有确定性守卫（seeded 随机可重放）。

## Requirement Group F: 开放地台 diorama 环境（修「简陋」）

### F1. 拆墙 + 玩具地台
`RoomShell` 重做：删三面墙/玻璃隔断的"房间"语义，改为有厚度、倒角边缘的地台（模型展示座），区域由地毯（ZoneRug 保留升级）、家具群、矮绿植划分。窗/墙面板装饰移除或转化为独立 diorama 道具。

### F2. 家具度量派生（R1b 硬约束）
桌高、椅高、椅面深、显示器尺寸从新角色身体度量派生：`workstation-geometry.ts` 常量重推 + 坐姿接触点（手-桌、臀-椅）对齐；`obstacleRadius` 表与座位锚点随家具重调；`SCENE_CONTENT_SCALE` 与 `system-zone-prefab-layout.ts` 的跨包耦合在本轮补 guard 或消除。

### F3. 背景与氛围
柔和渐变背景 + 轻雾（现有 fog 调参）+ 地台外虚化；灯光保持"static well-lit diorama"方向按新材质重调；后处理（N8AO/Bloom/SMAA/Vignette）参数随新美术校准。

### F4. props 密度与区域重排
active floor props 提升到 50–100（现有 Kenney/KayKit 管线扩展），workspace/meeting/library/rest/server 区域重排为开放式布局；美术规范（bevel、圆角、饱和度、色板）写进 art bible。

Acceptance（Group F 整体）:
- 任意 orbit 角度截图无"纸片墙"穿帮（单面墙问题随拆墙消失）。
- 相机 maxDistance 全景：一眼读出这是一块玩具办公沙盘，非空旷房间。
- 60fps 预算不破（dpr [1,1.75]、frameloop always 保留；props 增量走合批/共享材质，必要时对高重复家具引入 InstancedMesh）。
- 新 art bible 文档落在 `Docs/design/office-art-bible.md`（比例、色板、bevel、饱和度、指示器规范单源）。

## Requirement Group G: 管线与守卫（贯穿）

- G1 `build-character-assets.mjs` 改造：新 body 源（Blender 产物或程序化生成入 raw 工作区）、eye decal 资产、props 扩展、单一 body 输出、25MB 门禁保留；LICENSES.md 更新（任何新外部资产 CC0/明确可商用才收）。
- G2 harness 同步：character-clip-map 状态空间计数、clip↔manifest 断言、新增 ambient 调度守卫、role↔skinTone 独立性守卫；`pnpm validate` 全绿是每 phase 门禁的一部分。
- G3 2D/3D 单源纪律：座位、staging、cue frame 改动全部走 shared 层，禁止 3D 侧 fork 私有逻辑。

## Out of Scope（明确不做）

- tower/多楼层/城市 skyline/双相机模式（将来 epic；本轮只保证地台可堆叠的形态不被堵死）。
- 精确手摆座位坐标持久化。
- 2D 场景视觉重绘（只吃语义修复）。
- 面部骨骼/morph 表情系统（眼神贴片即上限）。
- navmesh/crowd steering（现有 grid A* 够用，员工 ≤16）。
- AI 驱动的 ambient 行为（本轮是确定性调度器）。

## 最终验收（对应用户五痛点 + 拍板方向）

用 release `.app`（冷启动）截图/录屏验证：
1. **角色不诡异不廉价**：新玩具小人特写 + 全景，不像贴身彩衣真人 avatar。
2. **真在工作**：坐姿打字 vs 交谈 vs 阅读三张对比截图可区分（P-1 闭合）。
3. **活着**：2 分钟录屏含 ≥1 次离位微行为 + 眨眼/微动（P-2 闭合）。
4. **可读**：三态（working/approval/blocked）同屏截图 5 秒可辨（P-3/P-4 闭合）。
5. **座位稳定**：拖走一人录屏，其余人座位不动，被拖者走路入座（P-5 闭合）。
6. **环境**：开放地台全景，无围墙穿帮，props 密度达标。
