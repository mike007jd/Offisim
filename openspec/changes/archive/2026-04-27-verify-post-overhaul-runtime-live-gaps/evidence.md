## Evidence Log

### Carried Residual Gates From Archived Change

Source: `openspec/changes/archive/2026-04-26-consolidate-post-overhaul-runtime-followups/tasks.md`.

Unique remaining gates:

- Missing direct-chat target fault injection: archived task `2.6`.
- Single-bubble variants: archived tasks `3.1`, `3.5`, `8.2`, `9.3`.
- Release CSP negative path: archived tasks `4.6`, `9.2`.
- SOP dispatcher convergence and negative recursion diagnostics: archived tasks `5.6`, `5.7`, `8.3`, `9.4`.
- Desktop release self-authoring happy/cancel/rejection/mismatch paths: archived tasks `6.9`, `6.11`, `9.5`, `9.6`, `9.7`.
- Archive consistency gates: archived tasks `10.1`, `10.2`.

Already verified during the previous closeout and not repeated here:

- Web direct-target matrix for Alex Chen, Maya Lin, and Sophie Park.
- Web self-authoring rejection cards for reserved `offisim.*`, unknown field, and missing `description`.
- Web `hi` round-trip single assistant bubble with reasoning and final content.

### Baseline

- `openspec validate verify-post-overhaul-runtime-live-gaps --strict`: passed.
- `pnpm typecheck`: passed, `26 successful, 26 total`.
- `pnpm exec biome check` on the 24 touched TS/TSX runtime files: passed, no fixes applied.

### Web Runtime Gates

- Web runtime started on `http://127.0.0.1:5176/` with `pnpm --filter @offisim/web dev --host 127.0.0.1 --port 5176`.
- Browser runtime debug bridge present after company creation: `sendMessage`, `abortExecution`, `eventBus`, `repos`, and `getSceneState`; `getSceneState().employeeCount === 8`.
- Browser console/page warnings during live checks were limited to Chromium WebGL `ReadPixels` GPU-stall warnings; no page errors were observed.

Missing direct-chat target fault injection:

- Invoked `window.__OFFISIM_DEBUG__.sendMessage('fault injection: missing direct target', { entryMode: 'direct_chat' })` without `targetEmployeeId`.
- Page surfaced typed error `Direct chat target missing — selectedEmployeeId not propagated` with Retry/Error controls.
- Assistant message count stayed `0`; no Alex assistant fallback was rendered. `Alex Chen` appeared only in the team roster.

Chat single-bubble variants on web:

- Normal `hi` through the real chat input: `assistantCount: 1`, bubble label `Boss`, reasoning fold present, final content `Hi! I'm the Boss AI coordinator. How can I help you today?`.
- Abort mid-stream through the real chat input plus debug abort: `assistantCount: 1`, bubble label `Boss`, reasoning fold present, final content `Run interrupted before final response.`, terminal label `Interrupted`.
- Tool-call mid-stream through Maya direct chat: `assistantCount: 1`, bubble label `Employee`, reasoning fold present, create/retry interaction visible. The live run used a `create_skill_from_scratch` prompt and confirmed the waiting interaction no longer leaves only a floating card without an assistant bubble.

SOP dispatcher web/live convergence:

- Inserted web runtime SOP `Complex Live DAG 1777207930358` with 8 mixed-dependency SOP steps.
- Sent normal chat command `Run the SOP: Complex Live DAG 1777207930358`.
- Runtime entered `boss_summary` after `136.7s`.
- Node path included `boss -> manager -> pm_planner -> step_dispatcher` and five dispatcher batches before `boss_summary`; this matches the 8 SOP nodes being grouped into five dependency batches.
- UI showed `8 participants · 8 dispatched`; captured `plan.step.started/completed` batch indices `[0, 1, 2, 3, 4]`.
- `sop.dispatcher.recursion_limit` events: `[]`.

SOP dispatcher debug harness:

