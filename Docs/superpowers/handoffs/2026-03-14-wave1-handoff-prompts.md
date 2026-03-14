# Wave 1: 4 Parallel Session Handoff Prompts

> 以下 4 个 prompt 可同时粘贴给 4 个独立的 Claude Code session。
> 每个 session 有严格的文件归属边界，不会产生 git 冲突。
> 全部完成后需要一个合并 session 来 resolve 任何 barrel export 冲突并运行全局验证。

---

## Session A: Platform Security Hardening

```
我是 AICS 项目的开发者。请执行安全加固计划。

当前状态：
- 960+ tests, 0 failures, 26/26 typecheck
- Platform API 在 apps/platform/src/ (Hono + Drizzle + PostgreSQL)

请先读取：
1. CLAUDE.md
2. Docs/superpowers/plans/2026-03-14-plan-a-platform-security.md

这个计划包含 5 个 Task：
1. JWT 验证修复（安装 jose，实现双模式验证）
2. CORS 白名单 + 生产环境启动守卫
3. 速率限制中间件（内存 token bucket）
4. 安装计数原子性修复（Drizzle transaction）
5. 搜索分页边界 + Schema 加固（移除 .passthrough()）

文件归属范围：仅 apps/platform/src/。不要触碰其他 app 或 package。

请按顺序执行每个 Task，每个 Task 完成后单独 commit。
完成后运行 pnpm run test --filter @aics/platform 和 pnpm run typecheck --filter @aics/platform 验证。
```

---

## Session B: Doc Engine + Pitch Hall

```
我是 AICS 项目的开发者。请创建文档导出引擎并升级 Pitch Hall。

当前状态：
- TechStack v1.5 规定了 packages/doc-engine 但从未创建
- PitchHall 组件只支持 .txt 下载（packages/ui-office/src/components/pitch/PitchHall.tsx）
- PRD 要求 DOCX/PPTX/PDF/CSV/XLSX/HTML 多格式导出

请先读取：
1. CLAUDE.md
2. Docs/superpowers/plans/2026-03-14-plan-b-doc-engine-pitch-hall.md
3. packages/install-core/package.json（参考包结构模板）

这个计划包含 2 个 Task：
1. 创建 packages/doc-engine 包（docx + pptxgenjs + pdf-lib + SheetJS）
2. 升级 PitchHall 组件添加格式选择器

文件归属范围：packages/doc-engine/（全新）、packages/ui-office/src/components/pitch/、packages/ui-office/package.json。不要触碰 apps/platform、apps/market、packages/renderer、packages/core/src/graph/。

请按顺序执行，每个 Task 完成后单独 commit。
完成后运行：
- pnpm run build --filter @aics/doc-engine
- pnpm run test --filter @aics/doc-engine
- pnpm run typecheck --filter @aics/ui-office
```

---

## Session C: Core Runtime Gaps

```
我是 AICS 项目的开发者。请填补核心运行时的 3 个 PRD 差距。

当前状态：
- PRD 2.4 要求三大系统 Agent（Manager/HR/PM），HR 节点完全缺失
- PRD 2.6 要求 Notification Center，完全未实现
- PRD 4.2 要求 3 个默认模板，Agency Lite 未实现（只有 rd-company、content-studio、product-team）

请先读取：
1. CLAUDE.md
2. Docs/superpowers/plans/2026-03-14-plan-c-core-runtime-gaps.md
3. packages/core/src/agents/boss-node.ts（node 模式参考）
4. packages/core/src/templates/content-studio.ts（模板模式参考）
5. packages/core/src/graph/main-graph.ts（图注册点）

这个计划包含 3 个 Task：
1. HR Agent 节点（新 graph node + 路由 + 事件）
2. Notification Center（事件工厂 + useNotifications hook + UI 组件）
3. Agency Lite 模板（5 员工 + 2 SOP）

文件归属范围：packages/core/src/agents/、packages/core/src/graph/、packages/core/src/templates/、packages/core/src/events/、packages/ui-office/src/components/notifications/（新）、packages/ui-office/src/components/layout/、packages/shared-types/src/events.ts。不要触碰 apps/platform、apps/market、packages/renderer。

请按顺序执行，每个 Task 完成后单独 commit。
完成后运行：
- pnpm run test --filter @aics/core
- pnpm run typecheck --filter @aics/core --filter @aics/ui-office --filter @aics/shared-types
- pnpm run build --filter @aics/core --filter @aics/shared-types
```

---

## Session D: Renderer Quality + Code Health

```
我是 AICS 项目的开发者。请修复渲染器质量问题和代码健康度。

当前状态：
- SceneManager 1185 行，职责过重需拆分
- GSAP tween 有内存泄漏风险（未追踪的 tween 在 entity 销毁后继续执行）
- Next.js market app 缺少 ISR 缓存和 loading.tsx 流式回退
- Core 包有 12 处散乱的 console.error/warn 需要统一

请先读取：
1. CLAUDE.md
2. Docs/superpowers/plans/2026-03-14-plan-d-renderer-code-quality.md
3. packages/renderer/src/core/scene-manager.ts（完整阅读，理解拆分点）
4. packages/renderer/src/puppet/base-puppet.ts（trackTween 方法）

这个计划包含 5 个 Task：
1. GSAP tween 生命周期修复（trackTween + SceneManager + InteractionController）
2. SceneManager 拆分为 4 个文件（EntityManager + EventHandler + VisualFeedback）
3. STATE_TO_ANIM 映射完整性检查
4. Next.js ISR + loading.tsx（5 个页面的骨架屏）
5. Core 统一日志（Logger 类 + 替换 8 个文件的 console 调用）

文件归属范围：packages/renderer/src/、apps/market/src/app/（仅 loading.tsx 和 next.config.ts）、packages/core/src/services/logger.ts（新）和 core 中的 console 调用替换。不要触碰 apps/platform、packages/core/src/graph/（除日志替换外）、packages/core/src/templates/、packages/ui-office/src/components/notifications/。

注意：Task 1 必须在 Task 2 之前完成（先修 tween，再拆分 SceneManager）。
Task 3-5 与 Task 1-2 独立。

请按顺序执行，每个 Task 完成后单独 commit。
完成后运行：
- pnpm run test --filter @aics/renderer --filter @aics/core
- pnpm run typecheck --filter @aics/renderer --filter @aics/core --filter market
- pnpm run build --filter @aics/renderer --filter @aics/core --filter market
```

---

## 合并 Session（Wave 1 全部完成后）

```
我是 AICS 项目的开发者。Wave 1 的 4 个并行 session 已完成：
- Session A: Platform Security Hardening
- Session B: Doc Engine + Pitch Hall
- Session C: Core Runtime Gaps (HR Agent + Notifications + Agency Lite)
- Session D: Renderer Quality + Code Health

请执行合并验证：
1. 先运行 git log --oneline -20 查看所有新 commit
2. 检查是否有 barrel export 冲突（packages/core/src/index.ts, packages/ui-office/src/index.ts）
3. 运行全局验证：
   - pnpm run typecheck（所有 26 个包）
   - pnpm run test（所有测试套件）
   - pnpm run build --filter @aics/core --filter @aics/renderer --filter @aics/ui-office --filter @aics/doc-engine --filter @aics/platform --filter market --filter web
4. 修复任何冲突或 barrel export 问题
5. 生成 handoff 文档，列出：完成了什么、剩余 debt、下一步（Wave 2: Fork 溯源 + Market UX 补全）

请读取 CLAUDE.md 和 memory/MEMORY.md 了解项目上下文。
```
