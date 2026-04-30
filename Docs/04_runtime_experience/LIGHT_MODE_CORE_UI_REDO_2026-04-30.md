# Light Mode And Core Workspace UI Redo - 2026-04-30

## Scope

This delivery treats the April 30 UI feedback as a shared-system failure, not as isolated color defects. The fixed scope covers the app shell, light theme tokens, Office scene, Company Portal, Activity, Settings, SOP, Market, Personnel, Studio, Workspace/Chat, and Kanban product shape.

No data migration or production rollout was required.

## Comment Coverage

| Comments | Root issue | Resolution |
| --- | --- | --- |
| 1, 4, 5, 6, 7, 12, 14, 15, 16, 17, 19, 21, 22, 24 | Light mode had dark leftovers, low contrast, and overexposed 3D surfaces. | Shared primitives and page surfaces now use semantic tokens. Light 3D scene materials, fog, floor, and postprocessing were retuned. |
| 2, 3, 8, 9, 29 | Top shell was crowded, semantically confusing, and nav shifted between routes. | Header uses fixed slots, stable center nav, true company switcher, simplified SOP/session control, and reduced Office tool actions. |
| 10, 11 | Activity filters wrapped/clipped text. | Filters now use stable single-row controls with non-wrapping event and actor selects. |
| 13 | Settings overused large cards and long explanatory copy. | Settings are flatter form groups with shorter status text, readable save bar, and compact runtime/provider/MCP/vault sections. |
| 18, 20 | Personnel filters and detail space were inefficient. | Role tags moved into a Role filter select; detail/edit areas use the center space more directly. |
| 23, 25, 26 | Office team spacing, Workspace panel, and Chat input were cramped or hidden. | Team rows have clearer spacing; Workspace install preview defaults compact; Chat keeps the composer visible. |
| 27 | Studio default mode and light mode were wrong. | Studio defaults to zone overview with `Add Zone`; assets show only after clicking a zone `Edit`. Studio colors now follow theme. |
| 28 | Kanban was exposed as a separate overlay instead of a task-linked board. | Kanban is now a collapsible Project Board tray below the top UI, backed by the existing kanban store. |

## Product Outcomes

- Light mode is now first-class across the marked routes instead of relying on dark-mode classes plus global overrides.
- The shell no longer changes the primary nav position when switching between Activity, Settings, SOP, Market, and Personnel.
- The company name control behaves like a switcher: it opens company choices and management, instead of looking like a dropdown but acting like a direct portal jump.
- Office toolbar actions are narrower and do not include Add Employee in the overflow; staffing belongs in Team/Personnel.
- Studio opens in the expected zone-management mode and only expands to asset placement after an explicit zone edit.
- Project Board no longer has a standalone meaningless entry point. It is invoked from work context and renders as a tray.

## Verification

Commands passed:

- `pnpm --filter @offisim/ui-core build`
- `pnpm tokens:check`
- `pnpm tokens:lint-hex`
- `pnpm --filter @offisim/ui-office typecheck`
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/web typecheck`
- `pnpm --filter @offisim/web build`
- `pnpm --filter @offisim/desktop build`

Browser validation used `http://127.0.0.1:5176/` with Playwright at `1385x741`, `1033x741`, narrow viewport, and dark-mode spot checks. The final report produced 19 screenshots and zero visible dark UI hits for the covered pages.

Evidence:

- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/report.json`
- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/01-office-light-1385.png`
- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/04-kanban-tray-cleanup-light.png`
- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/07-settings-provider-light-1385.png`
- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/10-sop-light-1385.png`
- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/12-personnel-list-light-1385.png`
- `Docs/04_runtime_experience/evidence/2026-04-30-light-ui-redo/14-studio-zone-overview-light-1385.png`

Desktop release validation used the built app:

- `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Verified by Computer Use after `pnpm --filter @offisim/desktop build`.
- Paths checked: create company, switch to Light in Settings Runtime, Office 3D, Settings Provider/Runtime, SOPs, Studio zone overview, and Studio zone edit/asset placement mode.

Known non-blocking output:

- Vite still reports existing dynamic/static import chunk warnings and large chunk warnings.
- Market error route intentionally shows the unavailable-state UI when the local marketplace service is not running.

