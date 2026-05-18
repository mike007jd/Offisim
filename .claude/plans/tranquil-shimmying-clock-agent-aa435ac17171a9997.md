# Scene V2 Phase 1: Dual-Center UX Integration + Scene Readability

> Historical plan note (2026-05-18): this predates the Tauri-only decision. Any `apps/web` file paths below are legacy renderer paths; new renderer ownership targets `apps/desktop/renderer`, and this plan must not be used to justify standalone web work.

## Overview

This plan addresses 6 known gaps to make the chat area ("linguistic truth") and scene area ("behavioral truth") truly collaborative. The work is organized into 4 milestones that can be verified independently, ordered by dependency and impact.

---

## Milestone 1: Shared Focus Context (Foundation Layer)

**Goal**: Create a single source of truth for "what the user is looking at right now" — the focus employee, the current ceremony phase, and recommended action — shared between chat and scene.

### Step 1.1: Create `useDualCenterContext` hook

**File to create**: `packages/ui-office/src/runtime/use-dual-center-context.ts`

**What it does**: A pure derived-state hook that computes a unified focus state from existing data. This is the core integration point. It consumes ceremony phase, agent states, pending interaction, and selection to derive a coherent "dual-center focus" object.

**Specifically**:
```
interface DualCenterFocus {
  // Selection sync
  focusEmployeeId: string | null;
  focusEmployeeName: string | null;
  focusEmployeeState: string | null;  // from AgentState.state

  // Ceremony phase (user-facing labels, not debug names)
  ceremonyPhase: CeremonyPhase;
  ceremonyLabel: string;         // e.g. "Team is gathering", "Employees are working"
  ceremonyColor: string;         // from getPhaseColor()

  // Recommended action (derived from pendingInteraction + ceremony phase)
  recommendedAction: RecommendedAction | null;
}

type RecommendedAction = {
  kind: 'approve' | 'review_plan' | 'answer_question' | 'observe';
  label: string;
  employeeId?: string | null;
  employeeName?: string | null;
};
```

The hook accepts arguments rather than reading from context directly, making it testable:
```ts
function useDualCenterContext(args: {
  selectedEmployeeId: string | null;
  agents: Map<string, AgentState>;
  ceremonyPhase: CeremonyPhase;
  pendingInteraction: InteractionRequest | null | undefined;
}): DualCenterFocus
```

**Key design decision**: This does NOT create a new context provider. Instead, it is a derived-state hook that the consuming page (App.tsx) calls once and passes down. This follows the existing pattern where App.tsx owns `selectedEmployeeId` state and passes it to children via props.

**Dependencies**: Step 1.2 (needs `getPhaseLabel`).

**How to verify**: Unit test — call the hook with mock agents, ceremony phase, and interaction data. Assert correct `ceremonyLabel` and `recommendedAction` derivation.

### Step 1.2: Add user-facing ceremony labels

**File to modify**: `packages/ui-office/src/lib/ceremony-visuals.ts`

**What to change**: Add a new exported function `getPhaseLabel(phase: CeremonyPhase): string` that returns human-readable labels suitable for the chat UI:

```
idle       → ''  (empty, not shown)
gathering  → 'Team is gathering'
analyzing  → 'Analyzing your request'
planning   → 'Creating an execution plan'
dispatching → 'Assigning tasks to employees'
working    → 'Employees are working'
reporting  → 'Preparing the summary'
dismissing → 'Wrapping up'
```

These differ from the debug-facing `bubbleText` in `useSceneOrchestrator` because they are stable, predictable strings (not dynamic like "→ Alice: Fix the auth bug").

**Dependencies**: None.

**How to verify**: Import and call `getPhaseLabel` for each phase, assert correct string output.

### Step 1.3: Export the new hooks from barrel

**File to modify**: `packages/ui-office/src/index.ts`

**What to change**: Add export lines:
```ts
export * from './runtime/use-dual-center-context.js';
export * from './hooks/useCeremonyPhase.js';
```

**Dependencies**: Steps 1.1, 4.2.

**How to verify**: TypeScript compilation succeeds; consuming app can import `useDualCenterContext` and `useCeremonyPhase`.

---

