# Offisim Design Prototypes — Canonical IA Contract (SSOT)

This file governs every prototype in `Docs/design/`. It exists because the
prior pass drifted from "thoughtfully optimize UI/UX & space" into "transcribe
the current shell 1:1, keep every duplicate entry point, leak component names
to the user." Every rewrite obeys this contract. The diagnosis behind each
decision is settled — implement it, do not relitigate it.

## 0. The two non-negotiable principles

1. **Preserve every capability. Eliminate every duplicate _entry point_.**
   Dropping a feature is forbidden. Removing a second/third button that
   triggers the _same_ feature is required. "No dropped features" ≠ "every
   original component pasted together."
2. **The rendered screen is the product. Code is invisible.**
   Zero component names, file paths, hook names, `conditional-render`
   pseudocode, or `Real = …` annotations in visible chrome. All implementer
   notes, code refs, and reverse-risk warnings go in the **Spec Drawer**
   (closed by default). The spec value is fully preserved — relocated, not
   deleted.

## 1. Spec Drawer (replaces all inline annotations)

Every prototype links `_offisim-shell.css` and ends `<body>` with one drawer.
All `gw-annot` / `.annot` / `annot-dark` / `rev-flag` content from the old
files moves here, grouped by surface, keyed so an implementer can map a
visible element → its contract.

```html
<button class="spec-fab" onclick="document.getElementById('specDrawer').classList.toggle('open')">⌘ SPEC NOTES</button>
<aside class="spec-drawer" id="specDrawer">
  <div class="hd"><span class="t">Implementation spec — not shown to users</span>
    <button class="x" onclick="document.getElementById('specDrawer').classList.remove('open')">×</button></div>
  <div class="bd">
    <div class="grp"><div class="gh">Do-not-drop checklist</div><ul><!-- every capability for this surface from §6 --></ul></div>
    <div class="grp"><div class="gh">Component map</div><ul><!-- visible block → real component file:line --></ul></div>
    <div class="grp"><div class="gh">State & conditional rules</div><ul><!-- the old conditional-render prose --></ul></div>
    <div class="grp"><div class="gh">Reverse-risk register</div><ul><li class="risk">…</li></ul></div>
  </div>
</aside>
```

Specimen catalogs (states, lifecycle, and the per-file "every state" appendices)
keep **full state coverage** but each specimen is a clean designed visual with
a plain-language caption; its code refs/conditions move into the drawer keyed
by the specimen's visible label.

## 2. Single-owner table (the anti-duplication law)

Confirmed by code audit: Project selector renders 3×, Dashboard 2×, Kanban 2×
in the live product. The prototypes must show the **consolidated** target, not
the drift. Each row below has exactly ONE home. Anything else is a defect.

| Capability | The ONE home | Explicitly removed from |
|---|---|---|
| Org / Company switch | Topbar left `company-sel` | anywhere else |
| Workspace switch | Topbar center `peernav` | anywhere else |
| **Project switch** | **Office collab rail context header `proj-sel`** | topbar; Inspect "Project" section; status bar |
| Project detail (folder, counts, files, threads, outputs) | Inspect tab (read/drill only — the *switcher* is the rail header, not repeated) | status bar; topbar |
| Thread switch / create / rename | Inspect tab thread list (`+ New thread` in its header) | nowhere else; Chat shows active thread inline, not a second list |
| Search threads & people | Rail context header `rail-search` (one field) | no second search |
| Session mode (SOP/Human/Direct/YOLO) | ChatInput hint row chip | topbar; status bar |
| Dashboard toggle | Status bar `sb-btn` | topbar office tools |
| Kanban board toggle | The resident task-tray chip below topbar (one chip) | Tasks tab gets a passive count + "uses the board chip" hint, NO second toggle button |
| Notifications | Status bar bell | topbar |
| Git branch (read) | Status bar chip | elsewhere (the Git *tab* is diff/commit/PR, a different thing) |
| Stop / abort run | Status bar Stop **and** PipelineProgress Stop are the SAME single action surfaced where the run is visible — acceptable (one logical control, contextual). Do not add a third. |
| Install (any source) | One Install dialog flow | per-surface re-implementations |
| Object creation (`+`) | Exactly one locus per object type, in that object's list header (threads → Inspect threads header; employee → Team/Personnel header; SOP → SOP list header; step → SOP canvas toolbar). No empty-hero + sidebar + toolbar triplicates. |

## 3. Naming decisions (kill the collisions)

- **"Workspace" is banned as a UI caption.** Left Office pane = **Team**.
  The bound filesystem directory = **Folder**. The rail is unlabeled (the
  project name IS the header). The non-Office full-width region has no rail.
- **"Lane" is banned** (Settings). Use **Connection** for transport/endpoint;
  the SDK options are **"Engine"** choices. One clear word each.
