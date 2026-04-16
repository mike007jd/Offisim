# deliverable-artifact-handoff Specification

## Purpose

员工 file 类产物（HTML / Markdown / CSV / JSON 等）从 core `deliverable.created` 事件发出，到 chat UI 以 artifact 卡呈现的端到端契约。chat 气泡不把 file 源码当 plain text 贴出；artifact 卡给出 Open / Download / Copy 三操作，按 mime 分档（HTML 显示 Open，其他 mime 只 Download + Copy）；乱序事件回填到已提交消息；StreamingBubble 不渲染 artifact；PitchHall 既有入口不回归。

## Requirements

### Requirement: File-type deliverables surface as artifact cards in chat
When an employee's run emits a `deliverable.created` event with `fileName` and `mimeType` fields populated, the chat UI SHALL render a `DeliverableArtifactCard` attached to the final employee message. The raw file content SHALL NOT be embedded as plain text in the chat bubble body.

#### Scenario: HTML game delivered as artifact card
- **WHEN** the user sends `"Write a single-file HTML Snake game"` and the employee completes with `deliverable.created { fileName: 'snake.html', mimeType: 'text/html' }`
- **THEN** the final chat bubble shows a short completion message plus a `DeliverableArtifactCard` with `snake.html` / `text/html` / `Open` + `Download` + `Copy` buttons
- **AND** the raw HTML source is NOT visible as a code block in the chat bubble body

#### Scenario: Markdown report delivered
- **WHEN** an employee emits `deliverable.created { fileName: 'report.md', mimeType: 'text/markdown' }`
- **THEN** the artifact card renders with `Download` + `Copy` buttons (Open is hidden or disabled for non-HTML mimes in this iteration)

### Requirement: Open button opens artifact in a new tab for renderable mimes
For artifacts with `mimeType = 'text/html'`, the artifact card's `Open` button SHALL create a Blob URL and open it via `window.open(url, '_blank', 'noopener')`. The Blob URL SHALL be revoked after a short delay (≥ 5s) to avoid memory leak.

#### Scenario: Open HTML artifact
- **WHEN** the user clicks `Open` on an HTML artifact card
- **THEN** a new browser tab opens and renders the HTML as if it were a standalone file

#### Scenario: Open hidden for non-HTML mimes
- **WHEN** the artifact mimeType is not `text/html` (e.g. `text/markdown`, `text/csv`, `application/json`)
- **THEN** the Open button is not rendered (or rendered disabled with a tooltip explaining why)

### Requirement: Download button triggers browser download
The `Download` button on the artifact card SHALL trigger a standard browser download using `Blob` + `URL.createObjectURL` + an `<a download="filename">` click. The URL SHALL be revoked after the click.

#### Scenario: Download artifact
- **WHEN** the user clicks `Download` on any artifact card
- **THEN** the browser downloads a file with the card's `fileName`; the file content byte-for-byte matches `artifactContent` emitted in the `deliverable.created` event

### Requirement: Copy button copies artifact content to clipboard
The `Copy` button SHALL copy the artifact content to clipboard via `navigator.clipboard.writeText(content)`. On success, the card SHALL show a transient "Copied!" indicator for 1–2 seconds.

#### Scenario: Copy artifact
- **WHEN** the user clicks `Copy` on an artifact card and the environment is secure (HTTPS or localhost)
- **THEN** the artifact content is written to the clipboard, and a transient confirmation appears

#### Scenario: Clipboard blocked
- **WHEN** `navigator.clipboard.writeText` rejects
- **THEN** the card falls back to a selection-based copy path or shows a clear error toast; the card does NOT crash

### Requirement: Artifact cards appear only at final commit, not during streaming
The artifact card SHALL NOT render inside `StreamingBubble`. It SHALL render only on the committed `MessageBubble` after the employee's run finalizes and the `deliverable.created` event has been processed.

#### Scenario: No artifact in streaming bubble
- **WHEN** the run is streaming (chunks arriving, `activeRun.isStreaming = true`)
- **THEN** no `DeliverableArtifactCard` is present in the DOM inside `StreamingBubble`

#### Scenario: Artifact appears at commit
- **WHEN** the run commits and `deliverable.created` has been received
- **THEN** the committed `MessageBubble` shows the artifact card alongside the final text

### Requirement: Out-of-order event handling
If `deliverable.created` arrives after the chat message has already committed to the timeline, the UI SHALL retroactively attach the artifact card to the matching committed message (identified by `taskRunId` or `employeeId + threadId + timestamp`), not drop the artifact.

#### Scenario: Late deliverable event
- **WHEN** a `deliverable.created` event arrives 500ms after the matching `MessageBubble` already rendered without an artifact
- **THEN** the artifact card appears on that bubble within the next render tick, no duplicate message is created

### Requirement: Team chat and direct chat behave consistently
Artifact card rendering rules SHALL be identical in team chat and direct-employee chat modes.

#### Scenario: Same artifact behavior in direct chat
- **WHEN** the user is in direct chat with an employee and that employee produces a file deliverable
- **THEN** the artifact card appears under the final employee message exactly as in team chat

### Requirement: PitchHall compatibility preserved
The existing `PitchHall` component SHALL continue to receive deliverable events and function as it does pre-change. The artifact-card addition in chat SHALL NOT require changes to PitchHall logic.

#### Scenario: PitchHall still works
- **WHEN** a deliverable is created while PitchHall is the active view
- **THEN** PitchHall still lists the deliverable with its existing visual treatment
