# Offisim 1.0.0-rc.1 — Pre-Launch Audit（上线前审计报告）

- 初审日期：2026-06-10
- 二次核验：2026-06-11 23:45 NZST
- 审计更正：2026-06-12 00:02 NZST
- 初审方式：纯静态只读审查（未执行 install/build/typecheck，未修改任何源码）
- 二次修订方式：按当前 worktree 回读源码/配置/文档，并复核 targeted gates
- 审计组：Senior PM、Senior UI/UX、Game Designer、3D Artist、Staff Engineer、QA Lead、Security/Privacy、Launch Readiness
- 方法：6 路并行专项审查 + 对所有 BLOCKER/HIGH 级发现做人工回读源码交叉核验；本版已删除二次核验推翻的过期结论

---

## 0. 总体结论

**判定：有条件放行（Conditional GO）— 适合受控发布（早期访问/有限渠道），不适合直接全面公开发布。**

代码本体质量高：路径收容、凭证隔离、shell 防御纵深、供应链校验、TS/Rust 纪律、确定性 harness 都已具备发布级基础。二次核验显示，原报告里的发布门禁、CHANGELOG、release devtools、db-local 迁移链等阻塞结论已经被当前 worktree 修复或声明清楚。

当前受控 RC 不再有已知 BLOCKER。仍然成立的关键风险集中在三类：面向用户/市场的法务与信任材料不足、桌面 release `.app` 真实交互证据还缺标准化模板、3D/空间 UI 的状态解释与可达性/性能仍需实测或产品补强。共保留 **4 项 HIGH**。

### 原阻塞项二次核销

| 原编号 | 当前状态 | 核验结论 | 证据 |
|---|---|---|---|
| B1 | 已核销 | CI 已存在；`release:run` 会先跑统一 `RELEASE_GATES`，失败即中止，并写 gate log、git 状态、bundle sha256 到 release evidence | `.github/workflows/ci.yml`、`scripts/release-gates.mjs`、`scripts/run-clean-release.mjs`、`Docs/00_start_here/RELEASE_GATES.md` |
| B2 | 已核销 | CHANGELOG 已按当前事实声明 CI、release gate、devtools、local db 迁移、marketplace preview-only、无 auto-update、plaintext secret 取舍 | `CHANGELOG.md` |
| Devtools | 已核销 | 默认 release build 不启用 WebView devtools；仅 `build:devtools` live-verify lane 显式 opt in | `apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/src/lib.rs`、`Docs/00_start_here/DEPLOYMENT.md` |
| db-local 迁移 | 已核销 | 本地 SQLite 已有 `PRAGMA user_version`、顺序迁移骨架、旧库 adoption、新库拒绝、gap/incomplete chain 测试 | `apps/desktop/src-tauri/src/local_db.rs`、`packages/db-local/src/migrations/README.md` |

---

## 1. Senior Product Manager

### 通过项

- **版本一致性 PASS**：root、tauri.conf.json、workspace package/app 版本均为 `1.0.0-rc.1`。
- **发布叙事已收敛**：README、CHANGELOG、DEPLOYMENT 已一致声明：桌面是产品环境，platform 是 registry/support API，不恢复 standalone web/launcher。
- **Marketplace 范围已披露**：README 和 CHANGELOG 已声明 Skills/Employee packages 可安装，Company templates/Office Layout/Prefab packs 为 preview-only。
- **无 auto-update 已明示**：DEPLOYMENT 将无内置更新机制定义为 1.0 本地优先取舍，并说明手动升级 + SQLite migration chain。
- **文档引用完整 PASS**：README / RELEASE_GATES / DEPLOYMENT / 各 CLAUDE.md 引用的契约文件真实存在。
- **`.env.example` 完整 PASS**：覆盖代码实际读取的必需 env；platform 额外可选 key 在 platform deployment gates 中有记载。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| HIGH | 面向用户的法务文件缺失 | 无 Privacy Policy、Terms of Service、市场内容审核政策。受控 RC 可接受；开放第三方市场或更广泛公开分发前必须补齐。 |
| MEDIUM | Preview-only listing 仍是产品债 | 范围已经声明清楚，因此不再是发布误导；但 Office Layout 与 Prefab pack 缺安装管线仍会限制 marketplace 完整体验，需进 post-1.0 backlog。 |
| LOW | 首次启动无引导流程 | 与“非向导式产品”哲学一致，但空公司冷启动体验还缺真实 release `.app` 观察证据。 |

---

## 2. Senior UI/UX Designer

### 通过项

