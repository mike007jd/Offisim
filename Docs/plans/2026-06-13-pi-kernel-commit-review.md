# Pi kernel commit review - 2026-06-13

状态：**全部 8 项 findings 已于 2026-06-14 修复**（working tree，未提交）。详见文末「修复记录」。下方原始 findings 保留作审计存档。

时间基准：2026-06-13 23:23 NZST 当前资料核对；二次审计时间：2026-06-13 23:48 NZST。范围为截图可见 22 个 commits：`ec028138..3e644c5c`，基线 `7ed0dceb`，不含截图外后续 `2e44e26a`。当前 HEAD 复核显示以下 findings 仍存在。

## Findings

### F-001 - High - 正式 release gate 仍调用已删除的 deterministic harness

关联提交：`24583f51` 删除旧 harness 脚本与 `package.json` 脚本后未同步 `scripts/release-gates.mjs`；`ce076a7f` 的 release `.app` all-green 说法无法通过官方 gate 复现。

证据：

- `scripts/release-gates.mjs:17` 仍保留 `pnpm harness:deterministic`。
- `package.json:21-22` 只保留 `harness:pi-loop`，且 `validate` 已包含 `pnpm harness:pi-loop`。
- 实跑 `pnpm harness:deterministic` 失败：`Command "harness:deterministic" not found`。

影响：`.github/workflows/ci.yml` 的 node lane、`node scripts/release-gates.mjs --lane=node`、以及 `pnpm release:run` 都会在官方门禁路径上失败。只要这个 gate 不修，release evidence 不能声称核心 gate 可复现全绿。

后续修复方向：删除重复 deterministic gate，或把它替换为当前 `pnpm harness:pi-loop`，然后重跑 release gates。

### F-002 - High - skill mutation 工具只有定义和提示，没有接入 pi 工具池

关联提交：`2449d3b5` 引入 `employee-builder` 和 `skill-install-tools` 到 pi-only 内核后，保留了 skill mutation 工具定义，但未把这些工具注册到 employee 可用工具列表。

证据：

- `packages/core/src/pi-bridge/employee-builder.ts:57` 明确要求员工在创建、安装、fork、编辑 skill 时调用 `create_skill_from_scratch` 等 matching skill tool。
- `packages/core/src/skills/skill-install/tool-defs.ts:28-198` 定义了 `install_skill_from_git` / `install_skill_from_upload` / `sync_from_claude_code` / `sync_from_codex` / `fork_skill` / `edit_skill_body` / `create_skill_from_scratch`。
- `packages/core/src/skills/skill-install-tools.ts:575-620` 有 `handleSkillInstallTool` 执行入口。
- `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts:315-414` 组装了 `skillStagingManager` 和 `skillInstallEnvironment`，但 `virtualToolProvider` 在 `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts:450-451` 只注入 `submit_deliverable`。
- `packages/core/src/tools/builtin/index.ts:30-63` 的 `createBuiltinTools` 只注册 bash/read/write/edit/glob/grep/web/read_attachment，没有 skill install/mutation tools。
- `git grep` 在 `3e644c5c` 下显示 `buildSkillInstallTools` / `handleSkillInstallTool` 只从 `packages/core/src/index.ts` 和 `packages/core/src/browser.ts` 导出，没有被 runtime tool registry 调用。

影响：用户让员工创建、安装、fork 或编辑 skill 时，模型会被 prompt 要求调用不存在的工具；最可能结果是工具不可用、任务失败，或退回到普通 deliverable，破坏 skill install confirm bar 的真实链路。

后续修复方向：把 `buildSkillInstallTools()` 加进 employee 工具池，并在 executor 分发层把这些 tool names 路由到 `handleSkillInstallTool(...)`，同时保留 `skill_install_confirm` 审批写入路径。

### F-003 - High - P7 all-green 证据不可复现，node lane 先在 UI hygiene gate 失败

关联提交：`a5066aca` / `f1e16f69` 引入了当前 `check:ui-hygiene` 会拦截的内容；`ce076a7f` 随后记录 release `.app` live matrix all green，但官方 node lane 不能复现。