## Milestone 2: InteractionPrompt Employee Attribution (Gap #1 fix)

**Goal**: The InteractionPrompt and InteractionDecisionCard now show WHICH employee triggered the interaction.

### Step 2.1: Add employee attribution to InteractionDecisionCard

**File to modify**: `packages/ui-office/src/components/chat/InteractionDecisionCard.tsx`

**What to change**:

The `InteractionRequest` type already has `employeeId?: string | null` (verified in `packages/shared-types/src/interactions.ts` line 61). The card currently ignores it.

Add a new optional prop `employeeName?: string | null` to `InteractionDecisionCardProps`. When provided, render an attribution line above the title.

Insert this inside `CardHeader`, before the existing `div` containing `CardTitle` and `Badge` (currently at line 35):

```tsx
{employeeName && (
  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
    <User className="h-3 w-3" />
    <span>From <span className="text-slate-300 font-medium">{employeeName}</span></span>
  </div>
)}
```

Import `User` from `lucide-react` (already a project dependency).

**Dependencies**: None.

**How to verify**: Render `InteractionDecisionCard` with a request that has `employeeId` and pass `employeeName="Alice"`. Visually confirm "From Alice" appears above the title.

### Step 2.2: Pass employee name through InteractionPrompt

**File to modify**: `packages/ui-office/src/components/chat/InteractionPrompt.tsx`

**What to change**:

Add `employeeName?: string | null` to `InteractionPromptProps`. Pass it through to `InteractionDecisionCard` in both render paths (the Dialog wrapper for severity === 'high' and the inline render):

```tsx
<InteractionDecisionCard
  request={request}
  onRespond={onRespond}
  employeeName={employeeName}
/>
```

**Dependencies**: Step 2.1.

**How to verify**: Same as 2.1, but through the InteractionPrompt wrapper.

### Step 2.3: Resolve employee name in ChatPanel and pass it down

**File to modify**: `packages/ui-office/src/components/chat/ChatPanel.tsx`

**What to change**:

ChatPanel already has `const agents = useAgentStates();` (line 65) and `const { pendingInteraction } = useOffisimRuntime();` (line 62).

Add a derived variable after line 66:
```ts
const interactionEmployeeName = pendingInteraction?.employeeId
  ? (agents.get(pendingInteraction.employeeId)?.name ?? null)
  : null;
```

Then pass it to both InteractionPrompt render sites. The first is at lines 318-324:
```tsx
<InteractionPrompt
  request={pendingInteraction}
  onRespond={handleInteractionRespond}
  employeeName={interactionEmployeeName}
/>
```

The second is at lines 335-336 (the high-severity path):
```tsx
<InteractionPrompt
  request={pendingInteraction}
  onRespond={handleInteractionRespond}
  employeeName={interactionEmployeeName}
/>
```

**Dependencies**: Steps 2.1, 2.2.

**How to verify**: Trigger a `permission_request` interaction from an employee. The chat should show "From [employee name]" above the decision card title.

---

## Milestone 3: Scene Readability Overlays

**Goal**: The 3D scene becomes self-explanatory. Users can understand what phase the scene is in, which employee is focused, and what flow lines mean — without relying on the chat.

### Step 3.1: Ceremony Phase HUD overlay

**File to modify**: `packages/ui-office/src/components/scene/office3d-sections.tsx`

**What to change**: Expand the existing `Office3DSceneHud` component (lines 169-195). Currently it only shows `activeCount` and `blockedCount` as a tiny monospace overlay. Add ceremony phase awareness.

Add a new prop `ceremony: CeremonyState` to the component's props type. Import `getPhaseLabel`, `getPhaseColor`, `getPhaseIcon` from `../../lib/ceremony-visuals` and `CeremonyState` from `../../hooks/useSceneOrchestrator`.

Add a ceremony phase line above the existing active/blocked counts:
```tsx
{phaseLabel && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
    <span style={{
      width: '6px', height: '6px', borderRadius: '50%',
      background: phaseColor,
      boxShadow: `0 0 6px ${phaseColor}`,
    }} />
    <span style={{ color: phaseColor, fontWeight: 600 }}>
      {phaseIcon} {phaseLabel}
    </span>
  </div>
)}
```

