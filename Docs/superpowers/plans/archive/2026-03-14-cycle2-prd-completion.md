# Cycle 2: PRD Full Completion

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete ALL remaining PRD 1.0 features — creator publish UI, auth foundation, animation P1 gaps, employee workshop, company editor, runtime UX enrichment.

**Architecture:** Build on existing infrastructure. Platform API publish endpoints are done. RegistryClient publish methods exist. Renderer puppet/state system exists. UI packages extracted in Cycle 1.

**Tech Stack:** TypeScript, React 19, Next.js (market), PixiJS 8 + GSAP (renderer), Hono (platform), Vitest

---

## Wave 1: Auth Foundation + Creator Dashboard (sequential dependency)

### Task 1: Market Auth Context & Dev Login

**Files:**
- Create: `packages/ui-market/src/components/AuthProvider.tsx`
- Create: `packages/ui-market/src/components/LoginDialog.tsx`
- Create: `packages/ui-market/src/hooks/useAuth.ts`
- Create: `apps/platform/src/routes/auth.ts`
- Modify: `apps/market/src/app/layout.tsx` (wrap with AuthProvider)
- Modify: `packages/ui-market/src/index.ts` (export new components)

**Spec:**
- Dev-mode auth: POST `/v1/auth/dev-login` accepts `{ email, display_name }`, returns signed JWT
- AuthProvider: React context holding `{ user: { userId, email, displayName } | null, token: string | null, login, logout }`
- useAuth hook: read auth state, trigger login dialog
- LoginDialog: email + display name input, calls dev-login endpoint, stores token in localStorage
- Creator registration: POST `/v1/auth/register-creator` accepts `{ handle, display_name, bio? }`, creates user+creator rows

- [ ] Step 1: Create auth API routes (dev-login, register-creator)
- [ ] Step 2: Create useAuth hook + AuthProvider
- [ ] Step 3: Create LoginDialog component
- [ ] Step 4: Wire into market layout
- [ ] Step 5: Tests for auth API routes
- [ ] Step 6: Commit

### Task 2: Creator Dashboard Page

**Files:**
- Create: `apps/market/src/app/dashboard/page.tsx`
- Create: `apps/market/src/app/dashboard/layout.tsx`
- Create: `packages/ui-market/src/components/DraftCard.tsx`
- Create: `packages/ui-market/src/components/DashboardStats.tsx`
- Create: `packages/ui-market/src/components/CreatorNav.tsx`
- Modify: `packages/ui-market/src/index.ts`

**Spec:**
- Protected route — redirect to login if no auth
- Dashboard shows: creator profile summary, published listings count, draft count
- DraftCard: shows draft title, status badge (draft/validated/submitted/approved/rejected), created_at, actions
- List of creator's published listings (from GET `/v1/market/creators/:handle`)
- List of creator's drafts (needs new API: GET `/v1/publish/drafts` filtered by creator)
- "New Listing" button → navigates to publish wizard