- **栈合规**：React 19、Tailwind v4、shadcn/ui、assistant-ui、motion/react、TanStack Query、Zustand、RHF+Zod、dnd-kit、cmdk、Sonner 全部按 `Docs/UI_FRAMEWORK_STACK.md` 落位。
- **3D 栈已入册**：`Docs/UI_FRAMEWORK_STACK.md` 已登记 `three`、`@react-three/fiber`、`@react-three/drei`、`@react-three/postprocessing` 为 scene-layer 专用栈，并说明 raw hex 与 CSS token 双轨纪律。
- **Renderer 根部齐边规则 PASS**：未发现外层 margin/padding/假黑框/`calc(100% - 16px)`。
- **令牌化纪律好**：UI 层无任意 Tailwind 值；颜色集中在 CSS token；场景层 raw hex 有显式豁免。
- **状态覆盖**：App/Surface 双层 ErrorBoundary、Suspense loading、Sonner toast、空状态模式均在；7 个主 surface 全部落地。
- **可达性基础**：focus ring token 化、图标 aria-hidden、Radix 对话框、`prefers-reduced-motion` 媒体查询存在。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| MEDIUM | 可达性未经实测 | 静态合规不等于实际可用；3D 场景对屏幕阅读器不可见，仍需要语义化状态列表或等价替代路径，并用 release `.app` 验证键盘流程。 |
| MEDIUM | 无 i18n 基础设施 | 全部 UI 字符串硬编码英文。若 1.x 有非英语市场计划，现在是改造成本最低点。 |
| LOW | `check:ui-hygiene` 仍是辅助 gate | 它适合发现 stale copy / token 违规，但不能替代真实 UI 行为、可达性和布局验收。 |

---

## 3. Game Designer

### 通过项

- **角色状态确实驱动视觉**：运行时 action 驱动姿态、表情与 ActionHalo，核心状态→空间表达链路成立。
- **2D/3D 双渲染模式**：`OfficeStage.tsx` 提供用户可切换的 2D/2.5D 降级路径，是合理的性能/兼容兜底。
- **游戏感细节存在**：程序化角色、眨眼、坐/站姿态、拖拽表情、运行中场景氛围切换，角色层兑现了 game-grade presentation 承诺。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| HIGH | 状态语义缺少图例/教学 | working 黄环、active 绿环、dragging 大环没有 legend、tooltip 或首启提示解释。空间隐喻的价值建立在“一眼可读”上，当前对新用户仍偏隐晦。 |
| MEDIUM | prefab 语义状态机未绑定 3D 视觉 | status-board、server rack 等装饰物目前偏静态；会议、排队、中断等 README 一级概念缺少专属视觉语言。 |
| MEDIUM | 反馈闭环单薄 | 任务完成/失败时刻主要靠 toast，场景级庆祝或警示不足，重大事件与平凡事件视觉权重接近。 |

---

## 4. 3D Artist

### 通过项

- 艺术方向集中管理：`scene-art-direction.ts`、`scene-colors.ts`、`scene-materials.tsx`、ACES tone mapping、postprocessing 管线集中且可维护。
- 程序化资产为主，仓库内无大体积未授权素材；server rack 有专门 LOD 贴图，说明有性能意识。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| MEDIUM | 规模性能未经验证 | 角色无通用 LOD/实例化策略，员工数 N>50 的帧率、内存、冷启动到首帧暂无实测记录。建议至少做一次 100 员工压力场景并记录。 |
| MEDIUM | 场景 bundle 体积缺预算 | 3D scene 已懒加载，但没有 bundle 预算或分析报告；应补冷启动、首帧、内存的 release `.app` 实测数据。 |
| LOW | 场景色板与 UI token 双轨 | 该双轨已被 UI_FRAMEWORK_STACK 接受；后续主题切换时需要维护同步纪律。 |

---

## 5. Staff Software Engineer

### 通过项

