# 架构/质量重构 — 分 PR 执行计划(2026-07-09)

> **状态:已全部收官(2026-07-10)。** 7 个 PR 全部合入 main:PR-1=#14、PR-2=#15、PR-3=#19、PR-4=#20(merge commit 保留模块历史)、PR-5=#16、PR-7=#17、PR-6=#22;收官 main=`bbe8fa5c`。每个 PR 经 Codex 实现 + Claude 独立审计复核(含 mutation 证据)后由用户批准合入。本文档转为历史记录。

> 历史边界:本文档只记录已收官重构，不再是当前执行真源。当前工作使用 [Codex 对齐计划](./2026-07-13-ui-ux-consistency-pass/plan.md) 与维护文档。基线 commit:`591234c4`(main)。
> 执行者:Codex(无本文档以外的对话上下文,一切依据写在本文内)。
> 审计者:Claude(每个 PR 提交后独立审计,见文末「PR 审计检查点」)。
> 行号引用均为基线 commit 时点,执行前先重新定位。

---

## 1. 背景与审计结论

项目过去所有开发直接进 main,自本轮起全部走 PR。2026-07-09 完成一轮全库架构/质量审计(3 个探索代理 + 1 个规划代理,含风险核实),结论:

**健康面(不要动,不要"顺手优化")**:
- 包依赖是干净 DAG,无循环;renderer feature-sliced 分层清晰;TanStack Query/Zustand 职责分离正确。
- DB 侧有完善的 19-repo 类型化层,单一 invoke 收口(`local_db_execute_transaction`)。
- 事件方向(host→renderer)wire 契约是范本:`scripts/pi-agent-host-wire.mjs` builders + `scripts/check-pi-wire-contract.mjs` + `scripts/fixtures/pi-wire-contract.json` + Rust 侧 cargo test 读同一份 fixture。
- 全库 TODO/FIXME/HACK 为 0;Rust 生产路径错误传播规范。

**确认的架构级债(本计划的靶子)**:
1. `apps/desktop/src-tauri/resources/pi-agent-host.mjs`(325,780 行 / 14MB 生成 bundle)被 git 跟踪,每次重建产生巨量 diff churn。
2. Rust→Node 请求 payload 边界无 schema 无 gate:三个 builder(`pi_agent_host.rs` 中 `sidecar_payload` / `enhance_payload` / `collaborate_payload`)手工逐字段拼 JSON,Node 端 `scripts/tauri-pi-agent-host.entry.mjs` 手读。`projectId`(commit `f223259d`)是此请求边界的真实 runtime bug；`usage` 属 Node→Rust→renderer 响应方向,只作为跨语言契约风险旁证。事件方向有 gate,请求方向没有——不对称。
3. `pi_agent_host.rs` 3004 行巨石,spawn/payload 组装/JSONL 解析/事件投影/流重连/provider 管理混杂。
4. `packages/db-local/src/schema.sql`(~1042 行)↔ 同目录 Drizzle `schema.ts`(~1520 行)必须手工同步,无 drift gate。
5. renderer 内完整 Tauri 调用面为 65 处/26 个文件(59 处字面 `invoke()` + 6 处本地 `tauriInvoke()` wrapper),魔法字符串 + `as` 强转,无类型 facade(与 DB 侧的类型化层形成对比)。Rust `lib.rs` 的 `generate_handler!` 实注册 60 个 command。
6. 卫生债:`.tmp/pi-sdk-harness-agent/auth.json` 被跟踪;gitignore 死规则;drizzle-orm 声明版本(^0.39.x)与 `pnpm-workspace.yaml` override(0.45.2)矛盾;zod v3(platform)/v4(core+renderer)分裂。

**明确不做(推迟,任何 PR 不得触碰)**:
- OfficeScene3D.tsx / OfficeScene2D.tsx 与 UI store 的解耦、office.css(6281 行)拆分、场景组件瘦身——`Docs/roadmap/plan-office-toy-performance-overhaul.md` 的 D5 拆墙/R1b 家具重推/座位语义改造将重写这些文件,现在做是白做。
- PiAgentPane.tsx 巨石组件拆分——降级为将来机会性清理,不单开 PR。Board ownership 已迁入 `surfaces/office/board`，不再保留已删除旧 surface 的拆分任务。
- git 历史清理(filter-repo 移除 14MB 历史 blob)——改写历史是独立决策,不进本轮。
- `local_db.rs` 顶部 `include_str!("../../../../packages/db-local/src/schema.sql")` 跨包路径——路径失效会编译期大声失败,内容 drift 由 PR-5 的 gate 覆盖,不改。

