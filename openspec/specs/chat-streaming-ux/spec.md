# chat-streaming-ux Specification

## Purpose

Chat rail 的 streaming UX 契约：让 LLM 响应在 `llm.stream.chunk` 事件陆续到来时真正逐段填充进同一个气泡，placeholder 只占住 `node entered` 到 `first chunk` 之间的空窗，partial / completed / interrupted / failed 四态视觉清晰，team chat 与 direct chat 行为一致，不与 scene / footer 矛盾。

## Requirements

### Requirement: Real content streams into the visible bubble
Whenever `llm.stream.chunk` events carry non-empty `content` for a node in `VISIBLE_STREAMING_NODES`, the chat `StreamingBubble` SHALL render the accumulated content within 200 ms of each chunk arrival. A placeholder string SHALL NOT remain visible once any real content has accumulated.

#### Scenario: Chunks progressively fill the bubble
- **WHEN** the user sends a task that the runtime dispatches to an employee, and `llm.stream.chunk` events arrive every 50–200 ms with non-empty `content`
- **THEN** the `StreamingBubble` text grows over time (not static); the placeholder string (e.g. `"Working through the request..."`) is no longer visible once the first chunk is rendered

### Requirement: Placeholder shows only in the pre-chunk gap
A node-scoped placeholder SHALL appear only when all of the following are true:
1. The active run has an assigned `nodeName` that is in `VISIBLE_STREAMING_NODES`
2. `content` is the empty string
3. `reasoning` is the empty string

In any other state (node unknown, content non-empty, reasoning non-empty, run terminated) the placeholder SHALL NOT render.

#### Scenario: Node known, no chunk yet
- **WHEN** `graph.node.entered` fires for `employee` and no `llm.stream.chunk` has yet arrived
- **THEN** the StreamingBubble shows the employee placeholder

#### Scenario: Content arrives, placeholder exits
- **WHEN** the first chunk with non-empty content arrives after entry
- **THEN** the placeholder text is removed in the next render tick; the bubble shows only the accumulated content plus the streaming cursor

### Requirement: Speaker identity is visible throughout streaming
The `StreamingBubble` SHALL display a speaker label (`Boss` / `Manager` / `Employee` / the employee's name in direct chat) for the entire lifetime of the active streaming run, regardless of whether `content` is empty or non-empty.

#### Scenario: Label visible at placeholder stage
- **WHEN** `activeRun.node = 'employee'` and no chunk has arrived
- **THEN** the bubble header displays the `Employee` label (or the resolved employee name in direct chat)

#### Scenario: Label visible through final commit
- **WHEN** the stream completes and the bubble commits into the normal message timeline
- **THEN** the label identity of the committed message matches the streaming bubble's label (no identity flicker)

### Requirement: Partial vs completed states are visually distinct
While streaming, the bubble SHALL display an active indicator (cursor pulse / micro animation). When the stream completes, the indicator SHALL be removed and the bubble SHALL visually match a normal completed message bubble.

#### Scenario: Active cursor during streaming
- **WHEN** chunks are actively arriving (within the last 500 ms)
- **THEN** a blinking cursor / pulse element is visible at the tail of the content

#### Scenario: Clean transition on completion
- **WHEN** the stream terminates with `status='completed'`
- **THEN** within 200 ms the cursor is removed and the bubble's visual weight matches `MessageBubble`'s completed state

### Requirement: Finalization preserves bubble continuity
When a streaming run completes, the committed final message SHALL be perceived as the same bubble that was streaming — not a placeholder disappearance followed by a new bubble popping in.

#### Scenario: No flicker on commit
- **WHEN** the final message is committed to the chat-session-store's message timeline
- **THEN** no layout flicker (visible gap / disappear-reappear) occurs within the render cycle; an observer measuring bubble DOM continuity sees the committed bubble appear at the position the streaming bubble occupied

### Requirement: Partial content is preserved on error or interruption
If a stream fails or is aborted mid-response, the already-streamed partial content SHALL remain visible; the bubble SHALL additionally surface a clear failure/interrupted indicator.

#### Scenario: Stream error mid-flight
- **WHEN** a provider error aborts the run after some chunks have streamed
- **THEN** the already-rendered partial content stays on screen; a failure marker appears alongside (not replacing) the partial text

#### Scenario: User aborts during streaming
- **WHEN** `execution.aborted` fires while content is accumulating
- **THEN** the bubble retains its current text and marks the run as interrupted; the cursor pulse stops

### Requirement: Team and direct chat behave consistently
Streaming behavior (placeholder discipline, label visibility, partial/completed distinction) SHALL be identical between team chat and direct-employee chat modes.

#### Scenario: Same streaming discipline in direct chat
- **WHEN** the user enters direct chat with a specific employee and sends a message
- **THEN** the streaming bubble obeys the same rules as team chat: placeholder only in the pre-chunk gap, real content streams in, speaker label is the employee's name throughout

### Requirement: Chat streaming UX aligns with scene/footer runtime state
Semantic consistency (not frame-lockstep) SHALL hold between streaming bubble state, 3D/2D scene executing state, and footer cost/latency counters during a run.

#### Scenario: No contradictory surfaces
- **WHEN** the streaming bubble is visibly accumulating content
- **THEN** the footer runtime status SHALL NOT display `idle` and the scene SHALL NOT show the 0-employees-active default; the executing employee(s) SHALL be visible in the scene as `executing`
