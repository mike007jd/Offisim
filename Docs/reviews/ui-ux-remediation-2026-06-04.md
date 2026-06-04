# Offisim UI/UX Remediation — 2026-06-04

Checked at: 2026-06-04 23:44 NZST, with final release package rebuilt again after the last CSS hygiene fix.

Source audit: `Docs/reviews/ui-ux-audit-2026-06-04.md`

Release app verified:

`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

## Product Decisions

The desktop shell keeps the macOS native titlebar as canonical. V3 DNA now defines the renderer as a contained workbench under that native frame, rather than requiring a custom traffic-light/titlebar replica.

Studio is an Office editor, not a global destination. It remains reachable from Office and Studio, while Activity and Settings stay global.

Market does not fabricate populated listings in the release desktop app when no registry is configured. Card density was repaired in source and enforced by the drift gate; live populated registry verification still requires a configured registry.

## Repair Status

P0.1 Office notification grammar — closed. The standalone bell/count chrome was removed. Activity unread state is now a quiet affordance next to the scene cost readout, and opening it marks activity read.

P0.2 Studio scope — closed. Studio is hidden on Apps, Market, Personnel, Settings, and Activity. Command palette copy now labels Studio as an Office editor destination.

P1.1 Attention banner behavior — closed. The banner is still available at first Office exposure, but dismissing it persists for the current session and it does not reappear while navigating across Apps, Market, Personnel, Settings, Studio, and Activity.

P1.2 Shell authority — closed. The implementation and V3 DNA now agree on the native-titlebar plus contained renderer workbench model.

P1.3 Office scene framing — closed. The scene host reserves stable room for controls and the cost/activity readout. Camera framing was widened, and dense employee labels now use compact readable scene labels with full names preserved in accessible labels and the team dock.

P1.4 Market inventory density — source closed, runtime populated registry blocked. Normal cards are now 180px tall with a 60px cover band, and row height was tightened. The final release runtime showed the honest no-registry state; no configured registry was available to prove a populated catalog in the release app.

P1.5 Settings width constraint — closed. Settings panes now align to the 720px content column while preserving the left section nav.

P2.1 Personnel inspector tab grammar — closed. The inspector tabs now use the bordered V3 segmented-control container and keep all six tabs reachable.

P2.2 Prototype hygiene — closed. Superseded prototype files are marked as archived V3 references, and the UI drift gate skips warning noise only when that superseded marker is present.

## Evidence

Final Computer Use captures:

- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/01-settings-final-contained.jpeg`
- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/02-apps-final-empty-state.jpeg`
- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/03-office-final-scene-labels-read.jpeg`
- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/04-activity-final-from-office-readout.jpeg`
- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/06-studio-final-office-editor.jpeg`
- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/07-market-final-no-studio.jpeg`
- `Docs/reviews/ui-ux-remediation-2026-06-04/captures/08-personnel-final-inspector-tabs.jpeg`

Final release app process was launched with the exact current-worktree path and attached with Computer Use. The final Office validation attached to pid `46586`.

## Gates

Passed:

- `pnpm exec biome check ...` on touched renderer/script files after the final CSS hygiene change.
- `pnpm check:ui-hygiene`
- `pnpm check:ui-ux-drift`
- `pnpm --filter @offisim/desktop-renderer typecheck`
- `pnpm --filter @offisim/desktop-renderer build`
- `pnpm --filter @offisim/desktop build`
- `gitnexus detect_changes --scope all` completed and reported CRITICAL scope because the audit repair intentionally touched multiple UI surfaces. Follow-up context checks on `MarketSurface`, `WorkspaceAssistantThread`, and `OfficeStage` matched the expected Market, Apps/Chats, and Office UI flows.

Known warnings:

- Vite still reports existing large chunk warnings during renderer and desktop builds.
- Market populated runtime verification remains unavailable without a configured registry; the release desktop app intentionally shows an empty connected-state prompt instead of demo fixtures.