---

## 2. 全局约束(每个 PR 都适用)

1. **每个 PR 独立可合并**:从最新 main 切分支,单独过全量验证。Phase A 发现两个必要交付依赖:PR-3 必须等 PR-2 合并后 rebase,否则 runtime 会优先执行 main 仍跟踪的 stale bundle;PR-4 必须基于 PR-3 合并后的 main。
2. **验证纪律**:每个 PR 合并前必须绿:
   ```bash
   CI=true npx --yes pnpm@10.15.1 install --frozen-lockfile
   npx --yes pnpm@10.15.1 validate > /tmp/validate.log 2>&1
   code=$?; tail -n 80 /tmp/validate.log; printf 'EXIT=%s\n' "$code"; exit "$code"
   ```
   涉及 Rust 的 PR 额外:`cd apps/desktop/src-tauri && cargo test --locked`。
3. **不碰 `.github/workflows/`**:本轮明确不改 CI workflow;即使当前 token scope 允许也不得混入任何 PR。如确需 workflow 改动,单独写清楚交接。
4. **禁半成品**:每个 PR 范围内的事做完整,包括被改动脚本/gate 的存量问题(例如 PR-5 的 gate 首跑若发现存量 drift,同 PR 修掉)。
5. **prelaunch 政策**:不加迁移、兼容层、fallback。旧本地数据是一次性产物,删库重建,不写升级路径(见 `Docs/architecture/2026-07-02-prelaunch-vibe-debt-policy.md`)。
6. **分支与 PR**:
   - 分支名见各 PR 小节。PR 目标分支 main,repo `mike007jd/Offisim`。
   - PR body 必须含:动机(一段)、改动清单、验证证据(validate EXIT=0 + 相关 harness/cargo 输出摘要)、风险与回滚说明。
   - 不自行 merge,提交 PR 后停,等审计。
7. **不顺手重构**:PR 范围之外的代码即使看到问题也不动(记录到 PR body 的"发现但未处理"一节即可)。

---

## 3. PR 清单

### PR-1 仓库卫生

**分支**:`refactor/pr1-repo-hygiene` · **风险:低** · **依赖:无(先做)**

**改动**:
1. `git rm --cached .tmp/pi-sdk-harness-agent/auth.json`(内容是 `{}`,运行时 scratch 文件,`scripts/harness-mcp-bridge-sdk.mjs` 只把该目录当 agentDir 用,untrack 后 harness 自己会重建)。`.gitignore` 加 `.tmp/`。
2. `.gitignore` 清死规则:`apps/web/output/`、`/legacy/`、`/legacy-a1c1110/`、`frontend/test-results/`、`output_frontend_home.png`(逐条先 grep 确认仓库内无对应路径再删)。
3. drizzle-orm 声明版本统一:`packages/core`、`packages/db-local`、`apps/desktop/renderer` 三处 package.json 里 `^0.39.x` 改为 `^0.45.2`,与 `pnpm-workspace.yaml` 的 override(0.45.2)一致。**保留 override 不删**,目标是声明与实际一致、lockfile 零漂移。
4. zod v3/v4 分裂不在本 PR 留临时注释。仓库并未安装 `@hono/zod-validator`;由 PR-7 直接迁移项目自有 Zod 调用与错误响应契约。

**验证**:`pnpm install` 后 `git diff pnpm-lock.yaml` 为空(证明零漂移);`pnpm validate` EXIT=0;`pnpm harness:mcp-bridge-sdk` 绿。

---

### PR-2 untrack 生成 bundle

**分支**:`chore/pr2-untrack-host-bundle` · **风险:低-中** · **依赖:无**

**背景**:`apps/desktop/src-tauri/resources/pi-agent-host.mjs`(14MB)是 `scripts/build-pi-agent-host.mjs` 的产物(esbuild bundle,同时把当前 Node 二进制复制到 `resources/node/bin/node`)。sibling `claude-agent-host.mjs` 和 `resources/node/` 已 gitignore,唯独它被跟踪。