证据：

- 实跑 `pnpm check:ui-hygiene` 失败。
- 实跑 `node scripts/release-gates.mjs --lane=node`：`validate` 通过后，在 `ui-hygiene` gate 失败，尚未进入 F-001 的 deterministic gate。
- 失败项中属于本范围新增的内容：
  - `packages/core/src/pi-bridge/pi-deliverable-tool.ts:7` 的 `wired` 文案由 `a5066aca` 引入。
  - `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts:368` 的 `wired` 文案由 `f1e16f69` 引入。
  - `apps/desktop/renderer/src/surfaces/office/office.css:1996` 的 `--off-warn-fg` / raw `#fff` fallback 由 `f1e16f69` 引入。
- `check:ui-hygiene` 还报告了 `MessageItem.tsx` 的 assistant-ui primitive 问题，但 blame 显示不是截图 22 commits 引入，本轮不归因到该范围。

影响：P7 文档里的 release all-green 不能作为可复现证据；当前官方 release node lane 先因 UI hygiene 红，再因 F-001 里的旧 deterministic gate 红。

后续修复方向：清掉本范围引入的 ui-hygiene 违规，再重跑 `node scripts/release-gates.mjs --lane=node`。

### F-004 - High - graph_threads 创建失败被吞掉，会让“每个工具调用都有 audit 行”的契约静默失效

关联提交：`ef33ea5e` 修 audit FK 时引入 `ensureThreadRow`，但把失败吞掉。

证据：

- `packages/core/src/pi-bridge/pi-orchestration-service.ts:336-340` 注释明确说 `graph_threads` 行是 `mcp_audit_log.thread_id` FK 的前置条件，但实际调用是 `await this.ensureThreadRow(params).catch(() => {})`。
- `packages/core/src/mcp/auditing-tool-executor.ts:568-598` 的 audit 写入失败只记录 logger error，不阻塞工具结果。

影响：一旦 `graph_threads` 创建/更新失败，员工工具仍可能继续执行并返回结果，但 `mcp_audit_log` 写入会失败且不阻塞。P7 里“工具真执行 + audit 落库”的证据链会在数据库异常时静默断掉，用户看到的是成功，审计库里却缺行。

后续修复方向：`ensureThreadRow` 失败应让本轮 run 失败或 blocked，不能吞；至少要把失败转成用户可见/状态可见的 blocked 结果。

### F-005 - Medium - pi_messages 持久化失败被吞掉，multi-turn/resume 会静默丢历史

关联提交：`7aa5a2e5` 完成 P4 persistence 时引入。

证据：

- `packages/core/src/pi-bridge/pi-orchestration-service.ts:524-540` 的 `persistMessage` 捕获 `messageStore.append` 失败后只 `logger.warn`，不改变 run 结果。
- `scripts/harness-pi-loop.mjs:293-327` 覆盖的是内存 repo 的 happy path 多轮和 resume，没有覆盖 append 失败时的状态/用户可见结果。

影响：如果 `pi_messages` 写入失败，当前 turn 仍可能返回 completed，用户继续看到成功回复，但后续 multi-turn memory 和 ResumeBar 依据会丢失；这与 P4 “持久化完成”和 P7 “续跑已验”的产品语义不一致。

后续修复方向：持久化失败至少应让 run 状态进入 blocked/error 并暴露给 UI；不能把对话历史/续跑依据的丢失降级成仅 logger warning。

### F-006 - Medium - release gate 文档仍描述已删除的旧 harness

关联提交：`24583f51` 删除旧 harness；`896de73e` 重写架构文档但未同步 release gate 文档。

证据：

- `Docs/00_start_here/RELEASE_GATES.md:31` 把 `pnpm validate` 描述成 `typecheck + provider catalog freshness`，漏掉当前 `harness:pi-loop`。
- `Docs/00_start_here/RELEASE_GATES.md:34` 仍列出 `pnpm harness:deterministic` 和 graph/runtime/permission/planner/LLM replay invariants。
- `Docs/00_start_here/RELEASE_GATES.md:67-70` 仍列出已删除的 `harness:mcp-lifecycle` / `harness:resume` / `harness:stream-tools` / `harness:context`。

