# Offisim UI/UX Audit — 2026-06-04

Remediation status: closed in `Docs/reviews/ui-ux-remediation-2026-06-04.md`.

Checked at: 2026-06-04 23:15 NZST.

## Audit Scope

Product surface: current worktree release desktop app.

Release app verified:

`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

Flow audited with Computer Use:

1. Company selection and entry.
2. Office default state.
3. Apps / Chats.
4. Market empty catalog state.
5. Personnel empty and selected employee states.
6. Settings / Provider.
7. Studio.
8. Activity before and after dismissing the global attention banner.

Destination: local audit folder.

Screenshot evidence:

- `Docs/reviews/ui-ux-audit-2026-06-04/captures/01-company-entry.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/02-office-toast.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/03-office-default.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/05-apps-chats.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/06-market-empty.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/07-personnel-empty.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/08-personnel-inspector.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/09-settings-provider.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/10-studio.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/12-activity.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/13-activity-banner-dismissed.jpeg`

Transition-only captures:

- `Docs/reviews/ui-ux-audit-2026-06-04/captures/04-apps-loading.jpeg`
- `Docs/reviews/ui-ux-audit-2026-06-04/captures/11-activity-loading.jpeg`

All copied screenshots are 1249 x 768 Computer Use captures from `com.openai.sky.CUAService`.

Source evidence used:

- `Docs/UI_FRAMEWORK_STACK.md`
- `Docs/design/.v3-dna-brief.md`
- current renderer source under `apps/desktop/renderer`
- drift gate `scripts/check-ui-ux-drift.mjs`

Validation run:

- `pnpm check:ui-hygiene` — passed.
- `pnpm --filter @offisim/desktop-renderer typecheck` — passed.
- `pnpm --filter @offisim/desktop-renderer build` — passed, with large chunk warnings.
- `pnpm --filter @offisim/desktop build` — passed.
- `node scripts/check-ui-ux-drift.mjs --report` — report-only passed and found renderer drift plus stale prototype warnings.
- `pnpm check:ui-ux-drift` — intentionally fails while current renderer drift remains unresolved.

## User Goal And Accessibility Target

Primary user goal: run a dense desktop workbench where company state, office activity, employees, workspace files, conversations, marketplace inventory, and settings are scannable without SaaS-style page chrome or decorative empty space.

Accessibility target: keyboard-reachable controls, clear labels, visible focus, predictable navigation axes, readable dense layouts, and non-misleading state indicators.

## Strengths

Company entry is understandable. The selected company card, stats, office preview, and employee list give enough context before entering.

Office has the right raw ingredients: workspace rail, 3D/2D scene switch, live scene, team dock, conversations rail, and cost/tokens readout.

Apps / Chats has a conventional split layout. The left app rail, thread list, message pane, composer, attach button, and disabled send state are all recognizable.

Personnel has a useful master-detail model. Search, role filter, employee list, inspector tabs, editable profile fields, and save/reset/delete controls are discoverable.

Settings has a clear section nav and strong form primitives. Provider status, credential field, reveal action, model suggestions, route summary, and configuration selector are visible.

Activity is concise. Filters and event rows are easy to scan after the global attention banner is dismissed.

## UX Risks

1. **P0 — Office still uses bell/count notification chrome.**

   Runtime evidence: `03-office-default.jpeg` shows a bell button with a red `53` count floating over the Office scene. This directly conflicts with the V3 rule that notification state should be quiet and scene-native, not generic app chrome.

   Source evidence: `apps/desktop/renderer/src/surfaces/office/OfficeStage.tsx` imports `Bell`; `office.css` defines `.off-stage-notif-count`.

   User impact: the primary surface reads like generic web app chrome instead of an office workbench. The count also competes with the scene and cost readout.

   Fix direction: remove the separate bell/count button; keep unread state as a quiet dot near the scene cost readout and route details to Activity.

2. **P0 — Studio is globally exposed even when the current surface is not Office.**

   Runtime evidence: `06-market-empty.jpeg`, `08-personnel-inspector.jpeg`, `09-settings-provider.jpeg`, and `12-activity.jpeg` all show the Studio icon in the top-right utility group.

   Source evidence: `UTILITY_NAV` includes Studio globally and `IconBar` renders utility entries without Office-only filtering.

   User impact: Studio looks like a global workspace mode rather than an Office editor. This weakens navigation hierarchy and adds irrelevant keyboard stops on non-Office surfaces.

   Fix direction: show Studio only on Office and Studio. Keep Activity and Settings global.

3. **P1 — The global attention banner interrupts every surface.**

   Runtime evidence: `03-office-default.jpeg`, `05-apps-chats.jpeg`, `06-market-empty.jpeg`, `08-personnel-inspector.jpeg`, `09-settings-provider.jpeg`, `10-studio.jpeg`, and `12-activity.jpeg` all show `2 conversations need attention` plus two long Resume pills across the top.

   User impact: every task starts one row lower and inherits the same unrelated urgency. In dense desktop workflows, this should be a localized or collapsible attention state, not a permanent cross-surface banner.

   Fix direction: keep the banner dismissible as it is now, but persist dismissal for the session or collapse it into Activity / conversations state after first exposure.

4. **P1 — The app shell does not match the V3 desktop HUD frame.**

   Runtime evidence: `01-company-entry.jpeg` and `03-office-default.jpeg` show a normal native titlebar plus a full-window light webview. The V3 source asks for a contained app card/titlebar model.

   User impact: the first viewport feels like a standard desktop webview, not a distinct Offisim workbench. This is a brand and hierarchy issue, not only styling.

   Fix direction: either implement the V3 renderer titlebar/card frame or update V3 DNA to make the native titlebar model canonical.

5. **P1 — Office scene has visible cropping and overlapping state.**

   Runtime evidence: `03-office-default.jpeg` shows the 3D scene clipped at the bottom and right. Employee labels are partially cut, the team dock overlays the lower edge, and the cost readout floats on top of the scene.

   User impact: the scene is the core object of the product, but current framing makes it feel like a viewport crop rather than a stable workspace.

   Fix direction: give the scene a stable aspect/framing rule and reserve a non-overlapping lane for team dock and cost/activity state.

6. **P1 — Settings content still sprawls across wide desktop space.**

   Runtime evidence: `09-settings-provider.jpeg` shows provider forms stretched across most of the main pane.

   Source evidence: `.off-set-pane` is missing the V3 `max-width: 720px` constraint.

   User impact: form fields and helper text become harder to associate, especially at wide widths or higher zoom.

   Fix direction: constrain settings content to a 720px column while preserving the left section nav.

7. **P1 — Apps / Chats empty state and composer are mechanically clear but weakly guided.**

   Runtime evidence: `05-apps-chats.jpeg` shows `No messages` and a disabled Send button. The composer placeholder repeats the selected thread title, which is long and not very helpful.

   User impact: the screen is understandable, but it does not help the user decide the next action. The disabled Send state has no visible reason beyond an empty composer.

   Fix direction: use a shorter placeholder, preserve the selected thread context in the header, and make the first-action path clearer.

8. **P1 — Market populated inventory density is still unverified at runtime and failing in source.**

   Runtime evidence: `06-market-empty.jpeg` only proves the disconnected catalog empty state. It does not prove populated card behavior.

   Source evidence: `market.css` still defines normal cards at 200px high with an 88px cover band, above the V3 inventory density target.

   User impact: once a registry is connected, the marketplace is likely to drift toward store browsing rather than dense inventory comparison.

   Fix direction: repair card sizing before adding or validating populated registry flows.

9. **P2 — Personnel inspector tabs do not use the V3 chip/container grammar.**

   Runtime evidence: `08-personnel-inspector.jpeg` shows loose inspector tabs in a horizontal row.

   Source evidence: `.off-pers-insp-tabs` is missing the bordered 30-36px container grammar.

   User impact: the inspector feels like a separate tab system and loses cross-surface consistency with other segmented controls.

   Fix direction: wrap the inspector tabs in the shared chip/container treatment while preserving all six tabs and keyboard focus.

10. **P2 — Stale prototypes still contain retired patterns.**

    Source evidence: Activity, Workspace, and Market prototypes still contain retired `--fs-2xl`, `--r-xl`, `.nb`, `i-bell`, and hero language.

    User impact: future implementation work may copy old visual grammar and reintroduce regressions. Office bell/count appears to be that kind of drift.

    Fix direction: retire stale prototypes or mark them as superseded by V3 at the top of each file.

## Accessibility Risks

1. The global attention banner creates repeated screen-reader and keyboard noise across unrelated tasks. It can be dismissed, but before dismissal it appears on every audited surface.

2. Studio's global icon adds an irrelevant keyboard stop outside Office.

3. Office scene labels and employee pills are visually small and partially clipped in the default captured viewport. This is a readability and zoom-resilience risk.

4. The Apps composer has a disabled Send button without a visible explanatory state. The empty composer is inferable, but not explicit.

5. Settings row sprawl weakens label-field-helper relationships at wide widths.

6. Screenshot audit cannot prove full accessibility compliance. Keyboard order, focus trap behavior, contrast ratios, reduced-motion behavior, and screen-reader announcements still need targeted verification.

## Step Health

1. Company entry — medium/high. The flow is clear and scannable; shell framing remains unresolved against V3.

2. Office default — poor. It has the right product ingredients, but bell/count chrome and scene cropping are direct UX regressions.

3. Apps / Chats — medium. Layout is clear; empty state and composer guidance need tightening.

4. Market empty state — medium/high. The disconnected registry state is understandable. Populated inventory remains unverified and source drift suggests density issues.

5. Personnel empty state — medium/high. The empty inspector prompt is clear.

6. Personnel selected employee — medium. Editing is discoverable; tab grammar and dense form hierarchy need repair.

7. Settings Provider — medium. Content is understandable but too wide for the intended desktop scan pattern.

8. Studio — medium/poor. The tool itself is legible, but its global exposure is the product-boundary problem.

9. Activity — medium/high after banner dismissal. Filters and event list are clear; before dismissal, the global attention banner weakens focus.

## Repair Backlog

### P0.1 Office Notification Grammar

Owner surface: Office.

Files:

- `apps/desktop/renderer/src/surfaces/office/OfficeStage.tsx`
- `apps/desktop/renderer/src/surfaces/office/office.css`
- `apps/desktop/renderer/src/app/ui-state.ts`

Required change:

- Remove the top-right `Bell` button and numeric `.off-stage-notif-count`.
- Keep unread state, but express it as a quiet dot near the scene cost readout.
- Clicking the affordance still opens Activity and marks the latest activity timestamp read.
- Rename comments away from "bell badge" language.

Acceptance:

- `rg -n "Bell|off-stage-notif-count|bell badge|Bell badge" apps/desktop/renderer/src` returns no Office notification chrome hits.
- Release `.app` Office screenshot shows no bell/count chrome.
- Activity remains reachable from the notification affordance and from the top utility iconbar.

### P0.2 Studio Scope

Owner surface: shell/navigation.

Files:

- `apps/desktop/renderer/src/design-system/shell/IconBar.tsx`
- `apps/desktop/renderer/src/app/nav-registry.ts`
- `apps/desktop/renderer/src/app/CommandPalette.tsx`

Required change:

- Render Studio in the top iconbar only while the current surface is `office` or `studio`.
- Preserve Activity and Settings as global utility entries.
- If command palette exposes Studio globally, label it as an Office editor destination.

Acceptance:

- Office topbar: Activity / Settings / divider / Studio.
- Workspace, Market, Personnel, Settings, Activity topbar: Activity / Settings only.
- `studio` route still works after Lifecycle custom-company flow opens Studio.

### P1.1 Attention Banner Behavior

Owner surface: app shell / conversations.

Required change:

- Keep the banner dismissible.
- Persist dismissal for the current session, or collapse the banner into Activity/conversation state after the first exposure.
- Avoid pushing every surface down for the same repeated alert.

Acceptance:

- After dismissing once, navigating Office, Apps, Market, Personnel, Settings, Studio, and Activity does not restore the same banner in the same session.
- Activity and conversation surfaces still expose the pending items.

### P1.2 Shell Authority

Owner surface: app frame / desktop window.

Files:

- `apps/desktop/renderer/src/design-system/shell/AppFrame.tsx`
- `apps/desktop/renderer/src/design-system/shell/shell.css`
- `apps/desktop/src-tauri/tauri.conf.json`
- `Docs/design/.v3-dna-brief.md`

Required change:

- Pick one canonical shell. Current audit recommends implementing V3: renderer titlebar, contained app card, and dark outside / light inside frame.
- If native titlebar is intentionally preferred, update V3 DNA so source of truth matches implementation.

Acceptance:

- Design source and Tauri implementation describe the same window model.
- Release `.app` first viewport matches the chosen model.
- Topbar remains 54px and surface navigation remains unchanged.

### P1.3 Office Scene Framing

Owner surface: Office.

Required change:

- Reserve stable space for the scene, team dock, conversations rail, and cost/activity readout.
- Prevent employee labels, desks, and scene edges from being clipped at the default release window size.

Acceptance:

- `03-office-default` equivalent release screenshot shows the full intended office working area without label clipping or overlay collisions.
- 2D and 3D modes both keep a stable viewport.

### P1.4 Market Inventory Density

Owner surface: Market.

Files:

- `apps/desktop/renderer/src/surfaces/market/market.css`
- `apps/desktop/renderer/src/surfaces/market/MarketCard.tsx`

Required change:

- Reduce `.off-mkt-card` height from `200px` to `<= 180px`.
- Reduce `.off-mc-cover` from `88px` to about `60px`.
- Keep normal cards icon-led, not hero-image-led.

Acceptance:

- At 1249 x 768 or 1440 x 900 release `.app`, Market shows dense populated listings without overlap.
- Title, summary, kind badge, install state, creator, rating, and installs remain visible.
- `rg -n "height: 200px|height: 88px" apps/desktop/renderer/src/surfaces/market/market.css` returns no active Market card sizing hits.

### P1.5 Settings Width Constraint

Owner surface: Settings.

Files:

- `apps/desktop/renderer/src/surfaces/settings/settings.css`

Required change:

- Constrain `.off-set-pane` to `max-width: 720px` inside the content pane.
- Keep left nav at 244px.
- Keep section cards single-column unless a section has a specific dense grid need.

Acceptance:

- Provider, Runtime, MCP, and External Employees panes align to the same 720px content column.
- Wide release window does not stretch form rows across the entire content area.
- No horizontal overflow at minimum window width.

### P2.1 Personnel Inspector Tab Grammar

Owner surface: Personnel.

Files:

- `apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx`
- `apps/desktop/renderer/src/surfaces/personnel/personnel.css`

Required change:

- Wrap inspector tabs in V3 container grammar: 30-36px control height, 1px border, `--r-md`, 3px padding, surface background.
- Inner triggers stay 28-30px high with `--r-sm` radius.
- Preserve horizontal overflow behavior for narrow inspector widths.

Acceptance:

- Tabs visually match other chip/segmented controls.
- All six inspector tabs remain keyboard reachable.
- Focus ring remains visible on each tab trigger.

### P2.2 Prototype Hygiene

Owner surface: design docs.

Files:

- `Docs/design/offisim-activity-prototype.html`
- `Docs/design/offisim-workspace-prototype.html`
- `Docs/design/offisim-market-prototype.html`
- `scripts/check-ui-ux-drift.mjs`

Required change:

- Add a stale-prototype warning or update stale prototypes to V3 rules.
- Keep renderer drift as a failing gate and prototype drift as warning until the stale files are retired or refreshed.

Acceptance:

- Retired patterns in stale prototypes are removed or clearly marked as superseded.
- Future implementation agents can tell which prototype is canonical without reading this audit.

## Gate Added

Implemented: `scripts/check-ui-ux-drift.mjs`, exposed as `pnpm check:ui-ux-drift`.

The gate fails on active renderer hits for:

- `Bell` in Office notification chrome.
- `.off-stage-notif-count`.
- global topbar Studio outside Office.
- Market normal card heights over 180px.
- Settings pane missing `max-width: 720px`.
- Personnel inspector tabs not using container grammar.

It emits docs-only warnings for stale prototype references in Activity, Workspace, and Market prototypes:

- `--fs-2xl`
- `--r-xl`
- `.nb`
- `i-bell`
- `hero` on dense workbench surfaces

Current gate result:

- Renderer drift: 11 failures.
- Stale prototype warnings: 62 warnings.

## Remaining Verification Limits

This audit proves the release app rendered and was interactively walked with Computer Use. It does not prove:

- full keyboard order across every control;
- screen-reader announcements;
- contrast ratios from computed styles;
- reduced-motion behavior;
- populated Market registry behavior, because the audited release state had no registry connected.