**已核实的消费方(untrack 后会坏的,必须先修)**:
- `scripts/harness-pi-agent-host.mjs`:约 :45/:51 处 `readFileSync` 该 bundle 做正则断言,且约 :347 处实际执行它(`for (const scriptPath of [HOST_SCRIPT, BUNDLED_HOST_SCRIPT])`)。fresh checkout 会 ENOENT。
- cargo test / rust lane:`build.rs` 走 `tauri_build::build()`,编译期校验 `tauri.conf.json` `bundle.resources` 列表内每个路径存在,缺文件直接编译失败。`scripts/release-gates.mjs` 的 `ensureCargoTestPrereqs`(约 :19-29)目前只 stub `resources/node/bin/node`,有现成先例。
- desktop build 链安全:`apps/desktop/package.json` 的 `build:frontend` 总是先跑 `build:pi-agent-host`;`tauri.conf.json` `beforeBuildCommand: pnpm build:frontend`。
- dev 运行时反而改善:`agent_host_runtime.rs` 的 `sidecar_script_path`(约 :200-228)优先用 bundled 文件、不存在才回落 `scripts/tauri-pi-agent-host.entry.mjs`——untrack 后 dev 不再被过期 bundle 遮蔽。

**改动步骤(顺序执行)**:
1. `scripts/harness-pi-agent-host.mjs`:在读取 `BUNDLED_HOST_SCRIPT` 前检查存在性,缺失则 `spawnSync(process.execPath, ['scripts/build-pi-agent-host.mjs'], {stdio:'inherit'})` 现场重建(esbuild 由 `build-agent-host-lib.mjs` 的 `loadEsbuild` 从 renderer 的 vite 依赖解析,`pnpm install` 后即可用),显式检查 `error/status`,重建失败则 harness 明确 fail。
2. `scripts/release-gates.mjs` `ensureCargoTestPrereqs`:当前 Node 已存在时会提前 return,必须改为 Node 与 bundle 两个独立的 `if (!existsSync(...))`。若 `resources/pi-agent-host.mjs` 缺失则写入 stub。**stub 内容必须是非法 JS**(例如一行 `THIS IS A CARGO-TEST-ONLY STUB — run scripts/build-pi-agent-host.mjs`),这样若 stub 被误当真 bundle 执行会以语法错误大声失败;不要宣称它必定命中特定 ready-handshake 分支。
3. `git rm --cached apps/desktop/src-tauri/resources/pi-agent-host.mjs`;`.gitignore` 在已 ignore 的 `claude-agent-host.mjs` 旁加对应行。

**验证**:三条路径必须各自从 bundle 缺失态启动:(1) 删除 bundle→`pnpm validate` EXIT=0,确认 harness 自动重建真 bundle;(2) 再删→`node scripts/release-gates.mjs --lane=rust`,确认生成 cargo-only stub,且 `node --check` 必红;(3) 再跑 `pnpm --filter @offisim/desktop build:frontend`,确认覆盖 stub、`node --check` 绿且体量恢复。不能只删一次后让后续命令复用已重建产物。

---

### PR-3 请求方向 wire gate(本轮最高价值)

**分支**:`feat/pr3-request-wire-gate` · **风险:中** · **依赖:PR-2 先合并并 rebase**(避免 dev/runtime 优先执行仍被跟踪的 stale bundle)

**目标**:把 Rust→Node 请求 payload 纳入 fixture + 双语言生产路径测试机制,使 `projectId` 同类的「新增字段漏转发/漏读取」bug 在 CI 期必红。

**现有范本(照此镜像)**:事件方向 `scripts/pi-agent-host-wire.mjs` 导出 `PI_WIRE_BUILDERS` + SPEC;`scripts/check-pi-wire-contract.mjs` 校验 fixture 可由生产 builder 复现 + 全 camelCase;Rust 侧 `pi_agent_host.rs` 的测试 `pi_wire_fixture_decodes_across_languages` 用 `concat!(env!("CARGO_MANIFEST_DIR"), "/../../../scripts/fixtures/pi-wire-contract.json")` 读同一份 fixture。请求方向角色互换:Rust 是 emitter,Node 是 decoder。

