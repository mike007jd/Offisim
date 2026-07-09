# Office 表现层大改：玩具胶囊角色 + 状态生态 + 开放地台

> 2026-07-09 grill-me 会话拍板产物（决策记录）。GPT 5.5 Pro 的原始建议只是参考输入，不是圣旨。
> 已展开为需求包：`2026-07-09-office-toy-performance-requirements.md`（specs + 验收）
> 与执行计划：`2026-07-09-office-toy-performance-execution-plan.md`（phase/tasks/门禁）——执行以这两份为准。
> 范围外（明确不做本轮）：多楼层 tower、城市 skyline、楼层语义、双相机模式。但空间设计必须为将来堆楼留路（见 D5）。

## 一、用户已拍板的决策（不得复议）

- **D1 范围**：主攻角色表现生态（模型/动作/状态），次攻办公室环境（现状简陋）。tower/城市不做。
- **D2 美术方向**：玩具感胶囊小人。2.2–2.6 头身、头大身短、四肢圆短、大鞋底、几何衣服层（非贴身换色）。低饱和办公色板压住幼稚感。
- **D3 生产路径**：同骨架换体，免费优先。保留 Quaternius Universal 骨架 + 已导入的 19 clip 动画库 + 程序化 garment + build-character-assets.mjs 管线，替换 body mesh 为玩具比例（骨骼重塑 + 自建胶囊 mesh 皮到同骨架，或查证 CC0 生态是否有兼容体）。必要时可花小钱（<$100）买参考包。
- **D4 脸部**：点眼无嘴 + 眼神贴片表情（普通圆点 / 开心弯弧 / 担忧斜眼 / 专注眯眼）+ 周期性眨眼。对接现有 expression 字段（neutral/focus/thinking/happy/worried）。不做面部骨骼。
- **D5 空间形态**：拆围墙，开放式玩具地台 diorama——有厚度、倒角边缘的地台（模型展示座感），区域靠地毯/家具/矮绿植划分，背景柔和渐变+轻雾。将来堆叠多层即成 tower。
- **D6 活跃度**：中档低频微行为。工位姿态微动常驻（呼吸/眨眼/换姿势），每几十秒到几分钟一次微行为（伸展/喝水/去茶水间/书架/两人短交谈）。**真实 run 状态永远压过 ambient**——一有活立刻归位进入工作演出。

## 二、用户明确点名的痛点（验收必须逐条闭合）

1. **演得不像真在工作**：sit.talk 顶替打字等 proxy 要清掉，状态切换生硬。
2. **没有生命感**：idle 像雕像馆 → D6 ambient 层。
3. **状态可读性差**：扫一眼看不出谁在干嘛/谁卡住/谁在等我。
4. **视觉元素杂乱廉价**：现有环/气泡/标记不成体系。
5. **座位补位怪相（bug 级）**：`scene-layout.ts` `employeePlacements` 按数组索引分座（`employees.forEach((employee, index) => seats[index]`），座位与员工身份无绑定——拖走一人后面全体前移，有人"飘过来补位"。修法：座位分配持久化绑员工 id，只有显式移动才换座，换座必须走路（用现有 A* 寻路），彻底删除补位/漂移行为。

## 三、Lead 拍板的执行决策（自主决定，随执行可微调）