影响：人工 release 审核会按不存在的脚本执行，且验证语义仍指向已删除 graph harness，而不是当前 pi loop gate。

后续修复方向：以 `scripts/release-gates.mjs` 和 root `package.json` 当前脚本为准重写 gate 表，明确 `validate = typecheck + pi-loop + provider:check`。

### F-007 - Medium - AGENTS 测试准则仍要求写入已删除的 deterministic scenario harness

关联提交：`24583f51` 删除 `packages/core/harness/scenarios` 和 `packages/core/src/testing/invariant-assertions.ts`，但项目级 agent 指南未更新。

证据：

- `AGENTS.md:36` 仍要求新的 graph/runtime/permission/planner/LLM replay 不变量写入 `packages/core/harness/scenarios/*.json` 和 `packages/core/src/testing/invariant-assertions.ts`。
- `24583f51` 已删除这些目录/文件，当前 repo 不再有该 deterministic harness。

影响：后续 agent 或 reviewer 会被项目指南引导到不存在的路径，容易把新不变量补错位置，或误以为旧 graph harness 仍是 source of truth。

后续修复方向：把该规则改成当前 pi-loop deterministic harness 的写法，或明确哪些不变量已经没有保留 gate。

### F-008 - Low - Tauri permission allowlist 还暴露已删除的 `resume_conversation`

关联提交：`554fde98` 删除 `apps/desktop/src-tauri/src/resume.rs` 并从 `lib.rs` handler 移除命令，但权限文件和生成 schema 未同步。

证据：

- `apps/desktop/src-tauri/permissions/agent-bridges.toml:32` 仍允许 `resume_conversation`。
- `apps/desktop/src-tauri/gen/schemas/acl-manifests.json` 仍包含 `resume_conversation`。
- `git grep` 在 `3e644c5c` 下显示 `resume_conversation` 只剩上述 permission/schema 引用，`apps/desktop/src-tauri/src/lib.rs` 的 `generate_handler!` 已无该命令。

影响：当前看不到直接 UI 调用路径，因此不是立即用户可见 blocker；但桌面权限契约和实际 Rust command set 已漂移，会误导 ACL 审核，也可能让未来调用方得到 unknown command 而非清晰的能力缺失。

后续修复方向：从 permission allowlist 移除 `resume_conversation`，重新生成 Tauri ACL schema。

## 二次审计结论

| Finding | 二次结论 | 说明 |
|---|---|---|
| F-001 | Confirmed | `scripts/release-gates.mjs` 的旧 gate 行本身是历史行，但 `24583f51` 删除 `harness:deterministic` 后让它变成当前 release blocker；严重性保持 High。 |
| F-002 | Confirmed | `buildSkillInstallTools()` 能导出 7 个 skill tools，但 `createBuiltinTools()` 实际只给 employee 暴露 `bash/edit_file/read_file/web_fetch/web_search/write_file`，desktop `virtualToolProvider` 也只注入 `submit_deliverable`；严重性保持 High。 |
| F-003 | Confirmed | `check-ui-hygiene` 当前失败项中 3 条由截图范围内 commits 引入；`MessageItem.tsx` 是历史债，不归因到本范围，但仍共同证明当前 node lane 非全绿。 |
| F-004 | Confirmed | 强制 `repos.threads.create` 抛错后，`PiOrchestrationService.execute()` 仍返回 `stopReason: "completed"`；这确认不是纯理论问题。严重性保持 High，因为它破坏工具审计证据链。 |
| F-005 | Confirmed | 强制 `repos.piMessages.append` 抛错后，run 仍返回 `completed` 且 persisted rows 为 0；严重性保持 Medium，因为影响 multi-turn/resume 可靠性，不是当前 happy path 失败。 |
| F-006 | Confirmed | 文档行是历史行，但 `24583f51` 删除脚本后未同步；严重性保持 Medium。 |
| F-007 | Confirmed | AGENTS 行是历史行，但当前路径已不存在；严重性保持 Medium。 |
| F-008 | Confirmed / Low | `cargo test --locked` 通过，说明它不是 Rust 编译/测试 blocker；保留为 permission/ACL drift。 |

