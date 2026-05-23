## ADDED Requirements

### Requirement: Office shell SHALL use the V3 titlebar + topbar grammar without a notification bell

The Office shell SHALL render a 40px titlebar (window controls + brand) and a 54px topbar composed of: a scope-bar (`Company > Project` segments in container-grammar), a centered nav of the peer-workspace pills (active pill = accent-surface fill + inset accent-ring), and an iconbar containing Activity + Settings only — with a Studio entry (separated by a 1px divider) added when the active workspace is Office. There SHALL be no notification bell icon and no count badge anywhere in the shell chrome.

#### Scenario: Topbar has no bell

- **WHEN** Office is open
- **THEN** the topbar shows scope-bar + centered nav pills + iconbar(Activity, Settings, Studio)
- **AND** no bell icon or count badge appears in the titlebar/topbar

#### Scenario: Active peer pill uses accent-surface

- **WHEN** a peer workspace is active
- **THEN** its nav pill renders with accent-surface fill + inset accent-ring and `aria-current="page"`

### Requirement: Office SHALL have no global status bar; run cost SHALL be a diegetic stage readout

The Office shell SHALL NOT render a global bottom status bar. Run cost and token usage SHALL render as a diegetic pill (`.scene-cost`) anchored to the stage's bottom-right (blur background, `--line` border, `--r-pill`), reading from the existing dashboard metrics — this is the relocation home of the deleted StatusBar's EnergyMeter (token + cost). When a run is live the readout SHALL gain an `--accent-ring` border and an animated pulse dot (`过程即价值` — money burning is felt). Latency SHALL NOT live here (it relocates to the Live run overlay; see the run-state requirement). Run-state context that previously lived in the status bar SHALL be expressed within the diegetic `.stage-pipe` / `.scene-cost` / run-axis Live entry — not a global footer.

#### Scenario: No global status bar

- **WHEN** auditing the Office shell
- **THEN** there is no app-level bottom status-bar footer
- **AND** cost + tokens render in the `.scene-cost` diegetic pill at the stage bottom-right

#### Scenario: Live run highlights the readout

- **WHEN** a run is executing
- **THEN** the cost readout shows the live accent-ring treatment + pulse dot and updates cost/tokens

### Requirement: Notifications SHALL surface as a quiet diegetic dot adjacent to the cost readout

Notifications SHALL surface as a round `.sc-notif` button (26×26) adjacent to the diegetic cost readout — there SHALL be no notification bell and no global status-bar notification chrome. Unread state SHALL be shown as a small corner marker (`.nb-dot`, per the office-layout prototype) that MAY carry a compact unread count; the states prototype's plain dot (`.unread`, no number) is an equally valid skin of the same marker. The marker SHALL NOT grow into a full count-badge segment of the kind the deleted StatusBar carried. The notification list SHALL open as a popover (reusing the existing notification cards).

#### Scenario: Unread shows a quiet corner marker

- **WHEN** there are unread notifications
- **THEN** the `.sc-notif` button shows a small `.nb-dot` corner marker (with or without a compact count, per the prototype skin) and no bell or status-bar count chrome
- **AND** activating it opens the notification list popover

### Requirement: Stage SHALL host a run-axis with Board and Live entries

