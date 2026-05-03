## 1. Diagnostic ring buffer scaffolding

- [x] 1.1 Create `packages/ui-office/src/components/scene/office-2d-drop-diagnostic.ts` exporting (a) `DropAttemptDiagnostic` type per spec field list, (b) module-level ring buffer (cap 10), (c) `recordPointerDown(attemptId, downEvent, employeeId, sourceZoneId, dropTargetZoneIds)`, (d) `recordPointerMoveActive(attemptId, lastMoveEvent)` (only updates the last `move` summary; not every move), (e) `recordPointerUp(attemptId, upEvent, hitResult, dropTargetZoneIdsAtUp, outcome, emittedDropEvent)`, (f) `recordCancellation(attemptId, reason: 'leave' | 'escape' | 'lost-capture')`, (g) `exportLatest(): string` returning JSON `{ version: 1, capturedAt, attempts }`
- [x] 1.2 All recorder functions wrap their writes in `try { ... } catch { /* swallow */ }` so instrumentation can never break the drop pipeline
- [x] 1.3 Diagnostic snapshot SHALL NOT include employee `name`, `persona`, or `appearance` fields — only `employeeId` (verify by grepping the recorder for `name` references)

## 2. Wire diagnostic into pointer state machine

- [x] 2.1 In `useCanvasInteraction.ts`, generate an `attemptId = crypto.randomUUID()` on each `idle → pending` transition; pass through state refs
- [x] 2.2 Call `recordPointerDown(...)` at `idle → pending`, passing `dropTargetZoneIds` (from props) snapshot at that moment
- [x] 2.3 Call `recordPointerMoveActive(...)` once per `active`-phase pointer move (last write wins; throttled by phase, not by counter)
- [x] 2.4 Call `recordPointerUp(...)` at every PointerUp that ends a `pending` or `active` attempt; outcome maps to one of: `click` / `drop-emitted` / `drop-suppressed-source-zone` / `drop-suppressed-not-droppable` / `drop-suppressed-empty`
- [x] 2.5 Call `recordCancellation(...)` at PointerLeave or Escape during non-idle phase
- [x] 2.6 Confirm by code-read that the diagnostic recorder is the ONLY new side-effect in the existing PointerEvent handlers; phase-machine logic, drop-decision conjunction, and emit path are unchanged

## 3. Settings → Runtime "2D scene diagnostics" UI

- [x] 3.1 Add a `SettingsSection` in the existing Settings → Runtime tab body titled "2D scene diagnostics" with one button labeled `Export 2D drop diagnostic`
- [x] 3.2 Button click handler calls `exportLatest()` to get JSON text, then invokes a shared export helper `exportJsonText(filename, json)`
- [x] 3.3 Implement / locate `exportJsonText`: Tauri path uses `@tauri-apps/plugin-dialog` `save({ defaultPath: 'offisim-2d-drop-diagnostic-<ts>.json', filters: [{ name: 'JSON', extensions: ['json'] }] })` then `@tauri-apps/plugin-fs` `writeTextFile(...)`; web fallback uses `Blob([json], { type: 'application/json' })` + `URL.createObjectURL` + `<a download>`
- [x] 3.4 If Tauri capabilities are missing (`dialog:allow-save` / `fs:allow-app-write-recursive`), add them in `apps/desktop/src-tauri/capabilities/default.json` (same change); cross-check the dialog/opener/fs three-piece gotcha in `packages/ui-office/CLAUDE.md`
- [x] 3.5 If `web` runtime stubs `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-fs` (per existing vite alias polyfill), confirm the export still works (web fallback path); add stubs if missing
- [x] 3.6 Empty ring buffer case: button is always enabled; clicking with `attempts: []` still produces a valid JSON file (no error toast)

## 4. Reproduce regression with diagnostic + identify root cause