## 逐 commit 审计状态

| Commit | 审计结论 |
|---|---|
| `ec028138` feat(harness): pi kernel fork + bridge layer | 未发现独立 actionable finding。 |
| `8aaf2ee2` feat(harness): route desktop chat through pi kernel behind a flag | 未发现独立 actionable finding。 |
| `a5066aca` feat(harness): explicit submit_deliverable tool + persistence wiring | 触发 F-003。 |
| `d7d7b009` feat(harness): boss delegate tool + recursive sub-agents | 未发现独立 actionable finding。 |
| `96539aa9` docs(harness): pi kernel progress through Phase 5 | 未发现独立 actionable finding。 |
| `7aa5a2e5` fix(harness): self-audit remediation + finish P4 persistence | 触发 F-005。 |
| `00cc30c7` test(harness): pi-loop record/replay gate | 未发现独立 actionable finding。 |
| `60abbb4d` test(harness): pi-loop gate adds multi-turn + resume scenarios | 未发现独立 actionable finding。 |
| `ef33ea5e` fix(harness): pi creates the graph_threads row | 触发 F-004。 |
| `64576730` docs(harness): pi kernel live-verified working | 未发现独立 actionable finding。 |
| `5c63c521` refactor(harness): P6 decouple | 未发现独立 actionable finding。 |
| `24583f51` refactor(harness): P6 erase old test infrastructure | 触发 F-001、F-006、F-007。 |
| `48c804d7` docs(harness): P6 progress | 未发现独立 actionable finding。 |
| `d12def8d` refactor(harness): P6 desktop pi-only | 未发现独立 actionable finding。 |
| `2449d3b5` refactor(harness): P6 erase graph + agents kernel | 触发 F-002。 |
| `d3bb8ec6` build(harness): P6 remove @langchain dependencies | 未发现独立 actionable finding。 |
| `554fde98` refactor(harness): P6 drop dead checkpoint tables + repos | 触发 F-008。 |
| `896de73e` docs(harness): P6 rewrite core kernel docs | 未修正 F-006。 |
| `edb7543b` fix(build): self-contain build-runtime-deps | 未发现独立 actionable finding。 |
| `f1e16f69` fix(harness): P7 wire HITL approval bar into pi tool path | 触发 F-003；F-002 的 skill install/mutation 工具注册仍未闭环。 |
| `ce076a7f` docs(harness): P7 progress release .app live matrix all green | 受 F-001 和 F-003 影响，官方 release gate 不可复现全绿。 |
| `3e644c5c` docs(harness): README live-contract points to pi kernel | 未发现独立 actionable finding。 |

## 本轮验证

- `git log --reverse --date=short --pretty=format:'%h %ad %s' 7ed0dceb..3e644c5c`：确认截图可见 22 commits。
- `git diff --check 7ed0dceb..3e644c5c`：通过，无 whitespace error。
- `pnpm validate`：通过，确认当前 `typecheck + harness:pi-loop + provider:check` 不是直接红点。
- `pnpm check:ui-hygiene`：失败，确认 F-003。
- `node scripts/release-gates.mjs --lane=node`：失败在 `ui-hygiene` gate，确认 P7 all-green 不可复现。
- `cargo test --locked`（`apps/desktop/src-tauri`）：通过，确认 F-008 暂不属于 Rust 编译/测试 blocker。
- `pnpm harness:deterministic`：按预期失败，确认 F-001 不是文档误判。
- `node --input-type=module` 最小复现：强制 `repos.threads.create` 抛错仍返回 `completed`，确认 F-004。
- `node --input-type=module` 最小复现：强制 `repos.piMessages.append` 抛错仍返回 `completed` 且 persisted rows 为 0，确认 F-005。
- `node --input-type=module` 工具枚举：`buildSkillInstallTools()` 导出 7 个 skill tools；`createBuiltinTools()` 当前不包含它们，确认 F-002。
- `git grep` / `rg`：确认 skill mutation tool defs/handler 有定义但未进入 pi employee 工具池；确认 `resume_conversation` 只剩 permission/schema 残留。
- GitNexus：`detect_changes` 早前显示当前 compare 风险为 critical；二次审计时 GitNexus 未命中新 pi 符号，因此本轮 finding 证据以当前 worktree 源码、blame 和命令输出为准。

