# 2026-06-17 Release Long-Run Offisim Test

Checked at: 2026-06-17 12:43 NZST

## Scope

- App: current worktree release `Offisim.app`
- Provider setup path: Settings UI
- Provider/model: z.ai, `glm-5.2`
- Task path: desktop chat UI, not harness/core direct execution
- User task: ask Maya Lin to complete a polished 3D Connect Four game

## Result

Not fully delivered.

Offisim created a real artifact at `/Users/haoshengli/offisim-verify/connect-four-3d`
with `index.html`, `styles.css`, `game.js`, and `README.md`. The artifact is not
an empty mock. It implements a 7x6 board, gravity drops, alternating turns, win
detection, score display, keyboard/mouse/touch handling, and Three.js rendering.

The generated game still failed verification:

- `file://` launch is blocked by browser CORS for the ES module script, while
  the README says double-clicking `index.html` is a supported simplest path.
- On an HTTP static server, a vertical win is detected and the DOM shows
  `Red Wins!`, but the result overlay is placed inside the footer. The visible
  overlay height is only the footer area, so the `Play Again` button is below
  the viewport and cannot be clicked. This matches the employee's own failed
  Playwright check against `#play-again-btn`.
- The README claims "No build step" and "self-contained static HTML/CSS/JS",
  but runtime depends on loading Three.js from jsDelivr.

## Product / UI Issues Observed

- The chat UI does not keep a normal user informed during a long task. The
  visible conversation only showed a generic assignment sentence, while real
  work was hidden behind tool chips and Activity Log rows.
- When the employee's verification failed, the failure did not get summarized
  back into the conversation. The office view returned to IDLE without a clear
  final answer, success/failure status, or next action.
- Activity Log rows show `MCP bash failed` by default. The actual command,
  timeout, and stderr are only visible after expanding raw payload.
- A `chmod +x` command was labeled as a destructive sensitive approval, which is
  too strong for the operation and blocks long-running work with misleading
  language.
- The attention/review banner navigated to an old conversation instead of
  clearly opening the active failed task.
- Session/thread management is missing obvious operations: no visible delete
  action, no right-click/context menu, and no per-thread action menu for cleanup
  or archival. This makes failed or accidental sessions hard for users to
  recover from and clutters the product state.
- Company management has the same cleanup gap. After clearing local app data,
  the first release launch seeded an `R&D Company` automatically. The company
  list exposes Archive and Rename, but no hard delete or visible cleanup action.
  Keeping data clean required direct local database cleanup after creating the
  intended fresh company.
- Long Chinese input through the release UI path was mangled in one attempt,
  producing a truncated task. The UI needs reliable multilingual entry and
  paste behavior for long prompts.
- Text entry reliability is still weak in product-critical forms: during fresh
  company creation, normal text typing did not update the company name field
  until the value was set through the accessibility setter.

## Cleanup Performed

- Removed the earlier invalid harness-based test artifacts.
- Removed externally written provider profile/secret data before the corrected
  UI run.
- Removed the accidental `workspace-3d` directory created by the truncated
  Chinese prompt.
- Kept only the corrected release-UI artifact directory for traceability until
  the requested app data reset.
- After the user-requested reset, local app support/cache/WebKit/preference
  data and the external verification workspace were cleared, a new release
  `.app` was built, and `Release QA Company` was created from the release UI.
  Follow-up verification showed zero chat threads, zero graph threads, zero pi
  messages, zero task runs, and an empty workspace.

## 2026-06-17 UX Cleanup Fix Verification

Implemented and verified the shell-level cleanup UX:

- Conversation rows and chat header expose `Rename`, `Archive`, and `Delete`.
  Row `...`, row right-click menu, and header `...` were verified in the
  release `.app`.
- Company rows and selected company header expose `Rename`, `Archive`, and
  `Delete`. Delete confirmation explains that company, employees, projects,
  conversations, and local run history are removed while user workspace folders
  are not silently deleted.
- Conversation deep delete clears messages, runtime events, tool/audit rows,
  approvals, deliverables, task/tool runs, graph rows, and chat rows.
- Company deep delete clears company, projects, employees, zones, layouts,
  prefab instances, conversations, run/activity history, settings keys tied to
  the company id, and Offisim-managed workspace directories.
- Deleting the final company leaves the release app in the empty company state
  with a visible `Create company` action; no default company is auto-seeded.
- Activity Log now promotes tool name, command/args, timeout, and error summary
  before the raw payload; copy buttons are visible on summarized fields.
- Run activity strip now presents a readable current/failure summary instead of
  opaque tool chips.
- Blocked attention banner uses exact company/project/thread labels and the
  blocked action reads `Review failure`; verified to open the correct failed
  thread in release.
- Long mixed Chinese/English/model-key style text was pasted into company/chat
  inputs without truncation in the release UI.

Final release verification:

- `pnpm validate` passed. Provider freshness check reported only existing
  tombstone warnings for Anthropic default entries.
- `pnpm --filter @offisim/desktop build` produced
  `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- Release `.app` created and deleted `QA-DeepDelete-20260617` via UI; database
  counts for company/projects/employees/zones/layouts/prefabs/settings were all
  zero afterward.
- Release `.app` deleted the last remaining company through UI and stayed in
  empty company state. Final database counts for companies, projects,
  employees, zones, office layouts, prefab instances, threads, messages,
  runtime events, deliverables, MCP audit log, task runs, and tool calls were
  all zero. Keyword scan for QA ids/names returned no rows. Workspace directory
  scan returned no company workspace directories.

Remaining observation:

- Computer Use can read the Offisim accessibility tree for the release app, but
  action calls intermittently return `Computer Use is not active for 'Offisim'`
  immediately after a successful snapshot. Release verification therefore used
  Computer Use snapshots plus foreground screenshots and mouse fallback for
  clicks.
