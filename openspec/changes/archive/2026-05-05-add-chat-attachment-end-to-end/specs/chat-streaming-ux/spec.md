## ADDED Requirements

### Requirement: User bubbles render staged, persisted, evicted, and parser-error attachment chips

User-authored chat bubbles SHALL render any `ChatAttachmentRef[]` carried on the underlying `ChatMessage` as a chip row inside the bubble, one chip per attachment. Each chip SHALL display filename, mime icon, byte size, and parser-summary preview when available (e.g., "PDF · 12 pages", "XLSX · 3 sheets, 1024 rows", "1024×768"). Image chips SHALL render an inline thumbnail (max 240×180 CSS px, lazy-loaded via the attachment store, object URL revoked on unmount). Chips SHALL be openable: clicking SHALL open the file (desktop) or trigger a save dialog (web). Streaming behavior of assistant bubbles SHALL be unaffected.

Before send, staged-but-unsent attachments SHALL render as removable chips directly under the textarea (not inside the speech bubble), distinct from sent chips. After send, staged chips SHALL move into the user bubble and SHALL no longer be removable from there.

When the attachment store cannot resolve a ref (web IDB eviction, file deleted out of band on desktop), the chip SHALL render the `[evicted]` variant: disabled, dimmed, tooltip `No longer available locally. Re-attach to recover.`. When parsing failed at staging time, the chip SHALL render the `[parse error]` variant: still clickable for raw-bytes download, tooltip naming the parser error.

#### Scenario: User bubble shows persisted attachments after reload

- **WHEN** a thread has user messages with attachments and the app is reloaded
- **THEN** each user bubble SHALL render its attachment chips with original filename + size + parser summary
- **AND** clicking a chip SHALL open / download the file via the client attachment store

#### Scenario: Image chip renders inline thumbnail

- **WHEN** a user bubble has an image attachment with kind=`image`
- **THEN** the chip SHALL render an inline thumbnail at most 240×180 CSS px
- **AND** the underlying object URL SHALL be revoked on chip unmount

#### Scenario: Staged chips live under the textarea, sent chips live in the bubble

- **WHEN** the user has staged two files and pressed send
- **THEN** the chips SHALL move from the row under the textarea into the new user bubble
- **AND** the row under the textarea SHALL be empty
- **AND** the chips inside the bubble SHALL NOT show a remove (×) affordance

#### Scenario: Evicted chip variant is disabled with explanatory tooltip

- **WHEN** the runtime fails to resolve a chip's `vaultRef` from the attachment store on web (IDB eviction)
- **THEN** the chip SHALL render the `[evicted]` variant
- **AND** clicking SHALL NOT trigger a download attempt
- **AND** the tooltip SHALL read `No longer available locally. Re-attach to recover.`

#### Scenario: Streaming assistant bubble is not gated by attachments

- **WHEN** the user sends a message with attachments and the assistant begins streaming a reply
- **THEN** the assistant bubble streaming behavior (chunks, placeholder, reasoning, finalize) SHALL be identical to a no-attachment turn
- **AND** the assistant bubble SHALL NOT render the user's attachment chips

### Requirement: Attachment-only sends produce a valid user bubble

The composer SHALL allow a chat send with zero text content and one or more staged attachments. The resulting user bubble SHALL render with empty text content, only the attachment chip row, and SHALL preserve normal alignment / theming.

#### Scenario: Attachment-only send renders chips with no text body

- **WHEN** the user sends a message with one attachment and zero typed characters
- **THEN** the resulting user bubble SHALL render only the chip row
- **AND** the bubble SHALL NOT render an empty text content placeholder
