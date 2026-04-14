# Offisim Chat Streaming UX Fix Spec

**Status:** approved product/engineering direction  
**Audience:** Kiro / Claude Opus / implementation agents  
**Priority:** high  
**Scope:** web + desktop collaboration rail/chat experience

---

## 1. Decision

Offisim chat must feel like a live working surface, not a placeholder rail that goes silent and then dumps a full answer.

Current behavior is not good enough:

- user sends a message
- rail shows a generic placeholder such as `Working through the request...`
- final content appears all at once

The new direction is:

- **stream real message content into the visible chat bubble**
- keep placeholders only as fallback when no chunks have arrived yet
- make streaming visible in both team chat and direct employee chat

This is a UX/product fix, not just a transport-layer cleanup.

---

## 2. Why this matters

Offisim's product promise is process visibility.

If the chat rail hides the work and only reveals the final answer, users lose:

- confidence that the system is actually working
- visibility into who is speaking
- a sense of progression during long requests
- continuity between scene activity and chat output

The live audit already proved that:

- real MiniMax calls are happening
- cost/latency counters are updating
- employee/scene state can change during execution

But the user-facing chat still feels like:

- `loading...`
- then final dump

That is below the current product bar.

---

## 3. Product goal

The collaboration rail should communicate:

1. **who is currently speaking**
2. **whether content is actively arriving**
3. **what has already arrived so far**
4. **when the final response is complete**

The user should never need to guess whether:

- the model is stuck
- the system is still working
- the answer is partial or final

---

## 4. Scope

### In scope

- collaboration rail streaming UX
- team chat streaming
- direct employee chat streaming
- placeholder behavior
- node/employee identity while streaming
- visual treatment for partial vs final content
- alignment with scene/runtime status

### Out of scope

- changing provider/LLM transport protocol
- redesigning the entire chat layout
- redoing task orchestration
- deliverable artifact/file handoff redesign
- onboarding rewrite

If file/download UX is addressed, that is a separate spec.

---

## 5. Current known problems

### 5.1 Placeholder-dominant streaming

Current live behavior:

- user sees `Working through the request...`
- final answer appears in one shot

This wastes the existing streaming infrastructure and makes Offisim feel less alive than it is.

### 5.2 Weak agent ownership during streaming

During execution, the user should feel:

- "Sophie is answering"
- "Boss is summarizing"
- "Manager is coordinating"

The current rail often communicates the node only weakly, and the visible content does not always reinforce ownership.

### 5.3 Team/direct mode inconsistency risk

Streaming behavior must not differ in surprising ways between:

- team chat
- direct employee chat

The user should not feel that one mode is "real-time" and the other is "batch mode."

### 5.4 Finalization can feel abrupt

When a streamed answer ends, the transition from partial -> final should feel clean and explicit, not like a flicker or snap.

---

## 6. UX requirements

### 6.1 Real content must stream into the bubble

If chunks are arriving, the visible bubble must render:

- accumulated partial content
- optional partial reasoning if that surface is enabled

Do not keep showing a generic placeholder once real text has begun arriving.

### 6.2 Placeholder is fallback only

Placeholder text is allowed only when:

- execution has started
- the rail knows which node is active
- no visible content has arrived yet

As soon as real content exists, the placeholder must disappear.

### 6.3 Streaming bubble identity must stay explicit

Each active streaming bubble must clearly communicate the speaker:

- `Boss`
- `Employee`
- `Manager`
- future external department labels if applicable

This should be visually obvious even before the final message commits.

### 6.4 Partial content must look partial

While streaming:

- keep a live cursor / pulse / subtle active indicator
- avoid making the bubble look identical to a completed message

When complete:

- remove active indicator
- commit content into the normal message timeline cleanly

### 6.5 Finalization must preserve continuity

The user should perceive:

- the streamed bubble became the final answer

Not:

- placeholder disappeared
- brand-new completed bubble suddenly appeared

### 6.6 Long requests must remain readable

Streaming should not create:

- jumpy layout
- scroll fighting
- unreadable reflow

Auto-scroll should be helpful, not forceful.

---

## 7. Behavioral requirements

### 7.1 Team chat

For team chat:

- show the active node while work is happening
- if the speaker changes, update the bubble identity
- keep already streamed text visible

### 7.2 Direct employee chat

For direct employee chat:

- the employee identity must remain stronger than in team mode
- the user should feel they are still inside that employee's conversation
- do not snap back to a generic team feel while the reply is being assembled

### 7.3 Error handling

If a stream fails mid-response:

- preserve the partial content already shown
- surface the failure clearly
- do not erase the partial answer and replace it with a generic error blob

### 7.4 Abort / interruption

If execution is cancelled:

- mark the current stream as interrupted
- keep already streamed text visible
- make it clear the answer is incomplete

---

## 8. Visual direction

### 8.1 Message states

There should be a visible distinction between:

- **pending/no chunks yet**
- **actively streaming**
- **completed**
- **interrupted**
- **failed**

### 8.2 Tone

Streaming UI should feel:

- calm
- production-grade
- readable
- process-transparent

Avoid:

- loud terminal gimmicks
- overly decorative typing theatrics
- placeholder spam

### 8.3 Interaction rhythm

The user should feel forward motion within 1-2 seconds of a send action.

If a real chunk does not arrive yet, the placeholder may cover that gap briefly, but should not become the main experience.

---

## 9. Runtime alignment requirements

Chat streaming, scene state, and footer counters must tell the same story.

Examples:

- if an employee is executing in 3D, the rail should also show active work
- if the rail shows streaming content, runtime state should not still look fully idle
- speaker identity in chat should not contradict who appears active in scene/employee card

This does not require perfect frame-by-frame lockstep, but it does require semantic consistency.

---

## 10. Technical expectations

Implementation may reuse existing infrastructure, but the product behavior above is the bar.

Existing hints:

- `use-chat-streaming-sync`
- `use-streaming-content`
- `StreamingBubble`
- `chat-session-store`
- `llm.stream.chunk`

But implementation should not assume "streaming infra exists" means the UX is already solved.

The deliverable is the user-visible chat behavior.

---

## 11. Acceptance criteria

### Live acceptance

Using a real provider in live runtime:

1. Send a task that takes several seconds.
2. Observe the collaboration rail.
3. Confirm that:
   - a streaming bubble appears with explicit speaker identity
   - real message content grows before completion
   - placeholder text disappears once real content starts
   - completion preserves continuity into the final message

### Direct chat acceptance

1. Select one employee.
2. Send a direct message.
3. Confirm that:
   - streaming remains inside that employee context
   - final reply feels like it belongs to that employee conversation

### Failure acceptance

If a request errors mid-stream:

- partial text remains visible
- failure state is clear
- UX does not collapse into a misleading generic placeholder loop

---

## 12. Non-goals

This spec does **not** solve:

- downloadable artifact UX
- A2A external department UX
- onboarding issues
- 3D bubble richness
- task timeline redesign

Those are separate work items.