**改动步骤**:
1. **builder 纯函数化**:`pi_agent_host.rs` 中 `sidecar_payload`(约 :777)、`enhance_payload`(约 :823)、`collaborate_payload`(约 :844)目前依赖 `AppHandle` 仅为解析 `app_pi_agent_dir`(home dir)。改签名为纯函数,`agent_dir: Option<&Path>` 由调用方传入,使 cargo test 无需 AppHandle 可直接调用。行为零变化。
2. **新 fixture** `scripts/fixtures/pi-request-contract.json`:三条请求(execute / enhance / collaborate),每条含:(a) 构造 `PiAgentExecuteRequest` 等所需的 request 输入 JSON(camelCase,经 serde 反序列化构造——同时锁住请求结构体的 camelCase decode,正是 projectId bug 的同类面);(b) 期望的 payload 输出 JSON,字段全量、取值确定性(无时间戳/随机)。
3. **Rust cargo test**:读 fixture → serde 反序列化构造 req → 调纯函数 builder → 与 fixture 期望输出做 `serde_json::Value` 逐 key 相等断言。
4. **Node 侧生产 decoder + gate**:从 `tauri-pi-agent-host.entry.mjs` 抽出可导入纯 decoder,真实 entry 路径必须调用它;`pi-agent-host-wire.mjs` 新增 `PI_REQUEST_SPEC`(per-mode required/allowed/nullable key 集),fixture 额外保存 decoder 的确定性 normalized 结果。`check-pi-wire-contract.mjs` 必须执行生产 decoder 并深比较,同时做 camelCase、未知 mode fail-loud 与 key 集双向校验;禁止仅用源码 `includes('payload.<key>')`,否则注释/错误 mode 会假绿。
5. **先收敛存量 emitter-only drift**:当前 execute 的 `companyId`、collaborate 的 `companyId`/`capabilityProfile` 已发出但 Node 无消费。核实无真实语义后从 emitter/fixture 删除;若确有语义则落实生产 decoder 消费,禁止 waiver。
6. **同步 harness 正则**:`scripts/harness-pi-agent-host.mjs` 约 :101-113 有匹配 builder 源码的正则(如 `fn sidecar_payload[\s\S]*"projectId": req.project_id`),builder 改签名后必须确认正则仍命中或同步更新。

**验证**:`pnpm check:pi-wire-contract`、`pnpm harness:pi-agent-host`、`cargo test --locked` 绿;**mutation 检查**(必做):临时把 Rust 侧一个 payload key 改名→cargo fixture test 必红;临时删生产 decoder 一处 mapping/改 key→Node gate 必红;未知 mode→Node gate 必红;全部改回后全绿。记录原始 failure signature。

---

### PR-4 pi_agent_host.rs 拆分

**分支**:`refactor/pr4-split-pi-agent-host` · **风险:高(共享执行核心 15 个 upstream / 5 个直接消费者)** · **依赖:必须在 PR-3 合并后**(否则 builder 拆两次、同文件冲突)

**方案**:单文件转目录模块 `apps/desktop/src-tauri/src/pi_agent_host/`,**`lib.rs` 的 `generate_handler![...]` 一行不改**。16 个 `#[tauri::command]` façade 保持在 `mod.rs`,内部实现下沉,避免宏生成的隐藏 wrapper 因简单 `pub use` 丢失。允许的非行为 diff 仅限 import/visibility/re-export/harness path;禁止 `use super::*` 隐藏边界。

| 模块 | 内容 |
|---|---|
| `mod.rs` | 稳定 Tauri command façade、显式 re-export、模块装配 |
| `types.rs` | Request/Response/Event/Provider DTO |
| `payload.rs` | PR-3 纯 builder + payload 写入 |
| `stream.rs` | stream state/statics、snapshot/release/reattach、publish |
| `wire.rs` | 协议常量、PiSidecarLine、parse/decode/handshake/event projection |
| `bridge.rs` | stdin registry、UI/MCP/worktree response bridge |
| `run.rs` | child spawn/read/write + execute/enhance/collaborate orchestration |
| `provider.rs` | provider config/status/save/open-folder |
| `tests.rs` | 拆前全部 host tests + PR-3 request fixture tests |

**硬性地雷(必须同 PR 修)**:`scripts/harness-pi-agent-host.mjs` 与 `scripts/harness-pi-collaboration-runtime.mts` 都直接读取/切片旧 `pi_agent_host.rs`;二者必须改为确定顺序聚合 `src/pi_agent_host/*.rs` 或精确读取目标模块。同步 active code-map/docs 的旧单文件路径;历史 roadmap 引用可保留。

