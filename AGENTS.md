# 对话
- 中文回答。

# 完整交付硬规则
- 禁止把“最小化交付 / MVP / 先做核心 / 先过编译”当作用户要求任务的完成口径。用户交给 Codex 执行时，默认目标是完整交付整个 scope。
- 完整交付包含：实现真实修复、同步 spec / docs / task 状态、跑要求的构建与门禁、完成必要的 release / live runtime 验收、记录证据与未完成项。
- 不允许在“部分实现 / 大部分 task 勾选 / 编译通过 / harness 通过 / 找到 blocker 但未闭环”时声称完成。
- 如果遇到凭证、外部服务、设备不可达、破坏性风险或产品决策无法合理推断等真实阻塞，必须明确标成“未完整交付”，保留未勾 task / tag gate / archive gate，不得用 known limitation 或口头解释替代验收。
- 发现额外真实 blocker 时，先修能修的部分并记录证据；不能修的要直接 surface 根因和下一步所需条件，不要缩小 scope 后交付。

# 验证 / 测试准则
- 不在 `packages/core/src/**/*.test.mjs` 新增或保留 runtime / graph / product 行为测试。
- 新的 graph、runtime、permission、planner、kanban、LLM replay 不变量必须走 deterministic harness：`packages/core/harness/scenarios/*.json` + `packages/core/src/testing/invariant-assertions.ts`，并按需加入 `manifest.json` / replay 或 soak 列表。
- 临时 `node --test` 只允许作为本地探索，不进 git；不要通过给 `packages/core/package.json` 加 `test` script 或 CI gate 来恢复普通 product 自动测试。
- 如果 review 发现源内 `.test.mjs` 和 harness 重复，优先删除源内测试，把仍有价值的不变量迁到 harness。

# Desktop / Computer Use 验收
- 用 Computer Use 测 Tauri 桌面端时，默认测 release `.app`，不要把 dev webview 结果当作最终桌面验收。
- 验收前先执行桌面 release build，再启动 `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。
- 若 dev 能跑但 release `.app` 不可交互、黑屏、或 Computer Use 无法附着，按 release 桌面阻塞处理，先查清原因再继续依赖桌面验收结论。
