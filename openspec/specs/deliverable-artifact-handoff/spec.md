# deliverable-artifact-handoff Specification

## Purpose

员工 file 类产物（HTML / Markdown / CSV / JSON 等）从 core `deliverable.created` 事件发出，到 chat UI 以 compact artifact 卡呈现的端到端契约。chat 气泡通过共享 `DeliverableCard` primitive（`variant='compact'`，结构契约见 `deliverable-card-presentation`）渲染；raw file 内容不作 plain text 贴出；卡内提供 Copy / Open（按 `canPreviewDeliverable` 条件）/ Download 三操作；乱序事件回填到已提交消息；StreamingBubble 不渲染 artifact；PitchHall 经 Outputs 子 tab 复用同一 primitive（`variant='full'`）。

## Requirements

### Requirement: File-type deliverables surface as artifact cards in chat
When an employee's run emits a `deliverable.created` event with `fileName` and `mimeType` fields populated, the chat UI SHALL render the shared `DeliverableCard` primitive (from `packages/ui-office/src/components/deliverable/DeliverableCard.tsx`) with `variant='compact'` attached to the final employee message. The raw file content SHALL NOT be embedded as plain text in the chat bubble body. Prior implementation at `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx` is removed; the callsite imports the shared primitive directly.

#### Scenario: HTML game delivered as artifact card
- **WHEN** the user sends `"Write a single-file HTML Snake game"` and the employee completes with `deliverable.created { fileName: 'snake.html', mimeType: 'text/html' }`
- **THEN** the final chat bubble shows a short completion message plus a `<DeliverableCard variant='compact' item={...}>` rendering `snake.html` / `text/html` / filetype icon / byte size / time ago / contributor avatar, with `Copy` + `Open` + `Download` action buttons
- **AND** the raw HTML source is NOT visible as a code block in the chat bubble body

#### Scenario: Markdown report delivered
- **WHEN** an employee emits `deliverable.created { fileName: 'report.md', mimeType: 'text/markdown' }`
- **THEN** the card renders in compact variant with a `FileText` lucide icon, `Download` + `Copy` buttons (Open is hidden because `canPreviewDeliverable` returns false for `text/markdown`)

### Requirement: Open button opens artifact in a new tab for renderable mimes
For artifacts with `mimeType = 'text/html'` (or other mimes accepted by `canPreviewDeliverable`), the compact card's `Open` button SHALL create a Blob URL and open it via `window.open(url, '_blank', 'noopener')`. The Blob URL SHALL be revoked after a short delay (≥ 5s) to avoid memory leak. The implementation SHALL live inside the shared primitive, not in per-callsite wrapper code.

#### Scenario: Open HTML artifact
- **WHEN** the user clicks `Open` on an HTML artifact card (compact variant, in chat bubble)
- **THEN** a new browser tab opens and renders the HTML as if it were a standalone file

#### Scenario: Open hidden for non-HTML mimes
- **WHEN** the artifact mimeType is not `text/html` (e.g. `text/markdown`, `text/csv`, `application/json`)
- **THEN** the Open button is not rendered in the compact variant

### Requirement: Download button triggers browser download
The `Download` button on the compact card SHALL trigger a standard browser download using `Blob` + `URL.createObjectURL` + an `<a download="filename">` click. The URL SHALL be revoked after the click. This logic lives in the shared primitive.

#### Scenario: Download artifact
- **WHEN** the user clicks `Download` on any compact-variant card
- **THEN** the browser downloads a file with the card's `fileName`; the file content byte-for-byte matches `artifactContent` emitted in the `deliverable.created` event

### Requirement: Copy button copies artifact content to clipboard
The `Copy` button in the compact variant SHALL copy the artifact content to clipboard via `navigator.clipboard.writeText(content)`. On success, the card SHALL show a transient "Copied!" indicator for 1–2 seconds. On rejection, the card SHALL NOT crash; a fallback (selection-based copy or silent no-op with console.warn) SHALL be used.

#### Scenario: Copy artifact
- **WHEN** the user clicks `Copy` on a compact-variant card and the environment is secure (HTTPS or localhost)
- **THEN** the artifact content is written to the clipboard, and a transient confirmation appears

#### Scenario: Clipboard blocked
- **WHEN** `navigator.clipboard.writeText` rejects
- **THEN** the card does NOT crash; the fallback path is exercised without user-facing error

### Requirement: Artifact cards appear only at final commit, not during streaming
The `<DeliverableCard variant='compact'>` SHALL NOT render inside `StreamingBubble`. It SHALL render only on the committed `MessageBubble` after the employee's run finalizes and the `deliverable.created` event has been processed.

#### Scenario: No artifact in streaming bubble
- **WHEN** the run is streaming (chunks arriving, `activeRun.isStreaming = true`)
- **THEN** no `<DeliverableCard>` is present in the DOM inside `StreamingBubble`

#### Scenario: Artifact appears at commit
- **WHEN** the run commits and `deliverable.created` has been received
- **THEN** the committed `MessageBubble` shows the compact card alongside the final text

### Requirement: Out-of-order event handling
If `deliverable.created` arrives after the chat message has already committed to the timeline, the UI SHALL retroactively attach a compact card to the matching committed message (identified by `taskRunId` or `employeeId + threadId + timestamp`), not drop the artifact.

#### Scenario: Late deliverable event
- **WHEN** a `deliverable.created` event arrives 500ms after the matching `MessageBubble` already rendered without a card
- **THEN** the compact card appears on that bubble within the next render tick, no duplicate message is created

### Requirement: Team chat and direct chat behave consistently
Compact-variant rendering rules SHALL be identical in team chat and direct-employee chat modes.

#### Scenario: Same card behavior in direct chat
- **WHEN** the user is in direct chat with an employee and that employee produces a file deliverable
- **THEN** the compact card appears under the final employee message exactly as in team chat

### Requirement: PitchHall compatibility preserved
The existing `PitchHall` component SHALL continue to receive deliverable events and function as it does pre-change. PitchHall internals SHALL NOT be exempt from the shared primitive — PitchHall renders `<DeliverableCard variant='full'>` for each item — but the outer container, `activeThreadId` filter, empty state, and layout are preserved. PitchHall is reachable via the Outputs sub-tab of the Tasks tab (see `deliverable-card-presentation` capability).

#### Scenario: PitchHall still works
- **WHEN** a deliverable is created while the Outputs sub-tab is active
- **THEN** PitchHall lists the deliverable with a `<DeliverableCard variant='full'>` entry; all pre-change actions (Copy / Download / Preview / Export / Save as SOP / Save locally / Open folder) remain accessible