**提交纪律**:逐模块一 commit,便于审计逐段对照「纯搬移无改动」。

**验证**:PR-3 合并后的 main 先用 `cargo test --locked -- --list` 保存排序清单;拆后清单 diff 必须为空且全绿。额外跑 `harness:pi-agent-host`、`harness:pi-collaboration-runtime`(基线 79/79)、`check:agent-runtime-capabilities`、`pnpm validate`;`git diff <PR3-main> -- apps/desktop/src-tauri/src/lib.rs` 必须为空。

---

### PR-5 local schema drift gate

**分支**:`feat/pr5-local-schema-drift-gate` · **风险:中-高(含 57 个真实 PK nullability baseline 修复)** · **依赖:无(可与 PR-3/4 并行)**

**背景**:`packages/db-local/src/schema.sql`(SQLite 基线,被 `local_db.rs` include_str! 编译进二进制)与 `schema.ts`(Drizzle 定义,renderer 的 sqlite-proxy 用)必须手工同步,当前无 gate。repo 无 drizzle-kit;`check-platform-migration-drift.mjs` 只是弱正则比对,不足以复用。

**方案**:新建 `scripts/check-local-schema-drift.mts`(root devDeps 已有 `better-sqlite3` + `drizzle-orm`,但 `tsx` 只在 platform 声明,命令必须走 `pnpm --filter @offisim/platform exec tsx ../../scripts/check-local-schema-drift.mts`):
1. in-memory better-sqlite3 `exec(schema.sql)`;
2. import `packages/db-local/src/schema.ts`,对每个导出表用 `drizzle-orm/sqlite-core` 的 `getTableConfig` 取列名/notNull/primaryKey/索引;
3. 与 sqlite metadata/sqlite_master 双向比对双方承诺镜像的表/列集合、storage type/affinity、真实 nullability、有序 PK、索引 name/unique/列序/partial predicate 内容、inline UNIQUE;default/FK 只在双方均声明时核实。`schema.ts` 顶部已明确 CHECK 等 SQL-only 约束有意不镜像;gate 可解析并报告 CHECK 数量,但 CHECK 内容不属于双 schema drift oracle,不得为追求表面全等把它们强塞进 Drizzle、复制第三份 manifest 或加 waiver。声明顺序差异不算 drift。
4. 以 `check:local-schema-drift` 加入根 package.json,接进 `pnpm validate` 链(放在其它 check:* 旁)。

**注意**:better-sqlite3 有 ABI 不匹配前科(NODE_MODULE_VERSION 137 vs 127),脚本报此错时先 `pnpm rebuild better-sqlite3` 再跑,并把这句写进脚本报错提示里。

**存量 drift**:已核实两侧都是 58 张表,表/列/PK/index/inline UNIQUE 集合总体一致,但 `schema.sql` 有 57 个 `TEXT PRIMARY KEY` 未显式 `NOT NULL`;SQLite 允许重复插入 NULL,是真实约束漏洞。同 PR 给这 57 个 SQL PK 补 `NOT NULL`,不改 Drizzle、不 bump `LOCAL_SCHEMA_VERSION`(prelaunch fresh baseline 修正,不是迁移)。

**验证**:gate 绿接入 validate;**mutation 检查**:schema.ts 单边加列、schema.sql 单边加列、改 nullability、删 UNIQUE/index、改 partial predicate 均必须红;全部改回全绿并记录 failure signature。

---

### PR-6 typed command facade

**分支**:`refactor/pr6-typed-command-facade` · **风险:中-高(65 个跨 renderer 调用点)** · **依赖:在 PR-4 合并后**(对齐最终 command 清单)

**背景**:renderer 内完整调用面为 65 处/26 文件:59 处字面 `invoke` 加 `evaluation-context.ts` 5 处、`git-worktree-ops.ts` 1 处本地 `tauriInvoke`。另有 4 处参数化转发(`preview-data.ts`、WorkspacePanel、StagePreviewPane、desktop-agent-runtime),需给 facade 留一个受约束动态入口。两个 mission wrapper 为 Node harness 可导入性刻意 lazy-load Tauri;facade 必须保留 lazy import/cache,不能改成顶层静态 import。