- **路径收容（卓越）**：workspace root 规范化、上级目录拒绝、过宽 root 拒绝、写入双重校验、叶子文件 `O_NOFOLLOW` 防符号链接逃逸，并有 Rust 测试覆盖。
- **Shell 防御纵深**：Rust 侧独立绊网覆盖 fork bomb、sudo/doas/pkexec、`curl|sh`、base64 解码管道、Unicode 同形字等风险。
- **凭证隔离**：密钥不跨 Rust→JS 边界；0600 原子写；shell/git 输出脱敏；env 注入仅白名单变量。
- **架构边界守住了**：renderer 文件访问走 `project_*` Tauri command；模型/工具执行走 OrchestrationService + AuditingToolExecutor；工具调用先写审计。
- **Rust 错误处理主路径扎实**：生产主路径以 `Result`/显式错误处理为主；core 包零空 catch；结构化 JSON 日志可替换 handler。当前仍有已登记 panic/unwrap 面，不再按“零 unwrap/expect/panic”描述。
- **平台 API 基础扎实**：Hono、流式 body 限制、核心写入 body 多数使用 Zod、批量加载防 N+1、显式事务 + 幂等回执、参数化 SQL 均在。当前仍有部分 param/query/body 直接读取或手写校验，不再按路由层 schema 全覆盖描述。
- **TS 纪律基础扎实**：root/base 默认开启 strict、`noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`；`any` 使用量低且有正当理由。当前仍有 package-level 例外。
- **local db 迁移骨架已落地**：`LOCAL_SCHEMA_VERSION`、`MIGRATIONS`、`PRAGMA user_version`、旧库 adoption、新库拒绝、gap/incomplete chain 测试均在。
- **root overrides 已清理**：当前 `pnpm.overrides` 不再含无主 `next` override。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| MEDIUM | Rust panic/unwrap 面未完全清零 | `apps/desktop/src-tauri/src/in_flight.rs` 的 `InFlightRegistry::guard` lock poison 使用 `panic!`，`apps/desktop/src-tauri/src/mcp_bridge/jsonrpc_framer.rs` 的 `RequestTracker` mutex 使用 `unwrap()`，`apps/desktop/src-tauri/src/lib.rs` 的 Tauri `build(...).expect(...)` 仍在。后续应按风险决定改为 fail-closed error，或明确保留为启动/poison 边界 panic。 |
| MEDIUM | 平台 API schema 校验不统一 | `POST /tokens` body cast、`DELETE /tokens/:tokenId`、`GET /install/download/:versionId`、`GET /me/library?kind=` 等路径仍直接读取 param/query/body 或手写校验；核心写入 body 多数已有 Zod，但不能宣称 schema 覆盖所有路由。 |
| LOW | install-core TS unused 检查有 package 例外 | `tsconfig.base.json` 默认开启 `noUnusedLocals` / `noUnusedParameters`，但 `packages/install-core/tsconfig.json` 将两项设为 `false`。 |
| LOW | deep link 参数无长度上限 | `listing_id` / `version` 已限定参数名，但建议补最大长度校验，避免异常长 URL 进入后续流程。 |

---

## 6. QA Lead

### 通过项

- **门禁已强制化**：`.github/workflows/ci.yml` 在 push/PR 上跑 node lane + rust lane；`scripts/release-gates.mjs` 是 gate 单一来源；`pnpm release:run` 复用同一列表。
- **证据采集已落地**：`run-clean-release.mjs` 写 `output/release-evidence/`，记录 gate log、git commit/dirty state、bundle sha256；`--skip-gates` 输出被标成非 release evidence。
- **cargo test 已入 gate**：`RELEASE_GATES` 包含 `cargo test --locked`，cwd 为 `apps/desktop/src-tauri`；CI macOS lane 同步执行。
- **确定性 harness 体系扎实**：contract/replay/provider/security harness 基于 FakeGateway/fixture，无网络无时钟依赖。
- **db-local 升级路径已有单测**：fresh bootstrap、pre-versioning adoption、gap rejected、incomplete chain rejected、newer database refused 均覆盖。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| HIGH | UI 行为自动化与 release `.app` 证据模板不足 | RELEASE_GATES 已要求 Computer Use 真实交互和截图，但还没有标准化 checklist / artifact naming / screenshot set，容易导致每次人工验收粒度漂移。 |
| MEDIUM | install-core 关键路径缺直接单测 | `materializer.ts`、`state-machine.ts`、`safe-unzip.ts` 主要被高层场景间接覆盖；事务中途失败的回滚分支应补直接 harness。 |
| MEDIUM | 故障注入空白 | 并发竞争、流中断、MCP server 崩溃、ENOSPC、>8MB doc-engine 大文件等仍缺覆盖。 |
| LOW | 个别 gate 有“空集即过”风险 | schema/migration 类检查应继续避免“找不到约束即通过”的静默路径。 |

---

## 7. Security / Privacy Reviewer

### 通过项

