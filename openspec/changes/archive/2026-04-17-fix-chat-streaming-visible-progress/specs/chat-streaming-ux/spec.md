## ADDED Requirements

### Requirement: Reasoning channel streams progressively into the bubble

When `llm.stream.chunk` events arrive with `channel:'reasoning'` for a node in `VISIBLE_STREAMING_NODES`, the `StreamingBubble` SHALL render the accumulated reasoning text within 200 ms of each chunk arrival, growing visibly over time in a dedicated reasoning region within the same bubble. The reasoning region SHALL be visually distinct from the content region (e.g. muted color / smaller type / collapsible) but SHALL be perceived as part of the same speaker's bubble (single speaker label).

#### Scenario: Reasoning chunks fill the reasoning region progressively
- **WHEN** `llm.stream.chunk` events arrive every 200-700 ms with non-empty `reasoning` for an employee turn (no `content` yet)
- **THEN** the reasoning region text grows over time — at frame N+1 the rendered reasoning text is strictly longer than at frame N; it is NOT rendered as one atomic block after all chunks complete

#### Scenario: Reasoning does not clobber content
- **WHEN** after some reasoning chunks, content chunks begin arriving
- **THEN** the content region renders alongside (or replaces the emphasis of) the reasoning region; the reasoning region remains accessible (either visible or collapsed) but NEVER destroys already-accumulated content

### Requirement: Boss delegate routing surfaces reasoning chunks

When the Boss node enters a routing decision that is NOT `direct_reply` (i.e., `delegate_manager`, `start_meeting`, or `direct_delegate`), the Boss LLM call SHALL still emit `llm.stream.chunk` events with `channel:'reasoning'` populated from the provider's reasoning tokens. Content chunks SHALL NOT be emitted on this path (to protect JSON routing-decision parse). The StreamingBubble SHALL display these reasoning chunks under the Boss speaker label.

#### Scenario: Boss delegates after reasoning is visible
- **WHEN** the user asks for a complex task that will be delegated (e.g., a 500-word essay)
- **THEN** during the Boss's JSON routing call, the chat displays a Boss bubble whose reasoning region progressively fills with Boss's internal deliberation (non-empty before the delegate decision completes)
- **AND** the Boss JSON routing decision (delegate target, action) SHALL still parse correctly after stream completion (parity with the pre-fix `.generate()` path)

#### Scenario: Boss direct_reply unchanged
- **WHEN** Boss decides `direct_reply`
- **THEN** the existing behavior from `fix-chat-streaming-ux` is preserved — both `content` and `reasoning` chunks stream, content fills the main region

### Requirement: Manager routing surfaces reasoning chunks

When the Manager node processes a routing/planning LLM call, it SHALL emit `llm.stream.chunk` events with `channel:'reasoning'` during the call. Content chunks SHALL NOT be emitted (same JSON-safety rationale as Boss delegate). `manager` SHALL be included in `VISIBLE_STREAMING_NODES`.

#### Scenario: Manager reasoning visible during routing
- **WHEN** the Manager receives a delegated task and starts its LLM call
- **THEN** the chat displays a Manager bubble whose reasoning region progressively fills; the static `"Analyzing request..."` placeholder is replaced by reasoning text within 500 ms of the first reasoning chunk

### Requirement: Pre-chunk placeholder is dynamic, not static

During the window where `llm.call.started` has fired for a node in `VISIBLE_STREAMING_NODES` but no `llm.stream.chunk` has yet arrived (or only reasoning chunks with empty `reasoning` string have arrived), the placeholder region SHALL:

1. Include a visible motion indicator (e.g. cursor pulse, shimmer background, or animated ellipsis) — NOT a fully static string
2. Include a lightweight elapsed-time indicator at whole-second granularity (e.g. `"Drafting... 12s"`)
3. Continue to display the speaker label

The motion indicator SHALL persist until the first non-empty chunk (reasoning OR content) arrives, at which point it SHALL be replaced by the streaming text + tail cursor.

#### Scenario: Static placeholder is prohibited during active LLM call
- **WHEN** `llm.call.started` has fired for `boss` (delegate path) and 5 seconds have elapsed with no chunks
- **THEN** the bubble displays a dynamic placeholder (e.g. `"Drafting... 5s"` with shimmer / cursor); it is NOT the pre-fix static `"Drafting the response..."` text with no motion

#### Scenario: Placeholder exits cleanly once chunks start
- **WHEN** the first reasoning chunk arrives after a dynamic placeholder window
- **THEN** the placeholder element is removed within 200 ms; the reasoning region begins its progressive reveal per the Reasoning-channel requirement

### Requirement: VISIBLE_STREAMING_NODES includes Boss delegate and Manager

The set of node names that drive the streaming-bubble lifecycle SHALL include at minimum: `boss`, `manager`, `boss_summary`, `employee`, `hr`. Any node that emits `llm.stream.chunk` events (`reasoning` OR `content`) SHALL be a member of this set.

#### Scenario: Chat displays Boss/Manager bubbles during their LLM calls
- **WHEN** a run enters the Boss node and then the Manager node (delegate path)
- **THEN** a `StreamingBubble` with speaker label `Boss` is visible during the Boss LLM call, followed by a bubble with speaker label `Manager` during the Manager LLM call — neither is omitted nor collapsed into a single placeholder