- Complex 8-step synthetic DAG dispatched as batches `[[0,1], [2,3], [4,5], [6], [7]]`, completed steps `[0,1,2,3,4,5,6,7]`, final route `boss_summary`, dispatcher entry count `5`, recursion event count `0`.
- Forced recursion negative harness used a fake graph that emitted four `step_dispatcher` entries then threw `GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition.`
- Diagnostic fired before the surfaced error on both event bus and repo insert with payload `{ planId: 'plan-complex-8-dag', stepCount: 8, completedSteps: [0,1,2], pendingSteps: [3,4,5,6,7], recursionDepth: 4 }`.

### Desktop Release CSP Gates

- Release desktop build command: `pnpm --filter @offisim/desktop tauri build`.
- Build output launched with `/usr/bin/open -n apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- Computer Use attached to the release app as `com.offisim.desktop`; the app URL was `tauri://localhost`, not a dev webview.

Release CSP allowed paths:

- Platform API was running on `localhost:4100` with `pnpm --filter @offisim/platform dev`.
- In release `.app`, the Market tab loaded seeded platform listings including `Sample Marketing Strategist`, `Research Summary`, and `Research Pipeline`.
- Settings -> External Employees showed the existing `Codex QA A2A` entry with URL `http://localhost:4100`.
- Market install flow opened `Sample Marketing Strategist`, fetched the review package modal, and reached the local install pipeline. The final install attempt failed with a typed duplicate-row database error: `Installation Failed: error returned from database: (code: 2067) UNIQUE constraint failed: installed_packages.company_id, installed_packages.package_id, installed_packages.version`. This is not CSP; it proves release CSP allowed the platform/package metadata path and exposes an existing install idempotency issue outside this verification gate.

Release CSP non-allowlisted negative path:

- Settings -> External Employees -> Connect agent -> Discover against `http://localhost:43177` surfaced `We could not reach the agent card URL. Network error: Load failed`.
- A controlled HTTP server was then started on `127.0.0.1:43177` serving `/.well-known/agent-card.json`.
- Retrying Discover in the same release `.app` produced the same typed `Network error: Load failed`.
- The controlled server logged no request, proving the release app blocked the non-allowlisted port before a network request reached the local server. The CSP allowlist was not relaxed.

### Desktop Release Chat Evidence And Blockers

Partial single-bubble evidence captured before the release window became unavailable:

- Normal release desktop team-chat `hi` completed in `104.7s` and returned to Ready with exactly one right-rail assistant bubble labeled `Boss`, final text `Task processing complete.`
- Release desktop abort used a long runtime-planning prompt, then the StatusBar `Stop` control while `Manager is calling gpt-5.4`; the run returned to Ready with one assistant terminal bubble: `Run interrupted before final response.`, terminal status `Interrupted`, and no Retry/error banner.
- This found and fixed a real desktop affordance gap: the right sidebar can hide `PipelineProgress`, so `StatusBar` now exposes the runtime abort button while a run is active.

Earlier tool-call/self-authoring path failure, now superseded:

- Maya direct-chat attempts to trigger `create_skill_from_scratch` produced a generic `SKILL.md` deliverable instead of the create-skill confirmation preview.
- A second prompt explicitly said to call `create_skill_from_scratch`; the assistant still produced a generic `SKILL.md` deliverable and said `当前环境里我不能实际调用 create_skill_from_scratch`.
- Recent `agent_events` for these Maya runs had `toolRounds: 0`, proving the model did not enter the tool-call path.
- `packages/core/src/agents/employee-builder.ts` was tightened so skill mutation requests must call the matching tool and must not claim available tools cannot be called.
- Superseded by the later release verification below: the rebuilt release app reached the create preview, confirmed the create action, wrote the vault file, and inserted the `skills` row with `source_kind='self-authored'`.

### Desktop Release Window / Computer Use Blocker

After rebuilding and relaunching the release `.app`, Computer Use could no longer attach to `com.offisim.desktop`:

