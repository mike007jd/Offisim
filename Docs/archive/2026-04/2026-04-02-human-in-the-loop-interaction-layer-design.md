# Offisim Human-in-the-Loop Interaction Layer Design

## Goal

Add a first-class interaction layer that makes Offisim feel collaborative rather than opaque.

The system should support both:

- boss-proxy automation, where the boss agent makes most decisions and only escalates when needed
- human-in-the-loop collaboration, where the real user directly answers key requests

The goal is not to copy Claude Code's CLI UI. The goal is to absorb its strongest interaction patterns:

- explicit operating modes
- structured decision prompts
- scoped approvals
- accept/reject feedback
- lightweight review-before-execution flow

## Why This Matters

Offisim already has strong runtime execution, streaming, telemetry, and resume behavior. What it lacks is a unified product surface for "AI asks for a decision and the user can respond without friction".

Today:

- tool permission `ask` usually degrades into an error code
- meeting interrupts exist, but only for meetings
- activity feed explains what is happening, but does not let the user act on it

This produces a gap: the system can work autonomously, but cannot yet collaborate comfortably.

## Product Principles

### 1. Interaction Should Be Structured

Do not create ad hoc prompts for each workflow. All user-facing requests for a decision should share one interaction primitive.

The interaction primitive should always provide:

- a clear question
- a small number of explicit options
- an optional free-text override or instruction field
- a recommended option from the boss when available

### 2. Automation And Collaboration Must Coexist

Offisim should support two user-selectable operating styles:

- `boss_proxy`
- `human_in_loop`

Both must remain available at all times. Users can change their mind mid-thread.

### 3. Mode Changes Affect Future Requests Only

Changing interaction mode should not mutate already-pending requests. The current queue remains stable. New requests follow the new mode.

If the user wants to interrupt the current run, they should continue using the existing stop or interrupt controls.

### 4. Risk Should Control Presentation

Not every decision should feel equally heavy.

- low-risk requests should render inline in the chat flow
- high-risk requests should use a stronger modal or drawer presentation

This keeps the UI lively without turning it into a wall of alerts.

### 5. Recommendations Should Reduce User Effort

When the boss agent has a defensible recommendation, show it by default.

The user should see:

- the question
- the boss recommendation
- a one-line reason
- the available options
- an input field for "tell Offisim what to do instead"

The user should not need to reconstruct context from scratch.

## Interaction Modes

### `boss_proxy`

This is the default autonomous mode.

Behavior:

- the boss agent answers most interaction requests on behalf of the user
- the runtime only escalates to the real user when a request crosses a configured escalation threshold
- escalated requests render as UI cards or modals with the boss recommendation preselected visually, but not auto-submitted

Good fit:

- long autonomous coding runs
- low-touch supervision
- experienced users who want speed over handholding

This is not "unsafe YOLO mode". It is "autonomous with escalation".

### `human_in_loop`

This is the collaborative mode.

Behavior:

- requests go to the real user by default
- the boss still prepares context and gives a recommendation
- the real user is the decider unless they explicitly switch back

Good fit:

- brainstorming
- planning-heavy tasks
- sensitive tasks where the user wants frequent control

### Persistence Model

Interaction mode should live at two levels:

- `defaultInteractionMode`: a user preference for new threads
- `threadInteractionMode`: the active mode for the current thread

New threads inherit the default.

The user may change the thread mode at any time.

Changing the thread mode:

- applies immediately
- affects only future requests
- does not rewrite already-pending requests

## Core Runtime Primitive

### `InteractionBox`

Generalize the existing `meetingInterruptBox` concept into a reusable runtime interaction container.

The runtime should gain a new mutable box:

```ts
interface InteractionBox {
  pending: InteractionRequest | null;
}
```

The box is written by runtime services and consumed by the UI layer.

This should exist alongside, not inside, meeting-specific interrupt handling. Meetings are one subtype of runtime interaction, not the whole model.

## Interaction Request Model

```ts
type InteractionMode = 'boss_proxy' | 'human_in_loop';

type InteractionKind =
  | 'permission_request'
  | 'plan_review'
  | 'agent_question';

type InteractionSeverity = 'normal' | 'high';

type InteractionScope = 'once' | 'thread' | 'session';

interface InteractionOption {
  id: string;
  label: string;
  description?: string;
  scope?: InteractionScope;
  recommended?: boolean;
}

interface BossRecommendation {
  optionId: string;
  reason: string;
}

interface InteractionRequest {
  interactionId: string;
  threadId: string;
  companyId: string;
  kind: InteractionKind;
  severity: InteractionSeverity;
  title: string;
  prompt: string;
  options: InteractionOption[];
  recommendation?: BossRecommendation;
  allowFreeformResponse: boolean;
  placeholder?: string;
  requestedByNode?: string;
  employeeId?: string | null;
  taskRunId?: string | null;
  createdAt: number;
}

interface InteractionResponse {
  interactionId: string;
  selectedOptionId: string;
  freeformResponse?: string;
  respondedAt: number;
}
```

## V1 Supported Interaction Types

The first version should support exactly these three kinds:

### 1. `permission_request`

Use when a tool permission decision returns `ask`.

This is the most direct upgrade from the current permission engine.

Options should usually be:

- `approve_once`
- `approve_thread`
- `reject`

Optional freeform examples:

- "approve, but read-only"
- "reject, ask the boss to propose a plan first"

