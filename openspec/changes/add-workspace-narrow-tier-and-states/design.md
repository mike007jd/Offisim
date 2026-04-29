## Context

The R3 release exposed three structural gaps that compound:

1. **`useLayoutTier()` is one-consumer code.** It has been in
   `apps/web/src/components/workspaces/useLayoutTier.ts` since the
   workspace IA refactor, but only `PersonnelPage.tsx` reads tier
   information — and even then via Tailwind `lg:` breakpoint, not the
   actual hook. The other 5 peer workspaces ship with hard-coded
   `flex h-full`, `w-3/5 / w-2/5`, fixed-width sidebars, etc. The
   responsive baseline that the responsive-app-shell spec promised never
   propagated.

2. **State coverage is half-applied.** Empty states exist (`EmptyState`
   in `ui-core`, `SopEmptyState`, `ActivityEmptyState`,
   `MarketEmptyState`) but their CTAs are inconsistent — `SopEmptyState`
   wires `onCreateClick` / `onImportClick`, `EmptyDetail` /
   `EmptyTabPlaceholder` in `PersonnelPage` are description-only.
   Loading skeletons effectively don't exist outside of
   `MarketDetailSkeleton.tsx` (one-off in marketplace). Error states are
   a mix of toasts that fade and silent swallows. The
   `WorkspaceLoadingFallback` in `WorkspaceRouter.tsx:190–196` is a
   plain `<div>Loading workspace…</div>` — invisible on dark theme.