- **"Runtime"**: the Settings tab stays "Runtime"; the inner control is
  **"Default employee model"** (company-scoped). Personnel's per-employee one
  is **"Model binding"**. No three "runtime"s on one screen.
- **"Inspector"**: Office rail tab = **Inspect**; Personnel right region =
  **Details**; Activity right region = **Event detail**. Distinct words.
- Counts ("4 tasks · 2 outputs") appear **once**, in Inspect. Not status bar.

## 4. Shell skeleton (copy verbatim; author only `.app-body`)

Office files use `.body-rail`; non-Office use `.body-full` (NO right rail —
the audit confirmed dropping it for non-Office is correct). States & lifecycle
specimen pages use `<div class="app flow">` and stack designed specimen cards.

```html
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offisim · <Surface></title>
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="_offisim-shell.css">
<style>/* ONLY workspace-body styles. No :root/token/shell overrides. */</style>
</head><body>
<svg class="sprite"><!-- icon <symbol>s --></svg>
<div class="app">  <!-- add class "flow" only for states/lifecycle specimen pages -->
  <header class="titlebar">
    <div class="tb-dots"><i></i><i></i><i></i></div>
    <span class="tb-brand">Offisim</span><span class="tb-ver">v0.8.0</span>
    <span class="tb-spacer"></span>
    <button class="tb-act" title="Keyboard shortcuts (⌘ /)"><svg class="ico sm"><use href="#i-kbd"/></svg></button>
  </header>
  <nav class="topbar">
    <div class="tp-left">
      <button class="company-sel"><span class="avatar">E</span>Empty Verify Co.<span class="ct">2</span><svg class="ico sm"><use href="#i-chev-down"/></svg></button>
    </div>
    <div class="peernav">
      <a href="#" class="active"><svg class="ico sm"><use href="#i-office"/></svg>Office</a>
      <a href="#"><svg class="ico sm"><use href="#i-sop"/></svg>SOPs</a>
      <a href="#"><svg class="ico sm"><use href="#i-market"/></svg>Market</a>
      <a href="#"><svg class="ico sm"><use href="#i-people"/></svg>Personnel</a>
      <a href="#"><svg class="ico sm"><use href="#i-activity"/></svg>Activity</a>
      <a href="#"><svg class="ico sm"><use href="#i-settings"/></svg>Settings</a>
    </div>
    <div class="tp-right"><!-- contextual quick-actions for THIS workspace only --></div>
  </nav>
  <main class="app-body"><!-- .body-rail (Office) OR .body-full (others) --></main>
  <footer class="statusbar">
    <span class="sb-run idle"><span class="pip"></span>Idle</span>
    <span class="sb-mid"><span class="truncate">Ready</span></span>
    <span class="sb-right">
      <span class="sb-chip"><b>MiniMax-M2.7</b></span>
      <span class="sb-chip">0 tok · $0.00 · 0 ms</span>
      <button class="sb-btn" aria-pressed="false">Dashboard</button>
      <button class="sb-btn sb-bell"><svg class="ico xs"><use href="#i-bell"/></svg><span class="n">3</span></button>
      <span class="sb-chip"><svg class="ico xs"><use href="#i-git"/></svg>main</span>
    </span>
  </footer>
  <!-- spec-fab + spec-drawer from §1 -->
</div></body></html>
```

The Office rail (inside `.body-rail`, third column) uses the `.rail` /
`.rail-ctx` / `.proj-sel` / `.rail-search` / `.rail-tabs` / `.rail-body`
structure from the stylesheet. Tabs: **Chat · Inspect · Tasks · Git**.

## 5. Per-file decisions (do exactly this)

**office-layout** (rename file stays `offisim-office-layout-v3-prototype.html`):
- 3 columns: **Team** list (left, collapsible 248↔52) · **Stage** (center,
  one consolidated scene toolbar — no stacked floating mini-bars) · **collab
  rail** (right). Delete the bottom 96px team dock (it duplicated the employee
  list — employees have ONE locus: left Team list; clicking one opens direct
  chat in the rail). Project switcher = rail header only. Inspect tab =
  Folder + file tree + Threads + Outputs (detail/drill; counts appear here
  only). Git = full-height rail tab (never crammed into a 296px left column).
  Annotations → drawer.
- Scene = canvas-style rooms/employees (keep the visual), one toolbar with
  2D/3D + Kanban chip + view controls.