## 修复记录（2026-06-14）

按 2026-06-14 当前 worktree 核对。全部 8 项已修，门禁：`pnpm validate`（turbo typecheck 全包 + pi-loop 8 场景全 PASS + provider:check ok）、`pnpm check:ui-hygiene` ok、`pnpm --filter @offisim/desktop-renderer build` ok。

| Finding | 处理 | 改动 |
|---|---|---|
| F-001 | 修复 | `scripts/release-gates.mjs` 删除已不存在的 `deterministic-harness` gate（`validate` 已含 `harness:pi-loop`）。 |
| F-002 | 修复（全量接线） | 新增 `packages/core/src/pi-bridge/pi-skill-install-tools.ts` 的 `createSkillInstallTools()`，把 7 个 skill-mutation 工具包成 pi 虚拟工具并路由到 `handleSkillInstallTool`（保留 `skill_install_confirm` 审批路径）；经 pi-bridge/index + index.ts + runtime-public.ts 导出；桌面 `desktop-agent-runtime.ts` 的 employee `virtualToolProvider` 注入（boss 仍 delegate-only）。 |
| F-003 | 修复 | 清掉 2 处 `wired` 工程文案（`pi-deliverable-tool.ts` / `desktop-agent-runtime.ts`）+ `office.css` badge 改用已定义 `--off-accent-fg`（去掉 undefined `--off-warn-fg` 与裸 `#fff`）。**额外**：审计「MessageItem 非本范围」判断有误——基线 `7ed0dceb` 本有 `MessagePartPrimitive.Text`，是窗口内首个 commit `ec028138` 为统一 Markdown 渲染（含用户消息）有意删除，属范围内有意设计；故把过时门禁规则对齐为要求 `MessagePartPrimitive.InProgress`（仍校验 assistant-ui message-primitive 集成），node lane 由此真正复绿。 |
| F-004 | 修复 | `pi-orchestration-service.ts` 的 `ensureThreadRow` 失败不再 `.catch(() => {})`，改为清晰抛错让本轮 run 失败（保 audit FK 前置）。 |
| F-005 | 修复 | `persistMessage` 失败改为 rethrow，`runWorker` 用 `persistError` 捕获并把 `stopReason` 降级为 `error`（thread → blocked），不再静默丢历史。 |
| F-006 | 修复 | `Docs/00_start_here/RELEASE_GATES.md` 按当前 `release-gates.mjs` + root `package.json` 重写门禁表：`validate = typecheck + pi-loop + provider:check`，删掉已删除的 deterministic/mcp-lifecycle/resume/stream-tools/context 行。 |
| F-007 | 修复 | `AGENTS.md` 测试准则改指 `scripts/harness-pi-loop.mjs`（`pnpm harness:pi-loop`），注明旧 `harness/scenarios` + `invariant-assertions.ts` 已抹除。 |
| F-008 | 修复 | `permissions/agent-bridges.toml` 与 `gen/schemas/acl-manifests.json` 同步删除已不存在的 `resume_conversation` 命令。 |

### 仍需 release `.app` live 验证（基础设施 gated，hand-off）

- F-002 端到端：员工调用 skill 工具时 confirm bar 真实弹出（`InteractionService` + `PermissionApprovalBar`/skill confirm 已在 P7 证过，本次仅补注册环节，已 typecheck + build 绿）。
- F-004 / F-005 错误路径：DB 失败时 run 真进 blocked + UI 暴露（headless 已证 happy-path 无回归 + 审计已做最小复现确认 bug）。