Where `phaseLabel = getPhaseLabel(ceremony.phase)`, `phaseColor = getPhaseColor(ceremony.phase)`, `phaseIcon = getPhaseIcon(ceremony.phase)`.

**Dependencies**: Step 1.2 (for `getPhaseLabel`).

**How to verify**: Start a ceremony (send a message). The HUD in the top-right of the scene should show the current phase label with the matching color dot, alongside the existing active/blocked counts.

### Step 3.2: Pass ceremony to Office3DSceneHud

**File to modify**: `packages/ui-office/src/components/scene/Office3DView.tsx`

**What to change**: The `Office3DSceneHud` usage on line 273 currently only receives `activeCount` and `blockedCount`. Add `ceremony`:

```tsx
<Office3DSceneHud
  activeCount={activeCount}
  blockedCount={blockedCount}
  ceremony={ceremony}
/>
```

`ceremony` is already available in the `scene` destructure (line 195). No new data flow needed.

**Dependencies**: Step 3.1.

**How to verify**: Same as Step 3.1.

### Step 3.3: Focus-employee highlight with name label

**File to modify**: `packages/ui-office/src/components/scene/office3d-employees.tsx`

**What to change**: The `EmployeeMarker` component (line 267) currently shows a simple selection ring when `isSelected` is true. Enhance it to also show the employee's name as a floating label when selected, creating a visual connection between the chat target and the 3D avatar.

Inside the `EmployeeMarker`, after the existing selection ring mesh (lines 353-357 inside the `{isSelected && !isOpenClaw && (` block), add a name label Html overlay:

```tsx
<Html position={[0, 1.9, 0]} center distanceFactor={12}
      style={{ pointerEvents: 'none' }}>
  <div style={{
    background: 'rgba(59,130,246,0.25)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(96,165,250,0.5)',
    borderRadius: '6px',
    padding: '2px 8px',
    whiteSpace: 'nowrap',
  }}>
    <span style={{
      color: '#93c5fd',
      fontSize: '10px',
      fontWeight: 700,
      fontFamily: '"Geist Mono", "SF Mono", monospace',
    }}>
      {emp.agent.name}
    </span>
  </div>
</Html>
```

Position y=1.9 sits below the `StatusBubble3D` at y=2.2, avoiding overlap. Uses `distanceFactor={12}` for consistent auto-scaling matching `StatusBubble3D`.

**Dependencies**: None.

**How to verify**: Select an employee in the left panel or by clicking in the scene. Confirm the employee's name appears above them in a blue-tinted pill, alongside the existing selection ring.

### Step 3.4: Flow line meaning hints

**File to modify**: `packages/ui-office/src/components/scene/office3d-shared.ts`

**What to change**: Add a new exported function alongside the existing `getFlowLineColor` (line 34):

```ts
export function getFlowLineLabel(variant: FlowLineData['variant']): string {
  switch (variant) {
    case 'handoff':
      return 'Task handoff';
    case 'approval':
      return 'Approval request';
    case 'report':
      return 'Reporting back';
    case 'blocked':
      return 'Employee blocked';
    default:
      return 'Task dispatch';
  }
}
```

**File to modify**: `packages/ui-office/src/components/scene/office3d-sections.tsx`

**What to change**: In the `Office3DFlowLayer` function (lines 148-167), add a small Html label at the midpoint of each flow line. Wrap each flow line in a `<group>` and add the label:

```tsx
export function Office3DFlowLayer({
  flowLines,
  setFlowLines,
}: {
  flowLines: FlowLineData[];
  setFlowLines: React.Dispatch<React.SetStateAction<FlowLineData[]>>;
}) {
  return (
    <>
      {flowLines.map((line) => {
        const midIdx = Math.floor(line.points.length / 2);
        const midPoint = line.points[midIdx] ?? line.points[0];
        const label = getFlowLineLabel(line.variant);
        const color = getFlowLineColor(line.variant);
        return (
          <group key={line.id}>
            <TaskFlowLine
              points={line.points}
              color={color}
              onComplete={() =>
                setFlowLines((prev) => prev.filter((entry) => entry.id !== line.id))
              }
            />
            <Html
              position={[midPoint[0], midPoint[1] + 0.8, midPoint[2]]}
              center
              style={{ pointerEvents: 'none' }}
            >
              <div style={{
                fontSize: '8px',
                fontFamily: '"Geist Mono", "SF Mono", monospace',
                color,
                background: 'rgba(0,0,0,0.5)',
                borderRadius: '4px',
                padding: '1px 5px',
                whiteSpace: 'nowrap',
                opacity: 0.7,
              }}>
                {label}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
```