**settings**: 2-pane fill (section nav rail ~210px | content, no 980px cap,
no dead 40% canvas). Max 2 nesting levels (section → control; no
pane→card→section→details→grid). One global save bar (remove the 3 competing
save buttons). Rename per §3 ("Connection", "Engine", "Default employee
model"). Draw the **real** company-scoped model picker (radio-card group), not
a placeholder `<select>` with an apology annotation.

**sops**: sidebar (SOP list, single create/import locus in its header) ·
DAG canvas (full bleed; one "Fit" affordance integrated in a canvas toolbar) ·
**on-demand detail panel** that only occupies space when a node is selected
(slides in over the canvas right edge; reclaims space when nothing selected —
no permanent read-only column). One step-edit entry (node double-click;
context menu mirrors it; document the equivalence in drawer, don't show 4
parallel affordances as primary). Specimen appendix → designed states +
drawer.

**market**: ONE `MarketListingCard` component, ONE detail surface (workspace
split). The legacy fullscreen deep-link overlay is drawer-documented, NOT a
rendered specimen. Rarity uses real product tokens (info/accent/violet/etc.) —
document the kind→tone mapping in the drawer, don't ship a "lie" CSS comment.
Consolidate the 3 dropdowns: **Explore / Manage** = one `seg` toggle; within
Manage, Installed/Updates/Published = tabs; Kind + Sort = filter chips, not
full-width selects. Card drawn once in the grid + once in detail — not 20×.

**personnel**: 2-pane **roster (280px) | Details+Inspector (1fr)**. Kill the
near-empty 1fr center spacer entirely — the employee header + 6-tab inspector
share the right region. When nothing selected, the right region shows ONE
empty state (never a blank 420px column). Skills has ONE locus = the Skills
tab; remove the duplicate Skills mini-list embedded in Profile▸Config. One
save bar (not one per tab). 6 tabs kept: Profile/Appearance/Runtime/Skills/
Memory/History. Chinese-label / legacy-token source bugs → drawer
reverse-risk note (the prototype renders the corrected English/token version).

**activity**: full-width timeline | event-detail (detail panel only when an
event is selected, else timeline goes full width — no reserved empty 420px).
Filters = compact chip row (date / type / actors / search), not 4 oversized
1/5-width selects. Keep timeline grouping, level borders, ×N reroute collapse,
domain icons. Reset-filters behavior bug → drawer note (do not invent a new
control; this is a product decision, not ours to add).

**lifecycle**: specimen page (`app flow`). Fix the hard-dark off-token
CompanyCreationWizard / EmployeeCreatorOverlay — render them in the shared
token system (this is a legitimate visual redesign fix, exactly what the user
wants; the source-level bug is a drawer reverse-risk note). The 8-step
unwired InterviewWizard is **not** rendered as a specimen — drawer note only:
"latent, not mounted, do not build." Company & Project surfaces follow the
single-locus law (no fragmented selector/summary/files/create scatter — show
the consolidated flow). Keep every real lifecycle state: first-run welcome,
company create/select/archive, onboarding tour, project create, deliverables
empty/full/compact, employee creator (2-step), A2A external install.

**states**: specimen page (`app flow`). One resting Office window at top
(canonical running state) then designed specimens: ResumeBar · ErrorBanner
(all 4 actions + history) · PipelineProgress (5 nodes + Stop + error node
state shown as a designed state, drawer-note that the live mapper can't reach
it) · MeetingPanel + MeetingActionItems · attachment staging + all 6 error
states · KeyboardShortcuts. Do not render a specimen that merely repeats the
resting window identically — reference it. "Renders null" = a compact labeled
chip, not a half-pane. Code refs/conditions → drawer.

## 6. Do-not-drop feature map (authoritative checklist)

Each rewrite's Spec Drawer MUST include its surface's list below and every
item must be reachable in the rendered design. Source: code inventory.

**Shell (all):** company switch · 6-peer nav · keyboard-shortcuts entry ·
status: pipeline stage, run/project status, pending-interaction badge,
activity headline, tool/task/utilization cluster, model, token+cost+latency,
Stop (when running), Dashboard toggle, NotificationCenter (focus employee /
open activity log), git branch chip · file-import entry · API-Settings CTA
(only when no provider configured).

**Office:** 2D/3D toggle with crash/FPS auto-2D-fallback + ghost-state guard ·
canvas scene (rooms, zones, employees, seat positions, employee→zone drag,
movement routing) · 8-phase ceremony visuals + manager presence + speech
bubbles · Team employee list (select → direct chat, enable/disable + external
brand badges, add/hire entry) · collab rail: Chat (full ChatPanel: API-key
warning+Settings CTA, direct-chat header w/ back-to-Team, ErrorBanner,
message list w/ deliverables-by-timestamp, streaming bubble, inline + pinned
interaction prompts, MeetingPanel, MeetingActionItems w/ Delegate,
PipelineProgress w/ Stop, onboarding starter chips, ChatContextStrip,
ChatInput: slash menu, @mentions, 4 attachment entry paths + staged chips +
error region, SessionModeChip 4 modes, retry/swap-person/swap-model) ·
Inspect (project folder + counts, ProjectWorkspaceFiles desktop tree
list/preview/refresh/parent-up + client search, ThreadList +New/select/
dblclick-rename + chat_thread.updated sync, Outputs/PitchHall gated cards w/
contributor avatars + Save-as-SOP) · Tasks (Activity always; Plan gated on
planSteps>0||planning; Board count + the one Kanban chip reference) · Git
(branch/diff/commit/PR-ready states + unavailable states) · Kanban tray chip
+ 5-col board overlay · Studio + Office-editor entry · ResumeBar.

**SOPs:** SOP list (name, step count, synced indicator, search, create,
import, collapse, loading/empty states) · DAG canvas (pan, zoom 0.25–2, node
drag w/ threshold, port drag-to-connect w/ cycle/self validate + accept/reject
color, remove edge, node click select, node dblclick edit, dblclick-canvas
add-step, context menu, add-step token, runtime status overlay, missing-role
chip, topo batch layout, bezier edges) · NL command bar · editor dialog ·
add-step popover · import dialog · run progress strip · node detail
(on-demand) · role-missing run guard.

**Market:** Explore (card grid + infinite scroll, installed badge, detail) ·
Manage (Installed/Updates/Published) · filter (search, 7 kind filters, 4
sorts) · detail (meta, permissions block, install CTA only for
employee+skill, upgrade diff, loading/unavailable) · Install dialog
(loading→review/ManifestReview→bindings/BindingForm→installing→done/error,
discard-confirm, concurrent guard) · Publish dialog · install-event-driven
installed-state update.

**Personnel:** roster (search name+role, role filter, collapse, rows w/
avatar/name/role/enabled/external, loading/error/empty + Hire/Browse CTAs,
stale-selection auto-drop) · Details header (avatar, name, role, enabled,
external, narrow Back) · 6 tabs: Profile (identity, persona, instructions,
system-prompt preview, ToolPermissionEditor, zone assignment),
Appearance (seed, DiceBear preview, hair/body/clothing), Runtime (model
binding or company default, external lock), Skills (SkillBindingList + skill
preview), Memory (entries), History (version history + diff + provenance) ·
save flow (isDirty) · delete (single confirm path) · EmployeeCreatorOverlay
(2-step) · external A2A install dialog · personnel routing.

**Activity:** timeline (time-grouped, select, level border Error/Warn,
domain icon, ×N reroute collapse, rerouted label, employee-name resolve) ·
event detail (type, level badge, timestamp, entity, ActivityPayloadView
structured) · filters (type, level, actor, time preset, search) · empty/no-
results states · Back-to-Office (single labeled affordance).

**Lifecycle:** FirstRunWelcomeScreen (gated, Get-started / Skip, no backdrop
close) · OnboardingTour (spotlight steps, target-not-mounted hint) ·
CompanySelectionPage · CompanyCreationWizard (template list + Create-Your-Own,
team/workflow tabs, 2D preview, name, submit, archive-armed) ·
ProjectCreateDialog (create+edit, folder picker desktop-only) · project
selector/summary/files single-locus · deliverable card empty/full/compact ·
EmployeeCreatorOverlay (2-step, role, seed presets, randomize,
discard-confirm) · A2A external employee install · InterviewWizard = latent
drawer note only.

**States:** ResumeBar (gated isOffice && unfinished>0, per-project
Review/Resume verb, dismiss in-memory) · ErrorBanner (Retry / Swap Person
dropdown / Swap Model / Details w/ errorCode·node·employee·taskRun·
recoverable·timestamp / history last 5 / dismiss) · PipelineProgress (5
nodes Boss→Manager→PM→Employee→Summary, states completed/active/pending/error,
connector colors, Stop when running, secondary label = ceremony||route,
persists ~3s after run) · MeetingPanel (null when idle, participants,
type badge, duration, Live/Ended) · MeetingActionItems (post-meeting,
priority badges, per-item Delegate) · attachment staging (4 entry paths,
overlay copy, parsing→parsed chip, 6 error states verbatim, rollback) ·
KeyboardShortcutsDialog (⌘/ always toggles, slash commands separate).

## 7. Quality bar (verified before done)

- Links `_offisim-shell.css`; shell skeleton byte-identical across files.
- Zero code identifiers in visible chrome (grep the body for `.tsx`,
  `use[A-Z]`, `Real =`, `summaryMode`, component PascalNames → must be empty
  outside `.spec-drawer`).
- No duplicate entry point from §2. No "Workspace" caption. Counts once.
- No reserved empty column; no >980px dead canvas; no component drawn >2×.
- Every §6 item for the surface present + listed in its drawer checklist.
- Loads with clean console, no horizontal overflow at 1600px and at 1024px.