- **机密卫生 PASS**：`.gitignore` 覆盖 `.env`/`.env.*`（仅放行 example）；源码未发现硬编码密钥。
- **release build 不带 devtools**：默认 ship channel 不编译 WebView devtools；live-verify build 需要显式 `build:devtools`。
- **plaintext secret 取舍已披露**：SECURITY 已说明 0600 plaintext file 是 deliberate trade-off，威胁模型防 prompt-injected Rust→JS exfiltration，而非防同用户本机磁盘取证。
- **供应链**：流式 zip-bomb 防护、manifest JSON Schema、`package_sha256` 完整性、validator 不使用 `new Function`、install 状态机终态无出边。
- **SSRF 基础**：web fetch/search 有 hostname 校验、私网/localhost/云元数据端点封锁、重定向拒绝、字节上限及专属 security harness。
- **平台**：Better Auth 生产 secret 缺失/公开占位值拒绝启动、SHA-256 API token、资源级属主校验、代理感知限流、安全头、CSP/CORS build-time sync。

### 发现

| 级别 | 发现 | 说明 |
|------|------|------|
| HIGH | 第三方市场前置信任债 | SECURITY 明示 signed artifact provenance、publisher identity attestation、`external_url` hardened fetcher/registry upload 是 broad third-party marketplace 前置项；受控 RC 可以放行，开放市场前不能放行。 |
| MEDIUM | Docker 默认凭证需更显性 prod 模板 | DEPLOYMENT 已提示 dev-grade defaults；建议提供 prod compose/env 模板减少误用。 |

隐私面：未发现 telemetry / analytics 外发调用；日志经脱敏管线；本地优先承诺与代码一致。

---

## 8. Launch Readiness Reviewer — 放行清单

### 受控 RC 发布前必须满足

1. `pnpm release:run` 必须完整跑完，不使用 `--skip-gates`，并保留 `output/release-evidence/`。
2. 必须对当前 worktree 的 release `.app` 做 Computer Use 真实交互，记录 app path、bundle sha256、核心工作流截图/观察结论。
3. 发布说明必须保持当前边界：marketplace preview-only 范围、无 auto-update、plaintext secret trade-off、单实例 platform。
4. 若本次 release 面向外部用户，Privacy / Terms / 内容审核政策至少要有公开草案链接。

### 开放第三方市场前必须完成

- Privacy Policy / ToS / 内容审核政策
- 工件签名 + 发布者身份认证
- `external_url` hardened fetcher 或关闭该路径，仅允许 registry object upload
- Prefab/Layout 安装管线补全
- Marketplace moderation / abuse response 工作流

### 建议但不阻塞受控 RC

- 状态图例或 hover 解释
- release `.app` 证据模板（固定 screenshot set、artifact naming、checklist）
- install-core 直接 harness
- 100 员工性能基准
- 可达性键盘/屏幕阅读器验收
- i18n 决策
- CHANGELOG 继续扩写用户可读功能清单

---

## 9. 审计方法与误报修正记录

为保证报告可信度，所有 BLOCKER/HIGH 初判均经第二轮人工回读源码核验。二次修订删除或降级了以下过期结论：

1. 原“发布门禁未强制”结论已被当前 CI + `release:run` + release evidence 机制推翻。
2. 原“CHANGELOG 声明与仓库事实不符”结论已被当前 CHANGELOG + `.github/workflows/ci.yml` 推翻。
3. 原“默认 release 含 WebView devtools”结论已被当前 Cargo feature 分离和 DEPLOYMENT 说明推翻。
4. 原“db-local 没有用户数据升级路径”结论已被 `PRAGMA user_version` 迁移链和 local_db 测试推翻。
5. 原“cargo test 未进入 gate”结论已被 `RELEASE_GATES` rust lane + CI macOS lane 推翻。
6. 原“3D 栈未入册”结论已被 `Docs/UI_FRAMEWORK_STACK.md` 当前 3D scene 条目推翻。
7. 原“README/CHANGELOG 未披露 marketplace preview-only、无 auto-update、plaintext secret 取舍、next override 噪音”均已被当前文档或 package metadata 推翻。
8. 原“`BETTER_AUTH_SECRET` 缺生产值守卫”结论已被 `resolveAuthSecret` 的 production 缺失值和公开占位值拒绝启动逻辑推翻。

二次核验已执行并通过：

- `node --check scripts/release-gates.mjs`
- `node --check scripts/run-clean-release.mjs`
- `cargo test --locked local_db --manifest-path apps/desktop/src-tauri/Cargo.toml`（9 个 local_db 测试）

本报告仍不是完整 release 证据：最终放行必须以当前 worktree 的 `pnpm release:run` 输出和 release `.app` Computer Use 真实交互截图为准。