Import `getFlowLineLabel` from `./office3d-shared.js` and `Html` from `@react-three/drei` (already imported in the file for other components).

**Dependencies**: None.

**How to verify**: Trigger a task dispatch or approval request. Observe that flow lines now have small colored labels at their midpoint explaining their meaning ("Task dispatch", "Approval request", etc.).

---

## Milestone 4: Chat-Scene Context Awareness (Gap #2, #3 fixes)

**Goal**: The chat area becomes aware of the scene state, showing the current ceremony phase inline.

### Step 4.1: Create `useCeremonyPhase` hook

**File to create**: `packages/ui-office/src/hooks/useCeremonyPhase.ts`

**What it does**: A hook that derives `CeremonyPhase` from `graph.node.entered` EventBus events, making the ceremony phase available outside the scene component tree. Mirrors the `usePipelineStage` pattern exactly (same events, same auto-clear on run end) but maps to `CeremonyPhase` instead of `PipelineStage`.

```ts
import type { GraphNodeEnteredPayload, RuntimeEvent } from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import type { CeremonyPhase } from './useSceneOrchestrator';
import { useOffisimRuntime, useOffisimRuntimeStatus } from '../runtime/offisim-runtime-context';

function nodeToCeremonyPhase(nodeName: string): CeremonyPhase {
  const lower = nodeName.toLowerCase();
  if (lower === 'manager') return 'gathering';
  if (lower === 'boss') return 'analyzing';
  if (lower === 'pm' || lower === 'pm_planner' || lower === 'pm_replan'
      || lower === 'planner' || lower === 'product_manager' || lower === 'project_manager')
    return 'planning';
  if (lower === 'step_dispatcher' || lower === 'step_advance') return 'dispatching';
  if (lower === 'employee' || lower === 'employee_direct_setup') return 'working';
  if (lower === 'boss_summary') return 'reporting';
  return 'working';
}

export function useCeremonyPhase(): CeremonyPhase {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const [phase, setPhase] = useState<CeremonyPhase>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setPhase('idle'), 3000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isRunning]);

  useEffect(() => {
    const off = eventBus.on('graph.node.entered',
      (e: RuntimeEvent<GraphNodeEnteredPayload>) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setPhase(nodeToCeremonyPhase(e.payload.nodeName));
      });
    return off;
  }, [eventBus]);

  return phase;
}
```

**Dependencies**: None (uses existing EventBus and types).

**How to verify**: Unit test — emit mock `graph.node.entered` events, assert the returned phase matches expectations.

### Step 4.2: Ceremony phase indicator in ChatPanel

**File to modify**: `packages/ui-office/src/components/chat/ChatPanel.tsx`

**What to change**: Add a new prop:

```ts
interface ChatPanelProps {
  // ... existing props ...
  ceremonyPhase?: CeremonyPhase | null;
}
```

Import `CeremonyPhase` from `../../hooks/useSceneOrchestrator`, and `getPhaseColor`, `getPhaseIcon`, `getPhaseLabel` from `../../lib/ceremony-visuals`.

Render a compact phase indicator between the direct-chat header (ending at line 271) and the error banner (line 274). Insert:

```tsx
{ceremonyPhase && ceremonyPhase !== 'idle' && (
  <div
    className="flex items-center gap-2 border-b border-white/5 h-6 bg-white/2"
    style={{ paddingInline: 'var(--sp-md)' }}
  >
    <span
      className="w-1.5 h-1.5 rounded-full animate-pulse"
      style={{ backgroundColor: getPhaseColor(ceremonyPhase) }}
    />
    <span className="text-[10px] font-mono" style={{ color: getPhaseColor(ceremonyPhase) }}>
      {getPhaseIcon(ceremonyPhase)} {getPhaseLabel(ceremonyPhase)}
    </span>
  </div>
)}
```

