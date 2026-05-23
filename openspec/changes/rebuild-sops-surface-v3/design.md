## Context

`packages/ui-office/src/components/sop/`：`SopViewSurface`(839，三栏 state machine)、`SopDagCanvas`(906，HTML node overlay + SVG ports/edges/drag-hit，共享 scale/translate ref)、`SopDagNode`/`SopDagEdge`、`SopSidebar`(177)、`SopInspectorPanel`(209，`p-4` gap-4，段 caps label 已对但缺 `--line-soft` 段分隔)、`SopRunProgressStrip`(103，已用 token 但是 legacy `--info`/`--success`/`--error` 系，需迁到 V3 `--accent`/`--ok`/`--danger`)、`SopNlCommandBar`、`sop-dag-layout.ts`(topo-sort+cycle)。三栏 280|1fr|320 已对。

锁定（CLAUDE.md + `sop-builder-canvas` req117）：Tauri release node face 不得入 SVG `foreignObject`；HTML overlay + SVG interaction layer 共享 graph transform。`sop-run-surface`：run-strip status-tinted、redispatch 守卫等行为锁定。

V3 prototype `.insp-sec`：`border-bottom 1px var(--line-soft)`(末段无) + `padding var(--sp-5)` + gap `--sp-3`；`.insp-sec-label` caps。`.run-strip.run/done/fail` status-tinted。

## Goals / Non-Goals

**Goals:** SOPs inspector V3 sectioned panel + run-strip token 收口，三栏/DAG 全保持。

**Non-Goals:** DAG 渲染架构/拓扑/交互/持久化/dispatch（全锁定）；scope-bar/bell（全局 Phase 2/8）；surface 配色(Phase 0)。

## Decisions

### D1 — inspector `.insp-sec` sectioned（纯样式）
`SopInspectorPanel` 各段套 `.insp-sec`：caps label + content block，段间 `--line-soft` 下边框（`:last-child` 无），padding `--sp-5`，gap `--sp-3`。不动段的数据/copy 逻辑（last-error/output-key copyable 保持）。

### D2 — run-strip token-family 迁移
`SopRunProgressStrip` 今天用 legacy `--info`/`--success`/`--error` 系（`border-info bg-info-muted text-info` + `bg-success`），迁到 V3 status 系：run→`--accent-surface`+`--accent-ring`+`--accent`、done→`--ok-surface`+ok-tone、fail→`--danger-surface`+danger-tone（V3 DNA §2/§3 `--info` alias 到 `--accent`），pulse dot 随 state 同步取 `--accent`/`--ok`/`--danger`，无硬 hex；3s auto-clear 行为不变。**这是 info→accent + success→ok 的家族迁移，非 confirm-only no-op**。

### D3 — DAG 架构锁定（不动）
`SopDagCanvas`/`sop-dag-layout`/`SopDagNode`/`SopDagEdge` 不改。重申 release 渲染规则（HTML overlay + SVG interaction 共享 transform）—— 本 phase 只动 inspector/run-strip。

## Risks / Trade-offs

- **误动 DAG canvas** → 严格只改 `SopInspectorPanel`/`SopRunProgressStrip`；canvas 文件不进 diff。
- **inspector 段分隔改动误碰 copy/last-error 逻辑** → 只加 `.insp-sec` 容器/分隔,不动数据绑定。
- **release 渲染回归**（Phase 0 token 改 + 本 phase 不动 canvas）→ live 验 DAG node/ports/edges 同步 transform 无错位（Tauri release 硬规则）。

## Migration Plan

1. `SopInspectorPanel` `.insp-sec` sectioned。
2. `SopRunProgressStrip` token 收口。
3. 串行 build + live 验（含 DAG release 无错位 + drag-to-connect + run）。
4. 回滚：2 文件视觉改动,单 commit 可 revert。

## Open Questions

- 无（scope 明确：纯 inspector/run-strip 重皮肤）。
