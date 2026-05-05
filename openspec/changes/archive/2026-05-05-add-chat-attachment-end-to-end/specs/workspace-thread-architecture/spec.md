## ADDED Requirements

### Requirement: Attachments are scoped at the chat-thread level, not the conversationKey level

Attachments SHALL be addressable by `(companyId, chatThreadId)` so a single attachment is reachable from team chat under that thread AND from any direct chat under the same thread (the conversationKey middle segment is the binding). Attachments SHALL NOT be scoped by the direct-target `employeeId` segment of the conversationKey. The `vaultRef` shape SHALL be `attachment://<companyId>/<threadId>/<attachmentId>` with NO `employeeId` segment.

The runtime SHALL surface every persisted attachment under thread T as `pendingAttachments` on any chat turn — team or direct — under T when the user explicitly attaches a file in the current turn. Cross-turn re-reading of an older attachment via `read_attachment(vaultRef)` SHALL succeed as long as the ref is still in the same `chat_thread`'s store, regardless of whether the new turn is team-chat or direct-chat under T.

#### Scenario: Attachment from team chat is reachable in direct chat under same thread

- **WHEN** the user sends an attachment in team chat under thread T1, then opens direct chat with employee Maya under T1, and the LLM invokes `read_attachment` with the original `vaultRef`
- **THEN** the read SHALL succeed and return the original bytes
- **AND** the `vaultRef` SHALL NOT contain Maya's `employeeId`

### Requirement: Historical attachments remain reusable across turns

Any attachment ref persisted in `ChatMessage.attachments` for any prior turn under thread T SHALL remain readable from any future turn under T via `read_attachment(vaultRef)` until either (a) the user hard-deletes the thread, project, or company, or (b) GC drops the blob as orphaned because no persisted message references it. The runtime SHALL NOT enforce a "current turn only" lifetime on attachment refs.

#### Scenario: Three-day-old attachment is readable today

- **WHEN** thread T contains a user message from three days ago with attachment ref R, and the user opens T today and dispatches a new turn that mentions "the PDF I sent earlier"
- **THEN** the LLM SHALL be able to invoke `read_attachment(R)` and receive the original bytes / structured parse
- **AND** the response SHALL be byte-identical to a same-day read

### Requirement: Hard delete cascades attachments through thread / project / company; soft archive retains

Hard delete of `chat_threads` (`projects.chatThreads.delete(threadId)`) SHALL cascade to deletion of every attachment scoped under that thread in both web (IDB) and desktop (filesystem) backends. Hard delete of `projects` SHALL cascade through `chat_threads` to attachments. Hard delete of `companies` SHALL cascade through projects to attachments. Soft archive (`archived_at` set) SHALL retain attachments; unarchive SHALL restore the bubbles with intact chips. The runtime SHALL emit `chat.attachment.gc.dropped` per removed ref with `reason: 'thread-deleted' | 'project-deleted' | 'company-deleted'` accordingly.

#### Scenario: Thread hard delete cascades

- **WHEN** the user hard-deletes thread T2 holding three attachments
- **THEN** all three blobs SHALL be deleted from the underlying store
- **AND** three `chat.attachment.gc.dropped` events SHALL fire with `reason: 'thread-deleted'`

#### Scenario: Project hard delete cascades through threads

- **WHEN** the user hard-deletes project P3 containing two threads with five total attachments
- **THEN** all five blobs SHALL be deleted
- **AND** five `chat.attachment.gc.dropped` events SHALL fire with `reason: 'project-deleted'`

#### Scenario: Company hard delete cascades fully

- **WHEN** the user hard-deletes company C1 containing two projects with ten total attachments
- **THEN** all ten blobs SHALL be deleted
- **AND** ten `chat.attachment.gc.dropped` events SHALL fire with `reason: 'company-deleted'`

#### Scenario: Soft archive retains and unarchive restores

- **WHEN** the user archives thread T3 (sets `archived_at`) instead of deleting it
- **THEN** all attachment blobs for T3 SHALL remain on the store
- **AND** unarchiving T3 SHALL restore the bubbles with intact chips