**Dependencies**: Steps 1.2, 4.1.

**How to verify**: Start a ceremony. The chat drawer should show a compact phase indicator (e.g., colored dot + "Creating an execution plan") that updates as the ceremony progresses through phases.

### Step 4.3: Wire ceremony phase from App.tsx

**File to modify**: `apps/web/src/App.tsx`

**What to change**: Import and call the new hook, then pass to ChatPanel.

Add import:
```ts
import { useCeremonyPhase } from '@offisim/ui-office';
```

Inside the `App` component, after the existing `useAgentStates()` call (line 128):
```ts
const ceremonyPhase = useCeremonyPhase();
```

Then add the prop to the ChatPanel usage (around line 435):
```tsx
<ChatPanel
  // ... existing props ...
  ceremonyPhase={ceremonyPhase}
/>
```

**Dependencies**: Steps 4.1, 4.2.

**How to verify**: Send a message, observe the ceremony phase indicator in the chat drawer updating in sync with the scene ceremony bubble.

### Step 4.4: ActivityRail employee focus badge

**File to modify**: `packages/ui-office/src/components/chat/ActivityRail.tsx`

**What to change**: Add optional props to show the focused employee:

```ts
interface ActivityRailProps {
  focusEmployeeId?: string | null;
  focusEmployeeName?: string | null;
}

export function ActivityRail({
  focusEmployeeId,
  focusEmployeeName,
}: ActivityRailProps = {}) {
```

Import `User` from `lucide-react`.

When `focusEmployeeName` is set, add a badge in the header area (inside the existing flex-wrap div at line 25, after the cost badge):

```tsx
{focusEmployeeName && (
  <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-0.5 text-blue-100">
    <User className="h-3 w-3" />
    <span className="font-medium">Focused: {focusEmployeeName}</span>
  </span>
)}
```

This is a visual context indicator for Gap #5. Full per-employee event filtering is deferred to a later phase (requires extending `RuntimeActivityEntry` with `employeeId`).

**Dependencies**: None.

**How to verify**: Select an employee, observe "Focused: [name]" badge in the activity rail.

### Step 4.5: Wire focus employee to ActivityRail in ChatPanel

**File to modify**: `packages/ui-office/src/components/chat/ChatPanel.tsx`

**What to change**: Pass `selectedEmployeeId` and `selectedEmployeeName` to both `ActivityRail` render sites (lines 296 and 315):

```tsx
<ActivityRail
  focusEmployeeId={selectedEmployeeId}
  focusEmployeeName={selectedEmployeeName}
/>
```

Both `selectedEmployeeId` and `selectedEmployeeName` are already props on `ChatPanel`.

**Dependencies**: Step 4.4.

**How to verify**: Select an employee in the left panel. The ActivityRail in the chat should show the focused employee badge.

---

## Summary of All File Changes

### Files to CREATE (2):
1. `packages/ui-office/src/runtime/use-dual-center-context.ts` — shared focus state derivation hook
2. `packages/ui-office/src/hooks/useCeremonyPhase.ts` — ceremony phase derived from EventBus for chat side

### Files to MODIFY (11):
1. `packages/ui-office/src/lib/ceremony-visuals.ts` — add `getPhaseLabel()`
2. `packages/ui-office/src/index.ts` — export new hooks
3. `packages/ui-office/src/components/chat/InteractionDecisionCard.tsx` — add employee attribution UI
4. `packages/ui-office/src/components/chat/InteractionPrompt.tsx` — pass `employeeName` prop through
5. `packages/ui-office/src/components/chat/ChatPanel.tsx` — ceremony indicator + interaction employee name + activity rail focus props
6. `packages/ui-office/src/components/chat/ActivityRail.tsx` — focus employee badge
7. `packages/ui-office/src/components/scene/office3d-sections.tsx` — ceremony HUD + flow line labels
8. `packages/ui-office/src/components/scene/Office3DView.tsx` — pass `ceremony` to `Office3DSceneHud`
9. `packages/ui-office/src/components/scene/office3d-employees.tsx` — selected employee name label
10. `packages/ui-office/src/components/scene/office3d-shared.ts` — add `getFlowLineLabel()`
11. `apps/web/src/App.tsx` — wire `useCeremonyPhase` to `ChatPanel`