**方案**:
1. 新建 `apps/desktop/renderer/src/lib/tauri-commands.ts`:手写 `CommandMap`——以 Rust `lib.rs` `generate_handler!` 实注册的 60 个 command 为准;每个 command 定义 args/result。`invokeCommand` 用 conditional rest tuple/overload 支持 15 个无 args command,动态入口的 key 必须约束在 `keyof CommandMap`;内部 lazy import/cache `@tauri-apps/api/core`。
2. 迁移全部 65 处调用并删除两个本地 `tauriInvoke` wrapper。**arg 对象逐字节不变**。既有半类型化封装内部改走 facade。
3. 新 AST hygiene gate:renderer 除 facade 外禁止 named/aliased/dynamic/namespace `invoke` 与本地任意 string wrapper;同时从 Rust `generate_handler!` 提取 60 个 command,与 `CommandMap` keys 双向完全相等。接进 validate。
4. specta/tauri-specta 自动生成**不做**,60 个手写可控,留作将来。

**验证**:`pnpm --filter @offisim/desktop-renderer typecheck && pnpm --filter @offisim/desktop-renderer build`;`pnpm validate` EXIT=0;mutation:删一个 `CommandMap` key→command-set gate 红,新增 `mod.invoke` wrapper→hygiene gate 红,改现有 args key→typecheck 红。重点跑 mission/workspace、Pi runtime harness;release `.app` 冒烟仍由审计阶段完成并在 PR body 明示。

---

### PR-7 platform zod v3→v4

**分支**:`chore/pr7-platform-zod-v4` · **风险:中** · **依赖:无**

**步骤**:
1. 2026-07-10 已核实仓库未安装/使用 `@hono/zod-validator`;Platform 路由直接 `.parse()`。不要引入该 middleware,也不以它作为条件门。
2. `apps/platform` zod 升到与仓库一致的 `^4.4.3`;`schemas/index.ts` 将 `errorMap` 改 `error`、`ctx.data` 改 `issue.input`、单参 `z.record` 改双参;`error-handler.ts` 将已删除的 `err.errors` 改为 `err.issues`,保持现有 `{error:{code,message,details}}` wire 形状不变。
3. 新增 `harness:platform-zod-contract`:锁住四个 enum 自定义消息、`manifest_json` 任意字符串 key、`VALIDATION_ERROR` 与 `details[{path,message}]` 精确形状;接入验证。

**验证**:`pnpm security:harness` + platform auth/moderation/registry harness + 新 Zod contract harness + `pnpm validate` 全绿;mutation 将 `issues` 改回 `errors` 或破坏自定义消息时 typecheck/harness 必红。

---

## 4. 依赖与推荐顺序

```
PR-1 ──┐
PR-2 ──┼── 先行合并(止血);PR-3 交付前必须包含 PR-2 的 untrack baseline
PR-5 ──┘
PR-2 ──→ PR-3 ──→ PR-4 ──→ PR-6   (串行链;PR-4 为 HIGH 风险,必须等 PR-3 审计合并)
PR-7 独立,确定执行
```

---

## 5. PR 审计检查点(交接给审计者)

每个 PR 审计时至少核:
1. **范围纪律**:diff 是否越界(改了计划外文件/顺手重构)。
2. **验证证据**:PR body 是否含 validate EXIT=0 原始输出、相关 cargo/harness 输出;PR-3/5/6 是否附 mutation 检查证据(gate 必须被证明会咬人,不是摆设)。
3. **PR-2 专项**:stub 是否非法 JS;删本地 bundle 后三条验证路径是否真的都跑过。
4. **PR-3 专项**:fixture 是否确定性(无时间戳);双向 gate(发了没人读/读了没人发)是否都在;builder 纯函数化是否零行为变化。
5. **PR-4 专项**:逐 commit 对照是否纯搬移;cargo test 数量拆前后一致;`generate_handler!` 未改。
6. **PR-6 专项**:抽查 5+ 处迁移点 arg 对象是否逐字节不变;动态入口是否约束在 CommandMap key 联合内。
7. **全局**:是否碰了 `.github/workflows/`;是否引入迁移/兼容层/fallback(违反 prelaunch 政策);是否动了「明确不做」清单里的文件。
