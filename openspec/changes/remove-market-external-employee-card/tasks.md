## 1. Remove Market entry surfaces

- [x] 1.1 删 `packages/ui-office/src/components/marketplace/MarketPage.tsx` line 8 的 `ExternalEmployeeInstallDialog` import + line 13 的 `MarketExternalAgentCard` import
- [x] 1.2 删 `MarketPage` line 43 `useState(false)` 的 `externalInstallOpen` / `setExternalInstallOpen`（同时确认 `useState` 若不再被任何剩余 hook 使用，则连带删 import；目前同文件其它 useState 仍在用，保留 import）
- [x] 1.3 删 Explore grid 顶部 pinned `<MarketExternalAgentCard variant="grid">` 块（line 222-227 的 `<div className="px-4 pt-4">` 包装含其内部 card），保留下面的 `<MarketCardGrid>` 渲染；删除后 Explore 分支内的外层 `flex flex-col gap-4` 容器若只剩 `MarketCardGrid` 单子节点可一并简化掉
- [x] 1.4 删 Manage → Installed 顶部 pinned `<MarketExternalAgentCard variant="row">` 块（line 242-249 的 `<div className="px-4 pt-3">` 包装含其内部 card），保留下面 `<MarketManageView>` 渲染
- [x] 1.5 删 `MarketPage` 末尾 line 262-270 的 `<ExternalEmployeeInstallDialog>` JSX block（包含 `open` / `onClose` / `onInstalled` 等所有 props）
- [x] 1.6 `git rm packages/ui-office/src/components/marketplace/MarketExternalAgentCard.tsx`
- [x] 1.7 grep 全仓 `MarketExternalAgentCard` / `externalInstallOpen` 确认零残留（含 `apps/`、`packages/`、`docs/`）

## 2. Verify no orphan code

- [x] 2.1 grep `MarketPage` 文件确认 `addToast` / `repos` / `eventBus` / `activeCompanyId` 这些原本流向被删 dialog 的 props/state 仍有别的 consumer，没有的则一并删；`useToasts` 仍被 `detailUnavailable` toast 用保留；`repos` / `eventBus` / `activeCompanyId` 已无 consumer，连同 `useOffisimRuntime` / `useCompany` import 一并删
- [x] 2.2 typecheck `pnpm --filter @offisim/ui-office typecheck` PASS
- [x] 2.3 typecheck 链式 `pnpm --filter @offisim/web typecheck` PASS（不并行，按 serial 顺序）
- [x] 2.4 release desktop live verify 首轮发现 platform dev CORS 未允许 `tauri://localhost`，导致 release `.app` Market 请求被浏览器拦成 `Load failed`；补 `apps/platform/src/startup.ts` dev default origin 并跑 `pnpm --filter @offisim/platform typecheck` PASS

## 3. Sync canonical spec

- [x] 3.1 编辑 `openspec/specs/external-employee-install/spec.md`：删除 "Requirement: Market workspace exposes discovery entry for external A2A agents" 整段（含 3 个 scenario）
- [x] 3.2 同文件 Purpose 段中提及 "Market / Settings user-facing install surface" 字样改为 "Settings user-facing install surface"，并把 "discovery entry card" 字样去掉（保留 Dialog / discovery / brand inference / Settings tab / persistence 描述）
- [x] 3.3 验 `openspec validate external-employee-install` PASS
- [ ] 3.4 同步检查 `MEMORY.md` Open Issues / queue 文件 `project_ux_overhaul_queue.md` 是否需更新 F1 status 到 archived（archive 阶段做，apply 阶段不动）

## 4. Live verify (web)

- [x] 4.1 `pnpm --filter @offisim/web dev` 起 web，进入 Market workspace（platform 4100 + web 5176 起来后 reload PASS）
- [x] 4.2 Explore tab 滚动到顶部，确认无 "Connect external A2A agent" pinned card；F0 seed 的 6 类官方资源仍正常显示（snapshot 证：6 张卡 Marketing Strategist / Research Summary / Research Pipeline / Agency Lite / Starter Office Layout / Desk Essentials；零 pinned card）
- [x] 4.3 切到 Manage → Installed tab，确认顶部无 "Add external A2A agent" row entry（snapshot 证：仅 "No installed market packages" 空态 + Browse Explore 单按钮）
- [x] 4.4 切到 Settings → External Employees tab，点 "Connect agent" 打开 Dialog —— 入口路径完整（dialog 渲染 step 1 URL/token/agentId 输入 + Discover/Cancel）；3-step 完整流程（Discover → Preview → Confirm 持久化）需要真实 v1.0 endpoint，留作后续 follow-up live。本 change 未触动 dialog / discovery / Settings tab 任一文件（grep 验证），无回退风险
- [ ] 4.5 在 Settings External Employees tab 对刚装的 row 试 Refresh-card / Edit-token / Disconnect，行为同 archive 前 —— 同 4.4，需要先有真实 external employee row；本 change 未改 row UI，无回退风险
- [ ] 4.6 Office workspace 看新员工 brand avatar 在 2D + 3D 渲染分支正常；触发一次任务确认 A2A dispatch 不退化 —— 同 4.4，需要真实 external employee；本 change 未改 brand-registry / employee-node / scene 渲染，无回退风险

## 5. Live verify (desktop release)

- [x] 5.1 `pnpm --filter @offisim/desktop tauri build` 出 release `.app`，启动后点亮 Market 与 Settings 同样三步 verify（4.2 / 4.3 / 4.4；4.5 仍需真实 endpoint row）
- [x] 5.2 desktop 侧确认 release（不是 dev webview）的 Market Explore + Manage 表面都不再有外部 agent 卡，按 AGENTS.md 规则记 release 验收：Explore 仅 6 张官方 seed 卡；Manage → Installed 无 external pinned row；Settings → External Employees → Connect agent dialog step 1 正常

## 6. Commit & ready for archive

- [x] 6.1 `git status` 确认 diff = MarketPage 改动 + MarketExternalAgentCard.tsx 删除 + spec 修订 + release desktop CORS 修复 + change 文件夹
- [ ] 6.2 commit follow repo style（一次 commit 收口）；message body 写 "为什么"（Q1 决策、业务边界）不写"做了啥"
- [ ] 6.3 archive gate 三查：spec 一致 / tasks 一致 / 文档注释一致；A2A 协议台账行无变化（本 change 不动协议），无需更新 ledger
- [ ] 6.4 `/opsx:archive remove-market-external-employee-card` 同步 canonical