- `mcp__computer_use__.get_app_state({ app: "com.offisim.desktop" })` first returned `Apple event error -10005: cgWindowNotFound`, then later timed out after `120s`.
- `mcp__computer_use__.click` by coordinate also timed out after `120s`.
- System logs showed `No windows open yet`, macOS StateRestoration `Unable to find className=(null)`, and WebKit reporting a `viewWindow` that was `window visible 1` but `window occluded 1`.
- `System Events` reported no AX windows for the Offisim process, while `CGWindowListCopyWindowInfo` still showed an onscreen Offisim window at `{ X = 180, Y = 98, Width = 1152, Height = 721 }`.
- `screencapture -l <OffisimWindowId>` failed with `could not create image from window`.
- A targeted release fix now explicitly restores the main Tauri window from the single-instance handler, setup, and page-load finished hook, but the release app still needs a fresh successful Computer Use attach before any remaining desktop gate can be considered verified.

This was a release desktop blocker under the repo policy. A later release launch recovered enough for tasks `3.4`, `4.1`, and `4.2` to be verified. The blocker reappeared after subsequent release rebuilds, so desktop tasks `3.5` and `4.3`-`4.5` stay unchecked.

### Desktop Self-Authoring Database Blocker, Superseded

The release desktop database initially had not applied the new self-authored source-kind migration:

- Live DB path: `$HOME/Library/Application Support/com.offisim.desktop/offisim.db`.
- `_sqlx_migrations` still ends at `34|projects workspace root binding`.
- `.schema skills` still contains `source_kind TEXT NOT NULL CHECK (source_kind IN ('authored','installed','forked','synthesized'))`.
- The release binary contains the embedded migration text for version `35`, but because the release runtime is currently not Computer-Use-verifiable, the DB migration/application path cannot be claimed complete.

This was superseded by the later release verification below; task `4.2` is now checked.

### Desktop Release Self-Authoring Verification

Release app and migration recovery:

- Rebuilt with `pnpm --filter @offisim/desktop tauri build` and launched `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- Computer Use attached to the release app as `com.offisim.desktop`, pid `3443`, URL `tauri://localhost`.
- Live DB path: `$HOME/Library/Application Support/com.offisim.desktop/offisim.db`.
- `_sqlx_migrations` showed `35|skills self-authored source kind`.
- `.schema skills` showed `source_kind TEXT NOT NULL` without the old enum `CHECK`.

Desktop single-bubble and self-authoring happy path:

- Normal desktop `hi` and desktop abort already had one terminal assistant bubble each from the earlier release evidence in this file.
- Maya direct-chat tool-call path was then verified in the release app with the selected employee `Maya Lin` (`5226cacc-9d3f-4bca-b55d-326fc79549b6`).
- The release UI rendered one interaction surface: `INPUT NEEDED`, `Create new skill from Maya Lin`, action `Create skill`, scope `Employee: Maya Lin`, and slug `desktop-live-happy-20260427100945`.
- The preview contained a clean `SKILL.md` body with `version: 0.1.0`:
  - `name: desktop-live-happy-20260427100945`
  - `description: Desktop release clean happy path verification.`
  - heading `Desktop Live Happy 20260427100945`
- Clicking the real release `Create skill` button completed the interaction; the UI showed `Skill created.` and returned to Ready.
- DB evidence: `skills` row `sk_1777241438937_d6qn1xyg|desktop-live-happy-20260427100945|desktop-live-happy-20260427100945|0.1.0|self-authored|5226cacc-9d3f-4bca-b55d-326fc79549b6|companies/fe24a509-d505-4bb9-9107-b67e08521996/employees/maya-lin/skills/desktop-live-happy-20260427100945/SKILL.md`.
- Interaction cleanup evidence: `active_thread_interactions` count for `desktop-live-happy-20260427100945` was `0`.
- Vault evidence: `$HOME/Library/Application Support/com.offisim.desktop/vault/companies/fe24a509-d505-4bb9-9107-b67e08521996/employees/maya-lin/skills/desktop-live-happy-20260427100945/SKILL.md` exists with the expected frontmatter/body.

Runtime fixes discovered during the release self-authoring run:

- SQL preload was added to `apps/desktop/src-tauri/tauri.conf.json` so release migration `35` applies to `sqlite:offisim.db`.
- Historical migration checksum drift was fixed by restoring old `source_kind` checks in the immutable `031`/`025` migrations and adding a new migration to remove the enum check.
- Provider-level `toolChoice` was added, but the live provider still returned `toolRounds: 0`; an explicit skill-tool command path was added for direct chat prompts that explicitly name `create_skill_from_scratch`.
- The explicit command parser now accepts `create_skill_from_scratch`, `create skill from scratch`, `create-skill-from-scratch`, and `createskillfromscratch`, because Computer Use typing in release dropped underscores during one live attempt.
- The inline frontmatter parser now preserves unknown/reserved/missing fields so the remaining rejection gates can be exercised through the real tool validator instead of being swallowed before tool execution.

### Remaining Release Window Blocker

After later release rebuilds, Computer Use could no longer attach again:

- `mcp__computer_use__.get_app_state({ app: "com.offisim.desktop" })` returned `Apple event error -10005: cgWindowNotFound`.
- `System Events` reported the release process as visible but with zero AX windows: `false, true, 0`.
- `CGWindowListCopyWindowInfo` still showed an onscreen Offisim window owned by the release pid, for example `{ X = 180, Y = 87, Width = 1152, Height = 721 }`, window name `Offisim`.
- `screencapture -l <OffisimWindowId>` failed with `could not create image from window`.
- Additional hardening tried in the release bundle: explicit manual `main` window creation, `visible(true)`, `focused(true)`, `center()`, and macOS `ActivationPolicy::Regular`. The final release still exposed a CG window but no AX window, so Computer Use remained blocked.

This temporarily blocked the remaining desktop live gates. Later release launches recovered Computer Use attach, and the remaining gates below supersede this blocker.

### Desktop Release SOP Dispatcher Verification

- Rebuilt and launched release `.app`: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; Computer Use attached to `com.offisim.desktop` with URL `tauri://localhost`.
- Inserted release DB SOP template `sop_desktop_live_dag_20260427150615` / `Desktop Live DAG 20260427150615` for company `fe24a509-d505-4bb9-9107-b67e08521996`.
- DAG shape matched the web complex case: 8 steps across 5 dependency batches: `intake + ux`, `api + ui`, `frontend + implementation`, `qa`, `handoff`.
- Invalid attempts were not counted as evidence:
  - Direct employee context routed to `employee_direct_setup` because prior Maya self-authoring context polluted the default thread.
  - Project `/sop` shortcut initially wrote to the default company thread because the slash command callback held a stale `handleSend` closure.
- Fixed the project-thread slash command bug in `packages/ui-office/src/components/chat/ChatPanel.tsx` by making `addMessage` / `handleSend` stable callbacks and including them in `executeCommand` dependencies.
- Clean release run used selected project `Offisim Runtime Refactor` and a normal chat message: `Run the saved SOP named Desktop Live DAG 20260427150615. Use the saved SOP template exactly; do not route this as a direct employee task.`
- DB evidence for clean thread `project-proj-bc604c91-feb6-41ab-8db6-30aa1521e479`: `graph_threads` ended `boss_chat|completed|2026-04-27T03:24:06.152Z`.
- Node counts since `2026-04-27T03:19:00Z`: `boss|1`, `manager|1`, `pm_planner|1`, `step_dispatcher|5`, `employee|8`, `step_advance|5`, `boss_summary|1`.
- Latest summary evidence: `boss_summary|Boss summary completed. Output: Task processing complete.`
- `runtime_events` for the clean project thread had no `sop.dispatcher.recursion_limit` event.

### Desktop Release Self-Authoring Cancel And Negative Verification

Release input/parser fixes discovered during negative-path testing:

- Release runtime still used stale `packages/core/dist` after source-only edits because the local core build can skip when `dist` exists; `pnpm build:runtime-deps` is required before rebuilding the release app for runtime-core changes.
- The explicit skill command parser now accepts Computer Use text that drops colons after `Frontmatter fields` / `Markdown body`.
- The inline frontmatter parser now handles common Computer Use text that drops commas between fields.
- The inline parser also requires a real field-name boundary, so prose like `namespace` no longer gets split as a new `name` field.
- Verified the compiled parser directly from `packages/core/dist/agents/explicit-skill-tool-call.js` before the final release rebuild; the reserved-field prompt produced `offisim.private: reserved.` as a distinct frontmatter field.

Cancel path:

- Release `.app` prompt in Maya direct chat created preview slug `desktop-live-cancel-20260427155000` with action `Create skill` and `Cancel`.
- Clicked `Cancel` in the release UI.
- `interaction_history`: `ix-fba7bb17-badb-4b99-9a54-30a68acab659|skill_install_confirm|resolved|cancel|thread-fe24a509-d505-4bb9-9107-b67e08521996|2026-04-27T03:49:18.465Z|2026-04-27T03:50:02.788Z`.
- No `skills` row for `desktop-live-cancel-20260427155000`.
- `active_thread_interactions` empty after cancel.
- No vault path under `$HOME/Library/Application Support/com.offisim.desktop/vault` matched `desktop-live-cancel-20260427155000`.

Rejection paths:

- Reserved field: release UI showed `forbidden-namespace : offisim.private`, `Skill frontmatter needs revision`, and `Retry` / `Cancel` for slug `desktop-live-reject-reserved-20260427160600`; cancelled afterward. `interactionId`: `ix-ec5e58b4-0163-4c55-973f-38bd80b37be9`.
- Unknown field: release UI showed `unknown-field : extraField`, `Skill frontmatter needs revision`, and `Retry` / `Cancel` for slug `desktop-live-reject-unknown-20260427160900`; cancelled afterward. `interactionId`: `ix-e8f8fb54-790e-4684-b624-41b6d83f282d`.
- Missing description: release UI showed `missing-required : description`, `Skill frontmatter needs revision`, and `Retry` / `Cancel` for slug `desktop-live-reject-missing-description-20260427161100`; cancelled afterward. `interactionId`: `ix-ce47556b-517f-4b35-bc92-de33df543f7d`.
- No `skills` rows existed for the three rejection slugs.
- No vault paths existed for the three rejection slugs.
- `active_thread_interactions` was empty after cancellations.

Maya/Alex mismatch:

- Release Maya direct chat used Alex target `12f2501a-1979-419f-bb3b-7adc7240dcd9` with slug `desktop-live-mismatch-20260427161300`.
- Latest `task_runs` evidence: `tr-dc-1777263864418|direct_chat|completed`; `output_json` contained `target-employee-mismatch` and explained that the active chat identity was Maya while `targetEmployeeId` pointed to Alex.
- No active interaction was created for the mismatch path.
- No `skills` row or vault path existed for `desktop-live-mismatch-20260427161300`.

### Production Debug Hook Gate

- `apps/web/src/runtime/OffisimRuntimeProvider.tsx` now exposes `window.__OFFISIM_DEBUG__` only when `import.meta.env.DEV` is true.
- The previous release-Tauri exposure via `window.__TAURI_INTERNALS__` was removed, so `sendMessage`, `abortExecution`, `runSkillInstallTool`, and live repos are no longer exposed in production desktop merely because Tauri internals exist.
- `packages/ui-office/src/components/scene/Office3DView.tsx` already keeps scene debug helpers behind `import.meta.env.DEV`.

### Latest Verification

- `pnpm typecheck`: passed, `26 successful, 26 total`.
- `pnpm exec biome check` on the touched TS/TSX runtime files: passed.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`: passed.
- `pnpm --filter @offisim/desktop tauri build`: passed and produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` and `apps/desktop/src-tauri/target/release/bundle/dmg/Offisim_0.0.1_aarch64.dmg`.
- Final rebuilt release `.app` launched and Computer Use attached as `com.offisim.desktop`, pid `81597`, URL `tauri://localhost`, state `Ready`.
- `openspec validate verify-post-overhaul-runtime-live-gaps --strict`: passed.