- [ ] Step 1: Add GET /v1/publish/drafts endpoint (list creator's drafts)
- [ ] Step 2: Create DraftCard, DashboardStats, CreatorNav components
- [ ] Step 3: Create dashboard layout with CreatorNav
- [ ] Step 4: Create dashboard page with listings + drafts
- [ ] Step 5: Commit

### Task 3: Publish Wizard

**Files:**
- Create: `apps/market/src/app/dashboard/publish/page.tsx`
- Create: `packages/ui-market/src/components/PublishWizard.tsx`
- Create: `packages/ui-market/src/components/ManifestEditor.tsx`
- Create: `packages/ui-market/src/components/ValidationPanel.tsx`
- Create: `packages/ui-market/src/components/PublishPreview.tsx`
- Modify: `packages/ui-market/src/index.ts`

**Spec:**
Per marketplace-publishing-design.md §7:
- Step 1: Basic info (title, kind, summary, description, tags)
- Step 2: Manifest editor (JSON editor or form fields for manifest sections)
- Step 3: Validation panel (run @aics/asset-schema validation, show pass/fail per field)
- Step 4: Preview (how listing will appear on marketplace)
- Step 5: Submit (calls submitPublishDraft → shows moderation status)

Draft lifecycle: create draft on step 1 save → update manifest on step 2 save → validate on step 3 → submit on step 5

ManifestEditor: form-based for common fields (permissions, compatibility, distribution), raw JSON toggle for advanced
ValidationPanel: runs client-side schema validation, shows errors inline
PublishPreview: renders ListingCard + detail preview from draft data

- [ ] Step 1: Create ManifestEditor component (form fields + JSON toggle)
- [ ] Step 2: Create ValidationPanel component
- [ ] Step 3: Create PublishPreview component
- [ ] Step 4: Create PublishWizard (5-step flow with reducer state)
- [ ] Step 5: Create publish page
- [ ] Step 6: Commit

---

## Wave 2: Animation P1 Completion (independent of Wave 1)

### Task 4: Selection Sync Bridge (ANIM-005)

**Files:**
- Modify: `packages/renderer/src/scene/SceneManager.ts` (emit selection events)
- Modify: `packages/ui-office/src/hooks/useScene.ts` (listen for selection events)
- Create: `packages/renderer/src/__tests__/selection-sync.test.ts`

**Spec:**
- SceneManager emits `scene.employee.selected` event via EventBus when employee clicked
- SceneManager emits `scene.employee.deselected` when background clicked
- useScene hook listens for these events, updates selectedEmployeeId state
- Inspector panel (EmployeeEditorDialog) auto-opens on selection
- Clicking employee in sidebar list calls SceneManager.focusEmployee() + emits selection event

- [ ] Step 1: Add selection event emission in SceneManager click handler
- [ ] Step 2: Add useScene selection state sync
- [ ] Step 3: Wire inspector to selection events
- [ ] Step 4: Tests
- [ ] Step 5: Commit

### Task 5: Task Row ↔ World Echo (ANIM-015)

**Files:**
- Modify: `packages/renderer/src/entities/BasePuppet.ts` (add highlight flash method)
- Modify: `packages/ui-office/src/components/dashboard/TaskDashboard.tsx` (click row → emit event)
- Modify: `packages/ui-office/src/hooks/useScene.ts` (listen for task highlight events)

**Spec:**
- Clicking a task row in TaskDashboard emits `ui.task.focused` with employeeId
- SceneManager receives event → calls puppet.flashHighlight() on the target employee
- puppet.flashHighlight(): brief GSAP scale pulse + ring glow, 800ms duration
- Reverse: clicking employee in scene scrolls TaskDashboard to their active task

- [ ] Step 1: Add flashHighlight() to BasePuppet
- [ ] Step 2: Add task row click handler emitting ui.task.focused
- [ ] Step 3: Wire SceneManager to highlight puppet on event
- [ ] Step 4: Tests
- [ ] Step 5: Commit

### Task 6: Install Materialization Scene Feedback (ANIM-024-026)

**Files:**
- Modify: `packages/renderer/src/entities/EmployeePuppet.ts` (install ghost methods)
- Create: `packages/renderer/src/entities/InstallGhostEntity.ts`
- Modify: `packages/renderer/src/scene/SceneManager.ts` (install event handlers)
- Create: `packages/renderer/src/__tests__/install-ghost.test.ts`

**Spec:**
- ANIM-024: InstallGhostEntity — translucent puppet placeholder during install
  - Shows in target zone with 0.4 alpha, pulsing opacity
  - Progress bar overlay showing install stages
- ANIM-025: On install.installed → ghost transforms to full puppet
  - Alpha 0.4→1.0, scale 0.9→1.0, 600ms ease
  - Settle flash effect
- ANIM-026: On install.failed/rolled_back → ghost fades out with red tint
  - Tint to 0xFF4444, alpha→0, scale→0.8, 400ms

- [ ] Step 1: Create InstallGhostEntity
- [ ] Step 2: Wire SceneManager install event handlers
- [ ] Step 3: Implement success settle animation
- [ ] Step 4: Implement failure/rollback animation
- [ ] Step 5: Tests
- [ ] Step 6: Commit

### Task 7: Scene Attention Router (ANIM-032)

**Files:**
- Create: `packages/renderer/src/systems/AttentionSystem.ts`
- Modify: `packages/renderer/src/scene/SceneManager.ts` (integrate attention system)
- Create: `packages/renderer/src/__tests__/attention-system.test.ts`

**Spec:**
- AttentionSystem subscribes to high-priority events (employee.blocked, install.materializing, install.failed)
- On high-priority event: pulse the zone border, add subtle directional indicator
- Priority queue: only one attention focus at a time, higher priority preempts
- Duration-limited: attention indicator auto-fades after 5 seconds
- Does NOT move camera (that's ANIM-033 P2, deferred)

- [ ] Step 1: Create AttentionSystem with event subscriptions
- [ ] Step 2: Implement zone border pulse
- [ ] Step 3: Integrate into SceneManager
- [ ] Step 4: Tests
- [ ] Step 5: Commit

---

## Wave 3: Employee Workshop + Company Editor (independent)

### Task 8: Employee Workshop Mode

**Files:**
- Create: `packages/ui-office/src/components/employees/EmployeeWorkshop.tsx`
- Create: `packages/ui-office/src/components/employees/EmployeeQuickCard.tsx`
- Create: `packages/ui-office/src/hooks/useEmployeeWorkshop.ts`
- Modify: `packages/ui-office/src/index.ts`

**Spec:**
- Workshop: full-width overlay showing ALL employees as editable cards
- EmployeeQuickCard: compact card with name, role, expertise tags, model, temperature
  - Inline edit on click (no dialog needed)
  - Drag-to-reorder (updates department/workstation assignment)
- Batch actions: change model for all, change temperature for all
- "Add Employee" card at the end (opens InterviewWizard)
- Close workshop → changes saved to repos

- [ ] Step 1: Create EmployeeQuickCard component
- [ ] Step 2: Create useEmployeeWorkshop hook (batch state management)
- [ ] Step 3: Create EmployeeWorkshop overlay
- [ ] Step 4: Wire into header/toolbar
- [ ] Step 5: Commit

### Task 9: Company Editor

**Files:**
- Create: `packages/ui-office/src/components/company/CompanyEditor.tsx`
- Create: `packages/ui-office/src/components/company/ZoneEditor.tsx`
- Create: `packages/ui-office/src/components/company/PolicyEditor.tsx`
- Create: `packages/ui-office/src/hooks/useCompanyEditor.ts`
- Modify: `packages/ui-office/src/index.ts`

**Spec:**
- CompanyEditor: panel/dialog for editing company-level settings
  - Company name, description
  - ZoneEditor: add/remove/resize department zones (updates OfficeLayoutRepository)
  - PolicyEditor: default model preference, max tokens budget, temperature default
- ZoneEditor: visual zone arrangement with drag handles
  - Show department label, current employee count, zone color
  - Add department button, remove department (with employee reassignment prompt)
- PolicyEditor: company-wide model/parameter defaults
  - These become defaults for new employees, don't override existing

- [ ] Step 1: Create ZoneEditor component
- [ ] Step 2: Create PolicyEditor component
- [ ] Step 3: Create useCompanyEditor hook
- [ ] Step 4: Create CompanyEditor (combines zone + policy editors)
- [ ] Step 5: Wire into settings or dedicated route
- [ ] Step 6: Commit

---

## Wave 4: Runtime UX Enrichment (independent)

### Task 10: TaskDashboard Enrichment

**Files:**
- Modify: `packages/ui-office/src/components/dashboard/TaskDashboard.tsx`
- Create: `packages/ui-office/src/components/dashboard/TaskDetailPanel.tsx`
- Create: `packages/ui-office/src/components/dashboard/StepProgressBar.tsx`

**Spec:**
- TaskDetailPanel: click task row → expand to show full task detail
  - Task description, assigned employee name, duration, status, output preview
  - Dependency links (which tasks this depends on)
- StepProgressBar: visual progress bar for plan steps
  - Colored segments per step status (pending/active/completed/failed)
  - Click segment → filter task list to that step

- [ ] Step 1: Create StepProgressBar component
- [ ] Step 2: Create TaskDetailPanel component
- [ ] Step 3: Integrate into TaskDashboard
- [ ] Step 4: Commit

### Task 11: EventLog Enhancement

**Files:**
- Modify: `packages/ui-office/src/components/events/EventLog.tsx`
- Create: `packages/ui-office/src/components/events/EventFilters.tsx`

**Spec:**
- EventFilters: filter bar with:
  - Event type dropdown (node, plan, task, deliverable, all)
  - Level pills (info, warning, error)
  - Search input (keyword filter on event payload)
- Color coding: info=gray, warning=amber, error=red border-left
- Click event → if has employeeId, emit ui.employee.focused → scene highlights employee

- [ ] Step 1: Create EventFilters component
- [ ] Step 2: Add color coding and level styling to EventLog
- [ ] Step 3: Add click-to-focus behavior
- [ ] Step 4: Commit

---

## Verification

- [ ] All new components exported from ui-market/ui-office barrels
- [ ] Market: auth flow works (login → dashboard → publish → submit)
- [ ] Renderer: selection sync works (click employee ↔ inspector)
- [ ] Renderer: install ghost appears during install flow
- [ ] Workshop: batch edit employees works
- [ ] Company editor: zone add/remove works
- [ ] TaskDashboard: task detail expandable
- [ ] EventLog: filters work
- [ ] All packages typecheck
- [ ] All tests pass
- [ ] All packages build
