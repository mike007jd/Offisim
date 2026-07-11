# Office Toy Performance — Execution Plan (verified-iteration-loop)

Companion to `2026-07-09-office-toy-performance-requirements.md`（specs）与
`plan-office-toy-performance-overhaul.md`（决策记录）。依赖排序的实现 backlog，
基于 2026-07-09 深读事实清单（file:line 证据）。每 phase 收口走
`/simplify`（lead 亲自）+ `codex exec` 直审 + findings verify/fix + 门禁复绿
（用户 2026-07-02 gate 指示；禁 token 巨贵的 code-review workflow）。

建议分支：`feat/office-toy-performance`。Checked at 2026-07-09。

## Corrected assumptions（深读核实，执行时勿再踩）

- **座位补位根因已定位**：`scene-layout.ts:581-583` `employees.forEach((employee,index)=>seats[index])`——分座按 roster 数组顺序，无身份绑定。修复点集中在 `employeePlacements`，2D/3D 自动同吃（单源）。
- **拖拽已持久化，但只到 zone 粒度**：`queries.ts:268-278` `reassign` → `employees.update({workstation_id})`；精确 x/z 只进 diagnostic。B 组不需要新后端字段即可实现身份稳定分座（zone 内按 employee id 稳定排序）；若选显式 seat slot 字段则走 prelaunch 三步（schema.ts+schema.sql / bump `LOCAL_SCHEMA_VERSION` / migration 注册），无历史迁移。
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

依赖关系：P0 → P1 →（P2 ∥ P3）→ P4 → P5；P6 依赖 P1 的 art bible 与角色度量，
可在 P2/P3 期间并行启动家具度量部分（R1b 与 P0 已验的工位同源）。

## Per-phase tasks

### P0 Spike（go/no-go，不合入主线功能，只出证据与结论）
- [ ] 重建 raw 工作区：下载 UBC + UAL1 + UAL2（顺手记录 pack 全量 clip 清单 → P3 输入）。
- [ ] 玩具比例改造试验：骨骼比例重塑（头骨放大、四肢缩短）+ 胶囊 body mesh 皮到同骨架（Blender 脚本或 gltf-transform 程序化，取其一跑通即可）。
- [ ] 19 clip 全播（含 sit.enter/exit、walk、carry、celebrate.dance）录屏，检查穿模/滑步/root 偏移。
- [ ] 1 张按新度量重推的工位（desk/chair 高度改 `workstation-geometry.ts` 试验值）：坐下 → 手落桌面 → laptop 挂手可见。
- [ ] release `.app` 冷启动截图（特写 + 办公室相机距离 + 远景），评审判据：不诡异、不穿帮、动画可接受。
- [ ] 结论落盘（go / 放宽头身比 / 新骨架）到本文件 Delivered 区。

### P1 角色系统全量（A）
- [ ] build script：单一玩具体输出（删 body_male/body_female 双体），皮肤 Light/Dark 纹理 + tint 管线保留；`heightUnits` 重标定（TARGET_HEIGHT_UNITS 语义复核）。
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

（执行时填写：phase / commit / codex gate / 闭合痛点）