The stage SHALL render a run-axis float (`.stage-runaxis`, top-centered) with two adjacent entries sharing one visual language but distinct lifecycles: Board (a persistent kanban toggle backed by the existing kanban data/CAS, present even when idle) and Live (a run-broadcast entry with `live-idle` / `live-active` states + pulse dot). The Live entry SHALL open a run-broadcast overlay while a run is active (Plan + Activity surface; latency degrades into this overlay's header — see the run-state requirement). The two entries SHALL NOT merge into one overlay.

This change OWNS the Live **entry shell** + its idle/active state on the stage. The data contract for how a completed run **sediments** into the triggering thread's run-record is OWNED by the chat-rail rebuild (Phase 1) and is explicitly DEFERRED there — this change SHALL NOT assert or implement the sediment persistence behavior.

#### Scenario: Board toggles the kanban

- **WHEN** the user activates the Board entry
- **THEN** the kanban board opens/closes; its data and state-transition rules are unchanged

#### Scenario: Live entry reflects run state

- **WHEN** a run is active
- **THEN** the Live entry shows the `live-active` state + pulse dot and opens the run-broadcast overlay (Plan + Activity)
- **WHEN** no run is active
- **THEN** the Live entry shows the `live-idle` state

#### Scenario: Sediment contract is owned by the chat rail rebuild

- **WHEN** a run completes
- **THEN** the run-record sediment persistence is governed by the Phase 1 chat-rail run-record contract, NOT by this change
- **AND** this change SHALL NOT define or claim sediment behavior beyond the stage Live entry shell + active state

### Requirement: Run-state headline, Stop control, and pending-interaction cues SHALL survive the StatusBar deletion

Deleting the global StatusBar SHALL NOT drop the load-bearing run-control surfaces it carried. The run-state headline (current pipeline stage / step + active assignee) and the run abort control SHALL be relocated to a diegetic stage element — the `.stage-pipe` pill that floats above the worker zones (per the states prototype's resting Office mid-run frame). The Stop control SHALL render iff a run is active (`isRunning && onAbort`) and SHALL invoke the existing `abortExecution()` path; it SHALL NOT be moved into the right-rail composer. On abort, the `.stage-pipe` SHALL collapse to a muted post-state with a Resume/Discard affordance below the run-axis.

Latency SHALL relocate from the StatusBar into the Live run-broadcast overlay header (e.g. `1.2s latency` beside the single-run cost) — it SHALL NOT live in the persistent `.scene-cost` readout. The model name and the EnergyMeter (token + cost meter) SHALL relocate: token + estimated cost render in the diegetic `.scene-cost` readout (see the cost requirement); the active model name relocates to the right-rail composer model-chip (`provider · model · think-level`), which is OWNED by the chat-rail rebuild (Phase 1) and DEFERRED there — this change SHALL NOT host model name in the shell chrome.

Pending-interaction states the StatusBar surfaced (`Approval required` / `Awaiting approval` / `Awaiting plan review` / `Awaiting clarification` / `Decision required` / `Awaiting input`) are load-bearing for the "user must be able to intervene" guarantee. After the StatusBar deletion they SHALL remain visible: the structured "needs intervention" entries (plan-step blocked / error) broadcast in the Live run overlay, and the actionable interaction prompts (permission / plan_review / clarification) surface as chat bubbles in the right rail and/or high-severity HIL modals — both OWNED by Phase 1 / the global lifecycle change. This change SHALL NOT silently drop pending-interaction surfacing; if a run needs intervention while no actionable prompt is mounted elsewhere, the stage SHALL still cue it (Live `live-active` + the structured blocked/error entry), never leaving the user with no visible intervention path.

#### Scenario: Stop control is on the stage, not the composer

- **WHEN** a run is active in Office
- **THEN** the `.stage-pipe` pill shows the current step + assignee + progress and renders the Stop control
- **AND** activating Stop invokes `abortExecution()`
- **AND** the right-rail composer carries only the composer (no run-axis chrome / Stop button stacked on it)

#### Scenario: Abort collapses the stage pipe to a resumable post-state

- **WHEN** the user activates Stop and the run aborts
- **THEN** the `.stage-pipe` collapses to a muted "Stopped at step #N" state
- **AND** a Resume / Discard affordance appears below the run-axis

#### Scenario: Latency lives in the Live overlay, not the persistent readout

- **WHEN** a run is live
- **THEN** latency renders in the Live run-broadcast overlay header
- **AND** the persistent `.scene-cost` readout shows only cost + tokens (no latency)

#### Scenario: Pending interaction stays visible after StatusBar removal

- **WHEN** a run reaches a pending-interaction state (approval / plan_review / clarification, or a blocked/error plan step)
- **THEN** the intervention is surfaced via the Live run overlay structured entries and/or the right-rail interaction bubble / HIL modal (Phase 1 / lifecycle owned)
- **AND** the user is never left with an active run that needs intervention and no visible way to intervene

### Requirement: Office SHALL use a three-column layout with a left Files/SOPs/Git widget

The Office layout SHALL be three columns: left rail 296px, center stage `minmax(620px,1fr)`, right rail 448px. The left rail SHALL host a tab widget with tabs in the order `Files / SOPs / Git` (matching the prototype labels and order), where the SOPs and Git tabs MAY carry a compact count badge (e.g. SOP count, changed-file count). The Git tab SHALL host the GitWorkbench (branch, ahead/behind metrics, file list + diff, commit message + commit, PR-ready compare) showing real local repo state only — moved from the former right-rail Git tab; the `useGitBranch` branch display folds into the GitWorkbench head. The right rail no longer contains a Git tab.

#### Scenario: Left rail hosts Files/SOPs/Git

- **WHEN** Office is open
- **THEN** the left rail (296px) shows `Files`, `SOPs`, and `Git` tabs in that order (SOPs/Git may show a count badge) and the Git tab renders the GitWorkbench against the project's workspace_root
- **AND** the right rail contains no Git tab

### Requirement: Employee roster SHALL relocate from the left rail to the stage on the V3 shell

The V3 left rail hosts the Files/SOPs/Git widget, displacing the employee roster (`AgentPanel`) that previously occupied the left-rail `agentPanel` slot. The employee roster SHALL relocate to the stage, NOT be dropped: employees render as in-scene avatars in the 2D/3D scene, and a horizontal Team dock strip (`.team-row` / `.dock-strip`) SHALL render below the stage showing each employee's avatar + name + status dot, terminated by an `Add` slot that opens employee creation. Employee selection and the per-employee inspector continue to anchor to the selected employee (Personnel routing / inspector), so cross-surface employee reachability is preserved. This change SHALL NOT remove employee reachability anywhere; the Team dock + in-scene avatars are the committed destination, not an apply-time open question.

#### Scenario: Roster is reachable on the stage, not the left rail

- **WHEN** Office is open on the V3 shell
- **THEN** the left rail shows Files/SOPs/Git (no employee list)
- **AND** the team is reachable as in-scene avatars plus a horizontal Team dock strip below the stage (avatar + name + status dot per employee)
- **AND** the Team dock ends with an `Add` slot that opens employee creation

#### Scenario: Selecting an employee from the stage opens its context

- **WHEN** the user selects an employee from the scene or the Team dock
- **THEN** the employee inspector / Personnel context for that employee opens, anchored to the selection
- **AND** no employee becomes unreachable as a result of the left-rail change