- [x] 4.1 Build release: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build` (serial per CLAUDE.md "Build order")
- [x] 4.2 Launch the precise current-worktree `.app` (do NOT `open -b com.offisim.desktop`); load a company that has at least 2 zones each with `deskSlots > 0` and at least one employee assigned
- [x] 4.3 In the release `.app`: dark theme + 2D — attempt one drag from zone A → zone B; record visual outcome (does drop visibly succeed?). Then click `Export 2D drop diagnostic`. Save JSON as `.live-verify/fix-release-employee-card-drop-target/dark-2d-attempt.json`
- [x] 4.4 Light theme + 2D — repeat 4.3, save as `.live-verify/fix-release-employee-card-drop-target/light-2d-attempt.json`
- [x] 4.5 Read both JSONs; cross-reference each attempt's `outcome` + `emittedDropEvent` + the snapshot fields. **Result**: both attempts emitted (`outcome: 'drop-emitted'`, `emittedDropEvent: true`, all three drop conditions held). None of Candidate A / B / C as originally framed. Real root cause is downstream of drop emission, in the render layer:
  - **Render-layer idle-override (Candidate D, discovered)**: `useSceneSnapshot.zoneEmployees` (`use-scene-snapshot.ts:76-78`) and `office3d-employees.tsx:80` both forced `agent.state === 'idle'` employees into the rest zone, ignoring `agent.workstationId`. Drop emit succeeded, `WorkstationAssignmentService` persisted `workstation_id`, but the next render frame placed the still-idle employee back at rest. Visual: drop appeared to fail.
- [x] 4.6 Document the identified root cause in a short summary file at `.live-verify/fix-release-employee-card-drop-target/root-cause.md` with: candidate label (A/B/C/multi), the JSON fields that prove it, and one sentence on the fix path

## 5. Fix the identified root cause

- [x] 5.1 ~~Candidate A~~ — not applicable (drop emit succeeded; no pointer-capture issue)
- [x] 5.2 ~~Candidate B~~ — not applicable (`sourceZoneId` and `dropTargetZoneIdsAtUp` both populated correctly)
- [x] 5.3 ~~Candidate C~~ — not applicable (`dropTargetZoneIdsAtUp` had 3 valid zones)
- [x] 5.4 **Candidate D (render-layer idle override)**: in `use-scene-snapshot.ts:76-78` and `office3d-employees.tsx:80`, change the conditional from `agent.state === 'idle' ? rest : resolveZone(agent)` to `(!agent.workstationId && agent.state === 'idle') ? rest : resolveZone(agent)`. Idle employees with explicit `workstationId` now render at the assigned zone; idle employees without an assignment continue to render at rest. Spec gains a new Requirement "Render layer SHALL honor explicit workstation assignment regardless of idle state" with three scenarios.
- [x] 5.5 Confirm the fix by code-read that no `// TODO`, no `// hack`, no `// fallback`, and no `if (releaseMode) ...` runtime branches were introduced

## 6. Verify fix in release `.app`

- [x] 6.1 Rebuild release `.app` per task 4.1 sequence
- [x] 6.2 dark + 2D — drag employee from zone A → zone B (`B.deskSlots > 0`); confirm employee visibly relocates and ceremony/orchestrator picks up the new workstation; export diagnostic, archive as `.live-verify/fix-release-employee-card-drop-target/dark-2d-fixed.json` (3 `drop-emitted` attempts, `emittedDropEvent === true`)
- [x] 6.3 light + 2D — repeat 6.2; archive as `.live-verify/fix-release-employee-card-drop-target/light-2d-fixed.json`
- [x] 6.4 Verify the three negative paths in dark + 2D: (a) drop on source zone is silent → `outcome: drop-suppressed-source-zone` ✓ (b) drop on zone with `deskSlots = 0` is silent → `zone-meeting` and `zone-library` both produced `outcome: drop-suppressed-not-droppable` ✓ (c) drop on empty canvas is silent → `outcome: drop-suppressed-empty` ✓
- [x] 6.5 Dev parity by code argument: the fix touches cross-runtime files (`use-scene-snapshot.ts`, `office3d-employees.tsx`) with no `if (releaseMode)` branches. Diagnostic JSON proves the conjunction logic and renderer respect `workstationId` in release; the same module runs unchanged in `vite dev`. No separate dev export collected (task 3.6 covers empty-buffer JSON shape).

## 7. Capability spec sync + CLAUDE.md / MEMORY.md

- [x] 7.1 Confirm `openspec validate fix-release-employee-card-drop-target --strict` passes — no errors
- [x] 7.2 Append a one-liner to `packages/ui-office/CLAUDE.md` "UI / Scene / 3D" section: "2D canvas employee→zone drop pipeline SSOT 是 `useCanvasInteraction` + `office-2d-hitmap.hitTestZone` + `useSceneSnapshot.dropTargetZoneIds`，契约见 `scene-2d-employee-drop` capability；diagnostic ring buffer 在 `office-2d-drop-diagnostic.ts`，导出入口在 Settings → Runtime"
- [x] 7.3 Update `MEMORY.md` Active Backlog: remove the `fix-release-employee-card-drop-target（待 propose）` entry now that it's archived; if other backlog items reference this one, update them
- [x] 7.4 Confirm `openspec/protocols-ledger.md` does not need updating — this change does not touch A2A / MCP / Better Auth / Tauri (only adds `dialog:allow-save` if missing, which is plumbing, not a protocol contract change) / LangGraph / SKILL.md
- [x] 7.5 If `dialog:allow-save` was added to `apps/desktop/src-tauri/capabilities/default.json` in task 3.4, verify the existing CSP↔CORS sync gate (`scripts/check-platform-tauri-origin-sync.mjs`) still passes (this script is only sensitive to `connect-src` / origin pairs, not `dialog:`, but cross-check)

## 8. Archive gate

- [x] 8.1 Three-check pass per `CLAUDE.md` OpenSpec Archive Gate: spec consistency (does `scene-2d-employee-drop` spec match what landed?) / tasks consistency (every `[x]` is genuinely done with live evidence?) / docs+memory sync (CLAUDE.md + MEMORY.md updated?)
- [x] 8.2 Run `/opsx:archive fix-release-employee-card-drop-target`