3. **Onboarding controller is selector-coupled.** `OnboardingController.tsx`
   walks `data-onboarding-target` selectors and pins a hint to the
   measured rect. There is no progress indicator, no Back / Next / Skip
   flow, and a hint can silently fail to render if the targeted DOM node
   is absent or mid-mount. The user feedback note ("旧 selector 心智
   模型") confirms this needs to be replaced with a step-data-driven
   tour where targets are declared by stable slot identifiers.

The user directive forbids minimal delivery. All six workspaces, three
tiers, three states (plus unsupported-on-web), header adaptation, sidebar
collapse persistence, and the onboarding rebuild are in scope. No
"phase 1, phase 2" split.

## Goals / Non-Goals

**Goals:**

- Every peer workspace renders correctly at 390 / 768 / 1024 / 1280 /
  1440 / 1920 viewport widths via a single `useLayoutTier()` SSOT.
- Header adapts to narrow tier with a hamburger overlay that contains
  the peer workspace nav, project selector, and provider config CTA.
- Sidebar collapse state persists per-workspace in `localStorage`, with
  forced collapse at narrow tier and persisted preference at tablet+.
- Every workspace exposes empty / loading / error states using shared
  `ui-core` primitives. Empty states have at least one primary CTA;
  errors are recoverable with a Retry button; loading shows a skeleton,
  not a text fallback.
- Onboarding becomes a step-data-driven tour with progress indicator,
  Back / Next / Skip controls, and a slot-based ref registration so
  workspaces don't expose `data-*` attributes.
- First-run welcome screen orients new users before the tour begins.
- Live verification matrix: 5 viewports × 6 workspaces × 4 states (with
  the tour as a 7th workspace-equivalent) — explicit checklist, not
  "test on a few sizes".

**Non-Goals:**

- URL sync / deep linking. That is Change H (`add-url-sync-and-deep-links`).
  This change keeps `useWorkspaceSessionState` as the navigation SSOT.
- Office workspace 3D scene responsive behavior beyond the existing
  right-rail-collapse contract. The 2D/3D scene canvas continues to
  fill its slot at all tiers.
- Brand new tour content beyond the 6 enumerated steps. The tour
  framework is the contract; future tours can register additional
  steps without spec changes.
- Cross-workspace deep-link slots in tours (e.g. "click here to open the
  Skills tab inside an employee detail"). Initial tour stays at
  workspace-level granularity.

## Decisions

### Decision 1: `useLayoutTier()` is the SSOT, Tailwind breakpoints are cosmetic only

**Rationale**: Tailwind `lg:` triggers at 1024px, `md:` at 768px,
`sm:` at 640px — these don't align with the product tier breakpoints
(narrow ≤768, tablet 769–1280, desktop >1280). Mixing them creates
silently-mistuned layouts (Personnel's `lg:` breakpoint flips at 1024px,
which is below the tablet-tier ceiling, so a 1100px window gets
desktop-style three columns even though the spec says tablet should be
two columns). All layout topology decisions read `useLayoutTier()`.
Tailwind `sm:` / `md:` / `lg:` may still be used for purely cosmetic
tweaks (font-size, padding, gap) but never for column counts, drawer
behavior, or pane visibility.

**Alternative considered**: rewriting `computeLayoutTier()` to match
Tailwind's default breakpoints. Rejected — the product tiers are tied
to UX intent (narrow = phone-portrait drill nav, tablet = primary +
secondary collapsible, desktop = three-pane), not screen size
categories. Aligning with Tailwind would change the semantic without
benefit.

### Decision 2: Tier × workspace decision table is the spec contract

The decision table in `specs/responsive-app-shell/spec.md` enumerates
all 18 (6 workspaces × 3 tiers) layout decisions. Each row is a
SHALL-level requirement. Reviewers can read the table and audit a PR
against it without re-deriving intent.

**Rationale**: ad-hoc breakpoint logic in 6 workspace components +
1 header has been the failure mode; the table forces alignment. PRs
that add a new workspace add a new row; PRs that change a tier behavior
update a row.

### Decision 3: `localStorage` keys for sidebar collapse use a fixed prefix

`offisim:workspace:<key>:left-rail` where `<key>` is the WorkspaceKey
literal (`'office'` / `'sops'` / `'market'` / `'personnel'` /
`'activity-log'` / `'settings'`). Values: `'expanded'` / `'collapsed'`.
At narrow tier the read is ignored and the layout is forced collapsed,
but the value is NOT overwritten — when the viewport widens back to
tablet+, the persisted preference takes over again.

**Rationale**: per-workspace persistence is the existing convention
(`offisim:studio:plot-size:<companyId>` etc.); aligning with it avoids
confusing a single global "sidebar collapsed" toggle with per-context
preferences.

**Alternative considered**: a single global key. Rejected — users
develop different defaults per workspace (Settings nav stays expanded,
SOPs sidebar collapses when working on a specific DAG, etc.).

### Decision 4: Skeleton primitives live in `ui-core`, workspace-specific compositions in `ui-office`

`ui-core` exports the atoms:
- `Skeleton` — base shimmer block (rect or text-line)
- `WorkspaceListSkeleton` — 6–8 stacked rows, each with avatar +
  two text lines
- `WorkspaceDetailSkeleton` — header chunk + 2 paragraphs + button stub
- `WorkspacePageSkeleton` — page-level (used by `WorkspaceRouter`'s
  Suspense fallback): header strip + dual-column shimmer

Workspace-specific compositions stay in `ui-office`:
- `SopSidebarSkeleton` — uses `WorkspaceListSkeleton` with sop-row
  spacing tuning
- `PersonnelListSkeleton` — uses `WorkspaceListSkeleton` with
  employee-row tuning
- `MarketGridSkeleton` — adapts the existing `MarketDetailSkeleton`
  pattern to grid view

**Rationale**: `ui-core` has no workspace context; the atoms are
shape-only. The compositions need workspace knowledge (what fields, what
spacing) so they live with the workspace. This also avoids `ui-core`
importing workspace types.

### Decision 5: `ErrorState` primitive contract — Retry is opt-in but recommended

`ErrorState` props:
```ts
interface ErrorStateProps {
  title: ReactNode;          // e.g. "Couldn't load employees"
  message?: ReactNode;       // e.g. "The platform service is unreachable"
  icon?: ComponentType | ReactNode;  // defaults to AlertCircle
  primaryAction?: { label: string; onClick: () => void };  // typically Retry
  secondaryAction?: { label: string; onClick: () => void };  // Dismiss
  variant?: 'banner' | 'page';  // banner = inline above content; page = fills container
}
```

**Rationale**: errors split into "I can recover from this" (page-level
fetch failure → Retry) and "I need to inform but not block" (one item
in a list failed → banner with Dismiss). Forcing every consumer to wire
both primary + secondary creates noise; making them opt-in keeps the
common Retry case minimal.

### Decision 6: Header narrow-tier hamburger replaces wrap-flex

Current header at narrow uses `flex-wrap` so when peer-workspace nav +
project selector + provider config CTA all fit, they wrap onto 2 lines
(70px tall) and stack ugly. The new header at narrow tier:

```
[☰]  Workspace Title              [⋯ More]
```

The hamburger opens a vertical overlay menu with:
- Peer workspace navigation (full labels + icons)
- Active company chip (clickable → company select)
- "Open API Settings" if `needsConfig`

The `[⋯ More]` opens a smaller overlay with:
- Project selector (if office workspace)
- View mode (3D/2D) toggle (if office workspace)
- Office tools (existing dropdown contents)

**Rationale**: at 390px viewport there's room for a workspace title +
two icon buttons but not for the full peer nav. A hamburger is the
honest UI affordance — soft-wrap-then-overflow is not.

**Alternative considered**: bottom navigation bar (mobile-style). Rejected
— this is a desktop product first; phone-portrait is a fallback for
incidental use, not a primary form factor. Bottom nav also conflicts
with chat input area in office workspace.

### Decision 7: Onboarding tour uses ref-based slot registration

Each workspace component that hosts a tour target calls
`useTourTarget(slot)` which returns a ref callback:

```tsx
function ChatInput() {
  const tourRef = useTourTarget('office:chat-input');
  return <div ref={tourRef}>...</div>;
}
```

The tour layer subscribes to the ref map via a React context. When the
active step targets `'office:chat-input'`, the tour reads the registered
ref, computes positioning from `getBoundingClientRect()`, and renders
the highlight ring + hint. If the slot is not registered (workspace not
mounted), the tour skips the step or pauses with a "switch to Office to
continue" affordance.

**Rationale**: ref-based registration means a workspace owner can move
the DOM node freely (refactor, restructure) and the tour follows
without selector edits. It also fails loud when a slot is missing — the
slot map is a typed enum; an unregistered slot is a TypeScript error,
not a silent missing-rect at runtime.

**Alternative considered**: continue with `data-onboarding-target=`
selectors but add a step-data driver on top. Rejected — the indirection
remains, and the failure mode (rect = null when DOM not mounted) is the
exact issue we're trying to eliminate.

### Decision 8: Tour step list is a sealed const array; per-account state is checkpoint-only

```ts
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'connect-provider', workspace: 'settings', slot: 'settings:provider-cta', ... },
  { id: 'pick-project', workspace: 'office', slot: 'office:project-selector', ... },
  { id: 'send-first-message', workspace: 'office', slot: 'office:chat-input', ... },
  { id: 'open-tasks', workspace: 'office', slot: 'office:tasks-tab', ... },
  { id: 'browse-personnel', workspace: 'personnel', slot: 'personnel:nav-button', ... },
  { id: 'try-marketplace', workspace: 'market', slot: 'market:nav-button', ... },
];
```

Per-account onboarding state stores `tour_step_completed: Set<string>` and
`tour_dismissed: boolean`. The active step is `TOUR_STEPS.find(s => !completed.has(s.id))`
with `tour_dismissed` short-circuiting to `null`.

**Rationale**: the const list is the spec contract; future steps can be
appended (not inserted, to avoid re-numbering) and existing user state
is forward-compatible. Skipping a step records its id in `completed`;
`Skip` from the welcome screen sets `tour_dismissed = true`.

### Decision 9: First-run welcome screen condition

Welcome screen renders when:
- `account.provider_configured === false` AND
- No companies exist (`activeCompanyId === null` AND `companies.length === 0`) AND
- `tour_dismissed === false`

Rendered as a full-viewport modal (uses the existing `Dialog` primitive
from `ui-core` at `xl` size). On click of "Get started" it sets
`account.welcome_seen = true` and the tour controller proceeds to step 1.
On "Skip and explore" it sets both `welcome_seen = true` and
`tour_dismissed = true`.

**Rationale**: gating on provider+company empties prevents the welcome
from re-appearing for a user who had a transient empty state mid-flow.
Once `welcome_seen` is true, the welcome screen stays dismissed even if
the user later resets to no-companies (e.g. deleting a test company).

### Decision 10: SOPs narrow tier renders DAG canvas as primary

At narrow tier the DAG canvas needs to be usable for inspection (read,
not edit — port-drag-to-connect is desktop-only). The SOP picker becomes
a top-bar button that opens an overlay drawer; the inspector becomes a
bottom sheet. Edit mode is auto-disabled at narrow tier (the editor
toggle is hidden) — ports cannot be drag-connected on a 390px wide canvas
reliably anyway.

**Rationale**: the DAG canvas IS the SOP workspace's product value;
sidebars are navigation chrome. At narrow tier the chrome moves out of
the way.

**Alternative considered**: render the DAG list (steps as a flat list)
instead of the graph at narrow tier. Rejected — it loses the DAG
relationships. A pinch-to-zoom canvas is sufficient for inspection.

## Risks / Trade-offs

[Risk] Tablet-tier Personnel two-pane layout (list + detail) loses the
tabs inspector when a user is mid-edit on the Skills / Memory / History
tabs.
→ Mitigation: at tablet tier, when an employee is selected and the user
opens a tab, the detail pane swaps to render the tab content, and a
"Back to detail" button appears. The list pane remains visible. So the
flow is list → detail+tabs (one shared right pane swapping role) at
tablet, list+detail+tabs at desktop, list-only / detail-only / tabs-only
at narrow with Back nav. Live verify: select employee on tablet, click
Skills tab, confirm Skills content loads in the detail pane area, click
Back, confirm detail content reappears.

[Risk] SOPs narrow tier hides edit mode entirely; users on narrow
viewport can't author DAG steps.
→ Mitigation: this is by design — DAG editing requires precise pointer
input. Document as a product decision in spec ("narrow tier is
inspection-only for SOPs"). The "Add step" / "Import" / "Create" CTAs in
the sidebar drawer remain available, so users can still kick off
authoring; they just complete it on a wider viewport.

[Risk] Header narrow hamburger overlay competes with chat input on
office workspace where the chat panel is open.
→ Mitigation: the hamburger overlay uses z-index 80 (above chat overlay
at z-50, below dialogs at z-90). It's modal — opening it dims the
background. Closing on Escape / outside click / nav selection.

[Risk] Tour registers slots via ref callback on every render; potentially
churns the ref map.
→ Mitigation: `useTourTarget(slot)` memoizes the callback with `useCallback`
keyed by `slot` so the ref callback identity is stable. The tour layer's
ref map updates via a setState only when a slot's element actually
changes (compare ref by identity).

[Risk] First-run welcome screen could re-render on every state change if
its condition is computed naively.
→ Mitigation: condition computation memoizes via `useMemo` keyed by the
specific state slices it reads (`account.provider_configured`,
`account.welcome_seen`, `account.tour_dismissed`, `companies.length`,
`activeCompanyId`). Welcome screen renders as a `Dialog`; toggle from
`open={shouldShowWelcome}` only.

[Risk] Skeleton primitives in `ui-core` introduce shimmer animation that
might stutter on low-end Tauri webviews under load.
→ Mitigation: the `Skeleton` atom uses CSS `@keyframes` with
`prefers-reduced-motion` honored (animation disabled when the user opts
out). Lightweight gradient — single GPU-accelerated `linear-gradient`
+ `transform: translateX()`, no JS rAF.

[Risk] Replacing `OnboardingController.tsx` removes the existing
`data-onboarding-target` attributes; if any external script or test
relied on them, it breaks.
→ Mitigation: zero external scripts (this is a desktop+web product, no
tracking pixels). The deterministic harness does not assert against DOM
data attributes. Removal is purely an internal cleanup.

[Trade-off] The decision table approach adds spec verbosity (18 rows for
tier × workspace decisions plus header + tour rows) but pays back at
review time — the spec is a checklist, not prose.
→ Acceptable. Equivalent to `responsive-app-shell` already enumerating
3 viewport sizes × 10 screens; we just make the rule layer explicit.

## Migration Plan

Pre-launch — no migration. Behavior changes at all six workspaces are
direct rewrites; no compat shim. `OnboardingController.tsx` is deleted
along with all `data-onboarding-target=` attribute call sites; the new
`OnboardingTour` mounts at `App.tsx` root. First-time existing-account
users who have never run the new tour see the welcome screen on next app
load (since they have no `welcome_seen` flag); users who had previously
dismissed individual hints under the old controller see the tour pick up
from "first incomplete step" because the old `account.provider_configured
/ first_task_sent / first_deliverable_seen` slots map onto new tour step
ids `connect-provider / send-first-message / open-tasks` via a one-shot
migration in `onboarding-store.ts` runs at module init.

`localStorage` keys for the new sidebar collapse store
(`offisim:workspace:<key>:left-rail`) start unset; first read defaults to
`'expanded'` for tablet+ and `'collapsed'` for narrow tier (forced).
First user toggle persists.

Tauri release rebuild not required (no Rust changes); web rebuild picks
up everything.