- **肤色**：保留 6 tone，内部命名 tone-01…06（UI 显示 Warm light / Fair warm / Tan / Brown / Deep / Warm orange 类中性描述），禁族裔标签；skin tone 只属于 appearance，与 role/能力/性格独立采样（现状已基本如此，加守卫即可）。
- **岗位表达**：配件 + 工牌 + 工位道具，不用肤色/性别/体型。Dev=laptop、Designer=色板/tablet、PM=clipboard、QA=checklist/放大镜、Researcher=书/文档、Ops=headset/keycard。现有 props.glb（laptop/book）扩展。
- **状态视觉语言**：随新 art bible 重做统一指示器体系。优先 diegetic（动作+道具+姿态），overlay 收敛为四态：working（轻蓝）/ approval（amber，专用等待姿态）/ blocked（红 + headshake）/ selected（高亮环+名牌）。workload 气泡、注意力环、交付架保留语义但按新体系重绘。
- **动作缺口**：sit.type、approval.wait 为 P0 新增。先重下 UAL1/2 raw 包核对全量 clip 清单（现只导入了一部分，可能有现成坐姿打字类动作——按开工日核对，勿凭记忆）；没有就用程序化姿态叠加（sit.idle 基础上手臂前伸+手部起伏）。总量控制 ~24 clip。业务层只认 canonical 名，clip-map 保持 deterministic/total。
- **2D 场景**：座位/状态语义修复走共享源（scene-layout.ts），两边同时受益；2D 视觉重绘本轮不做。
- **验证**：每 phase release `.app` live 截图验证（`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`），编译绿≠验证。

## 四、最大风险与对策

- **R1（最大）**：同骨架玩具比例改造后动画质量——头大身短可能穿模、手够不到桌面/laptop、坐姿错位。对策：**P0 先做 spike**，一个角色改完比例跑全部 clip + 坐进按新比例调好的工位 + 持道具，release .app 截图过关才铺开。**升级阶梯（按序，不预付最贵方案）**：①同骨架重塑比例（动画白捡，首选）→ ②放宽头身比到 ~3 头身（玩具感保留、动画更稳）→ ③全新骨架 + 全库动画重定向（最后手段，成本最高，仅在前两级都翻车时走）。
- **R1b（用户点名，强耦合）**：角色比例一变，场景模型必须同步——桌椅高度、显示器尺寸、坐姿手-桌接触点全部跟角色身体尺寸挂钩，不同步会立刻穿帮。对策：家具尺寸从新角色度量派生（seat height / desk height 作为由角色尺寸推导的常量，落在 `workstation-geometry.ts`）；座位锚点、prefab 障碍半径（`scene-layout.ts` obstacleRadius 表）随家具重调；P0 spike 必须含一张比例同步的工位，P6 全量铺开。
- **R2**：玩具化翻车成幼稚/廉价。对策：低饱和色板、办公道具密度、灯光质感、统一 bevel/比例规范写进 art bible（新建 `Docs/design/office-art-bible.md`）。
- **R3**:资产授权。任何新外部资产进 `LICENSES.md`（现有机制沿用），只收 CC0/明确可商用。

## 五、Phase 划分（每 phase 之间用户 /clear，release .app 验证）

- **P0 Spike**：玩具比例 rig 改造验证——1 个角色 × 全 clip × 1 张按新比例同步的工位（桌椅高度随角色度量）× 持道具，截图评审 go/no-go；不过关走 R1 升级阶梯。
- **P1 角色系统全量**：体型 3 档 × 头型 × 6 tone × 发型/帽 × 4 outfit 几何 × 岗位配件 × 眼神贴片表情。
- **P2 座位与移动**：座位持久绑定员工 id、走路换位、删补位；拖拽语义保留但落点稳定。
- **P3 动作补全 + 状态机精修**：sit.type / approval.wait 等，清理全部 proxy 映射，状态过渡平滑。
- **P4 状态视觉语言重做**：四态 overlay + diegetic 优先 + 指示器随 art bible 重绘。
- **P5 Ambient 生命感层**：中档微行为调度器（工位微动常驻 + 低频离位行为 + run 抢占）。
- **P6 办公室 diorama 环境**：拆墙、地台、背景、灯光、props 密度 50–100、区域重排；**全部家具尺寸/风格随新角色度量与 art bible 同步**（不是可选美化，是 R1b 的全量铺开），座位锚点与障碍半径同步重调。

P1/P6 的 art bible 同源，P0 通过后可并行推进。