### What is NOT changed (intentionally preserved):
- `useSceneOrchestrator.ts` — ceremony state machine is untouched
- `scene-intents.ts` / `scene-intent-dispatcher.ts` — intent bus is unchanged
- `useOffice3DViewState.ts` — view state hook is unchanged
- `AppLayout.tsx` — layout structure is unchanged
- Event flow architecture — no new event types, no new intent types

---

## Implementation Order and Parallelism

```
Phase A (no deps, can run in parallel):
  Step 1.2  getPhaseLabel in ceremony-visuals.ts           [10 min]
  Step 2.1  InteractionDecisionCard attribution             [15 min]
  Step 2.2  InteractionPrompt passthrough                   [5 min]
  Step 3.3  Employee name label in scene                    [15 min]
  Step 3.4  Flow line labels (office3d-shared + sections)   [20 min]

Phase B (depends on Step 1.2):
  Step 1.1  useDualCenterContext hook                       [30 min]
  Step 3.1  Ceremony phase HUD in scene                     [20 min]
  Step 3.2  Pass ceremony to HUD                            [5 min]
  Step 4.1  useCeremonyPhase hook                           [20 min]

Phase C (depends on Phase B):
  Step 2.3  ChatPanel interaction employee name              [10 min]
  Step 4.2  ChatPanel ceremony indicator                     [15 min]
  Step 4.3  App.tsx wiring                                   [10 min]
  Step 4.4  ActivityRail focus badge                          [10 min]
  Step 4.5  ChatPanel → ActivityRail wiring                   [5 min]

Phase D (cleanup):
  Step 1.3  Barrel exports                                    [5 min]
```

**Total estimated effort**: ~3.5 hours of focused implementation.

---

## Risks and Mitigations

1. **Performance of flow line Html labels**: Each flow line gets a `<Html>` DOM node via drei. With up to 24 flow lines, this creates extra DOM nodes. Mitigation: flow lines are short-lived (2s lifecycle per `TaskFlowLine`), so at most a few labels exist simultaneously. The opacity is set to 0.7 to keep them subtle.

2. **Ceremony phase drift between chat and scene**: `useCeremonyPhase` (chat) and `useSceneOrchestrator` (scene) both listen to `graph.node.entered` events independently. They might briefly disagree during rapid transitions. This is acceptable — both converge within one event tick, and the visual difference is imperceptible to users.

3. **Selected employee name label vs StatusBubble3D overlap**: The name label at y=1.9 sits below `StatusBubble3D` at y=2.2. For employees in non-idle states, both will render. The 0.3 unit gap and consistent `distanceFactor={12}` on both keeps them visually separate. If overlap is observed at extreme zoom levels, the name label can be conditionally hidden when StatusBubble is active.

4. **InteractionRequest.employeeId availability**: Not all interaction requests carry an `employeeId` (it is optional). The attribution UI gracefully hides when `employeeName` is null/undefined (the `{employeeName && ...}` guard).

---

## What This Does NOT Address (Deferred)

- **Gap #6 (timing mismatch)**: Chat events and scene flow lines use different timing. Requires deeper EventBus timestamping work. Deferred to Scene V2 Phase 2.
- **Full per-employee activity filtering**: ActivityRail gets a focus badge but not actual event filtering. Requires extending `RuntimeActivityEntry` with `employeeId` throughout the feed. Deferred.
- **Camera auto-focus on selected employee**: Scene could orbit to center on the focused employee when selected from chat. Deferred to Scene V2 Phase 2.
- **Bidirectional ceremony interaction**: Chat triggering scene animations (e.g., clicking phase label to zoom camera to meeting zone). Deferred.
- **2D view parity**: Changes to `office3d-employees.tsx` and `office3d-sections.tsx` only affect the 3D view. The 2D view (`Office2DView.tsx`) needs equivalent readability work. Deferred.