Severity mapping:

- low-risk tool calls: `normal`
- destructive or sensitive operations: `high`

### 2. `plan_review`

Use after the boss or PM has prepared a plan and before execution begins, when the current mode requires human review.

Options should usually be:

- `start_execution`
- `revise_plan`
- `cancel`

Optional freeform examples:

- "split backend and frontend into separate phases"
- "start only after you estimate time"

This gives Offisim a real "review before execution" flow similar to Claude's plan mode, without copying the exact terminal command model.

### 3. `agent_question`

Use when an agent lacks critical information and can formulate a concise question.

Options should usually be:

- `answer_now`
- `let_boss_decide`
- `skip_for_now`

This is the main collaboration primitive for brainstorming and requirement refinement.

## Rendering Model

### Inline `DecisionCard`

Use for `severity: normal`.

Render in the chat flow as a structured card with:

- title
- prompt
- boss recommendation banner
- 2-3 buttons
- optional input field

The card should feel active but not blocking.

### Modal or Drawer

Use for `severity: high`.

Render as a blocking or semi-blocking surface for:

- destructive tool approvals
- high-risk permission escalations
- resume-time overwrite or rewind confirmations

This makes risk visible without overusing modal UI for ordinary decisions.

## Boss Recommendation UX

When available, recommendations should be shown by default.

The visual hierarchy should be:

1. question
2. `Boss recommends: <option>`
3. `Reason: <one-line justification>`
4. explicit options
5. freeform input

Do not expose long chain-of-thought or internal planning text.

Keep recommendation reasoning short and operational.

## Runtime Behavior By Mode

### In `boss_proxy`

1. runtime creates an `InteractionRequest`
2. escalation policy evaluates whether the boss can decide directly
3. if not escalated:
   - boss responds internally
   - runtime continues
   - UI may still show an activity entry for transparency
4. if escalated:
   - UI receives the request
   - user responds
   - runtime resumes with the explicit answer

### In `human_in_loop`

1. runtime creates an `InteractionRequest`
2. request goes directly to UI
3. boss recommendation is attached but not applied automatically
4. user chooses or types a response
5. runtime resumes

## Event Model

Add these runtime event families:

```ts
type EventFamily =
  | 'interaction.requested'
  | 'interaction.resolved'
  | 'interaction.dismissed'
  | 'interaction.mode.changed';
```

Suggested payloads:

```ts
interface InteractionRequestedPayload {
  interactionId: string;
  kind: InteractionKind;
  severity: InteractionSeverity;
  title: string;
  requestedByNode?: string;
}

interface InteractionResolvedPayload {
  interactionId: string;
  kind: InteractionKind;
  selectedOptionId: string;
  hadFreeformResponse: boolean;
}

interface InteractionModeChangedPayload {
  prev: InteractionMode;
  next: InteractionMode;
  scope: 'thread' | 'default';
}
```

These events should feed both:

- the activity rail
- future analytics on friction and escalation

## Integration Points In Offisim

### Permission Engine

Current state:

- `ToolPermissionEngine` can return `ask`
- `AuditingToolExecutor` currently converts `ask` into `TOOL_PERMISSION_REQUIRED`

V1 integration:

- when behavior is `ask`, emit `interaction.requested`
- suspend tool execution until response is received
- map resolution back into:
  - transient approval
  - thread-scoped approval
  - rejection with feedback

This is the first and most important real integration.

### Plan Review

Current state:

- Offisim already has boss, manager, PM, plan creation, and streaming summary

V1 integration:

- when the system is configured to require plan review for the current mode, emit `plan_review`
- do not dispatch plan steps until the review resolves

### Agent Question

Current state:

- agents can fail or guess when information is missing

V1 integration:

- provide a structured path to request missing input
- avoid turning every uncertainty into an error

## Scope Semantics

V1 should support only:

- `once`
- `thread`
- `session`

Do not copy Claude's file-path and folder-specific scope model yet.

That level of filesystem-specific permission UX is valuable in Claude Code, but it is too detailed for Offisim's first pass.

## Out of Scope

Do not include these in V1:

- full Claude-style file-path permission trees
- complicated rule editors in the decision card itself
- nested queueing of many simultaneous user prompts
- generalized review workflows for every graph node
- speculative auto-answering based on old user behavior

## Recommended Implementation Order

1. Add `InteractionMode` state at default and thread scope
2. Add `InteractionBox` to runtime context
3. Add typed interaction events
4. Build UI `DecisionCard` and `InteractionModal`
5. Wire `permission_request`
6. Wire `plan_review`
7. Wire `agent_question`
8. Add boss recommendation banner and freeform response handling

## Testing Strategy

Add tests for:

- mode switching only affects future requests
- `boss_proxy` escalates only when expected
- `human_in_loop` always surfaces the request
- permission `ask` creates an interaction rather than returning only an error code
- thread-scoped approval suppresses repeated prompts in the same thread
- freeform reject instructions are preserved and delivered back to runtime
- high-severity requests render as modal or drawer, not inline card

## Success Criteria

Offisim should feel materially more collaborative after this lands.

Success means:

- users can understand when the system needs input
- users can answer without breaking flow
- the boss can recommend decisions instead of forcing the user to reason from scratch
- autonomous runs stay smooth without becoming opaque
- collaborative runs feel intentional rather than improvised
