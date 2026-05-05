## ADDED Requirements

### Requirement: Composer accepts files via three input modes

The chat composer (`ChatInput`) SHALL accept user-attached files through three intake modes that share a single staging pipeline: (a) a paperclip button that opens the platform file picker, (b) drag-and-drop of one or more files onto the composer surface, and (c) clipboard paste of files or images while the textarea has focus. All three modes SHALL produce the same in-memory `StagedAttachment` shape and SHALL deduplicate by `(filename, byteLength, sha256)` so the same file pasted twice does not stage twice. SHA-256 SHALL be computed client-side via `crypto.subtle.digest` and SHALL be carried into the persisted metadata.

The desktop runtime SHALL accept any local file the OS picker exposes, capped per file at 8 MB and per send at 32 MB total. The web runtime SHALL accept the same byte ceilings via the standard `File` / `DataTransfer` / `ClipboardEvent` APIs. Files exceeding the per-file cap SHALL be rejected at staging time with an inline composer error stating the cap and the offending filename. Drag-drop or selection of N files where some exceed caps SHALL accept the in-spec subset and reject only the overflow files, naming each rejected file inline.

#### Scenario: Paperclip opens the platform picker

- **WHEN** the user clicks the paperclip button in `ChatInput`
- **THEN** the platform file picker opens (Tauri dialog on desktop, `<input type="file" multiple>` on web)
- **AND** the chosen file appears as a removable chip under the textarea with filename, mime icon, and byte size

#### Scenario: Drag-and-drop stages files

- **WHEN** the user drags one or more files onto the composer surface and releases
- **THEN** each file is staged as a chip
- **AND** the composer surface SHALL show a visible drop affordance while a drag is over it

#### Scenario: Clipboard paste stages files and screenshots

- **WHEN** the textarea has focus and the user pastes (Cmd/Ctrl+V) with a file or image on the clipboard
- **THEN** the file is staged as a chip
- **AND** if the paste also contained text it SHALL still appear in the textarea

#### Scenario: Per-file cap enforces at staging

- **WHEN** the user attempts to stage a file whose `byteLength` exceeds 8 MB
- **THEN** the file SHALL NOT be added to the staged list
- **AND** an inline error SHALL render under the chip row naming the file and the cap

#### Scenario: Total send cap enforces before send

- **WHEN** the user has staged files whose combined `byteLength` exceeds 32 MB and presses send
- **THEN** the send SHALL be blocked with an inline error
- **AND** the chips SHALL remain in the composer untouched

#### Scenario: Drag-drop of N files accepts in-spec subset

- **WHEN** the user drops 5 files where 3 are within caps and 2 are oversize
- **THEN** the 3 in-spec files SHALL stage successfully
- **AND** the 2 oversize files SHALL render inline errors naming each rejected filename + the cap
- **AND** the composer SHALL NOT silently swallow any file

#### Scenario: Duplicate file is deduplicated

- **WHEN** the user stages a file whose `(filename, byteLength, sha256)` matches an already-staged chip
- **THEN** the duplicate SHALL NOT add a second chip
- **AND** an inline hint `Already attached` SHALL render briefly

### Requirement: Attachment-only sends are valid

The composer SHALL allow sending a chat turn that contains zero text characters and one or more staged attachments. The send button SHALL enable when `text.trim().length > 0 OR staged.length > 0`. An attachment-only send SHALL produce a user message with empty `content` and a non-empty `attachments` array; the runtime SHALL still dispatch the turn through the boss node and downstream graph normally.

#### Scenario: Attachment-only send dispatches the turn

- **WHEN** the user has staged one PDF and zero typed characters and presses send
- **THEN** the send button SHALL be enabled
- **AND** the resulting `ChatMessage` SHALL have `content = ''` and `attachments.length = 1`
- **AND** the boss node SHALL receive `pendingAttachments` with that ref and proceed with normal routing

### Requirement: Staged attachments persist on send and survive reload

On send, every `StagedAttachment` SHALL be written to the client attachment store keyed by `vaultRef = attachment://<companyId>/<threadId>/<attachmentId>` where `attachmentId` is a fresh UUIDv4. The resulting `ChatAttachmentRef` (`{ attachmentId, vaultRef, filename, mimeType, byteLength, kind, sha256, parsedRev }`) SHALL be embedded in the user `ChatMessage` and SHALL flow into LangGraph checkpoint state. After reload, every persisted user bubble SHALL render its attachment chips by reading refs from the checkpoint or in-memory chat-session-store and resolving filenames / sizes from the attachment store; clicking a chip SHALL open / download the file via the same store.

The web runtime SHALL persist blobs in IndexedDB under an object store `blobs` keyed by `vaultRef`, with a parallel `metas` object store for metadata-only listing and GC. The desktop runtime SHALL persist blobs at `<app_local_data_dir>/attachments/<companyId>/<threadId>/<attachmentId>.bin` plus sibling `.meta.json` carrying `{ filename, mimeType, byteLength, sha256, parsedRev, createdAt }`. Neither runtime SHALL persist raw bytes inside any LangGraph checkpoint, DB row, or zustand store.

#### Scenario: Sent message keeps its attachments after a hard reload

- **WHEN** the user sends a message with two attachments and refreshes the app
- **THEN** the user bubble SHALL still show two chips with the original filenames + sizes
- **AND** clicking a chip SHALL open the file (desktop) or trigger a save dialog (web)

#### Scenario: Web runtime stores blobs in IndexedDB

- **WHEN** the user sends an attachment in the web runtime
- **THEN** an IndexedDB blob record and metadata record SHALL exist keyed by the `vaultRef`
- **AND** no `chat_threads` row, `graph_threads` row, LangGraph checkpoint blob, or zustand store entry SHALL embed the bytes

#### Scenario: Desktop runtime stores blobs on disk

- **WHEN** the user sends an attachment in the Tauri desktop runtime
- **THEN** the file SHALL exist at `<app_local_data_dir>/attachments/<companyId>/<threadId>/<attachmentId>.bin`
- **AND** a sibling `.meta.json` SHALL hold `{ filename, mimeType, byteLength, sha256, parsedRev, createdAt }`

### Requirement: Document parsers ship in `@offisim/doc-engine/import` for PDF, DOCX, XLSX, PPTX, text, and image

`@offisim/doc-engine` SHALL expose `parseAttachment(bytes, mimeType, filename): Promise<ParsedAttachment>` returning a discriminated union covering `text`, `pdf`, `docx`, `xlsx`, `pptx`, `image`, `binary`, and `unsupported` kinds. Parsers SHALL produce identical output for identical input across web and Tauri runtimes (parser implementations are pure JS / TS; no native bindings).

- **PDF**: `pdfjs-dist` extracts text per page; output `{ kind: 'pdf', pages: string[], text: string }` where `text` is `pages.join('\n\n')`.
- **DOCX**: `mammoth` extracts plain text and HTML; output `{ kind: 'docx', text: string, html: string }`.
- **XLSX**: SheetJS parses workbook; output `{ kind: 'xlsx', sheets: [{ name, csv, rows }] }` where `rows` is `XLSX.utils.sheet_to_json(ws, { header: 1 })`.
- **PPTX**: `jszip` enumerates `ppt/slides/slide*.xml`, extracts `<a:t>` text per slide; output `{ kind: 'pptx', slides: string[], text: string }`.
- **Text-like** (`text/*`, `application/json`, `application/xml`, `application/yaml`, `application/javascript`, `application/typescript`, `text/markdown`, `text/csv`): UTF-8 decode with Latin-1 fallback for invalid sequences; output `{ kind: 'text', text }`.
- **Image** (`image/png`, `image/jpeg`, `image/webp`, `image/gif`): base64 + `width` + `height` extracted via `createImageBitmap`; output `{ kind: 'image', base64, width, height, format }`.
- **Unknown**: base64; output `{ kind: 'binary', base64 }`.
- **Unsupported / parser failure**: output `{ kind: 'unsupported', reason }` with a machine-readable reason code; the caller SHALL still have access to the raw bytes via `attachmentStore.read`.

A parser version stamp `parsedRev` SHALL be carried on `ChatAttachmentRef` and bumped whenever parser output schema changes; cached parsed outputs whose `parsedRev` mismatches SHALL be discarded and re-parsed.

Each parser SHALL have at least one fixture-based test plus a malformed-input test that asserts the parser fails with `{ kind: 'unsupported', reason }` rather than throwing.

#### Scenario: PDF parses to per-page text

- **WHEN** `parseAttachment(bytes, 'application/pdf', 'sample.pdf')` is invoked with a 12-page PDF fixture
- **THEN** the result is `{ kind: 'pdf', pages: string[<length=12>], text: string }`
- **AND** `pages[0]` contains the first page's text

#### Scenario: DOCX parses to text + html

- **WHEN** `parseAttachment(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'sample.docx')` is invoked
- **THEN** the result is `{ kind: 'docx', text, html }`
- **AND** `text` is non-empty and reflects the document's prose

#### Scenario: XLSX parses to sheets with csv + rows

- **WHEN** `parseAttachment(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'sample.xlsx')` is invoked with a 3-sheet workbook
- **THEN** the result is `{ kind: 'xlsx', sheets: [...<length=3>] }`
- **AND** each sheet entry has a non-empty `csv` and a `rows: any[][]` matrix

#### Scenario: PPTX parses to per-slide text

- **WHEN** `parseAttachment(bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'sample.pptx')` is invoked with a 5-slide deck
- **THEN** the result is `{ kind: 'pptx', slides: string[<length=5>], text: string }`

#### Scenario: Image parses to base64 + dimensions

- **WHEN** `parseAttachment(bytes, 'image/png', 'screenshot.png')` is invoked with a 1024×768 PNG
- **THEN** the result is `{ kind: 'image', base64, width: 1024, height: 768, format: 'png' }`

#### Scenario: Malformed PDF returns `unsupported`

- **WHEN** `parseAttachment(garbageBytes, 'application/pdf', 'bad.pdf')` is invoked with non-PDF bytes
- **THEN** the result is `{ kind: 'unsupported', reason: 'pdf-parse-failed' }`
- **AND** the parser SHALL NOT throw

#### Scenario: Parser output is byte-identical across web and Tauri

- **WHEN** the same fixture file is parsed in the web SPA and in Tauri webview within the same release tag
- **THEN** the resulting `ParsedAttachment` JSON serialization is byte-equal

### Requirement: AI reads attachments via gateway-only `read_attachment` tool registered on boss + every employee node

A `read_attachment` tool SHALL be registered on **both** the boss tool kit AND every employee tool kit when `env.lane === 'gateway' && env.attachmentStore != null`. The tool schema SHALL accept `{ vaultRef: string, max_bytes?: number, mode?: 'auto' | 'text' | 'binary' | 'structured' }` and SHALL return `{ filename, mimeType, byteLength, sha256, content, structured?, truncated }`. `mode='auto'` (the default) SHALL choose `text` for text-like mime, `structured` for known doc types (`pdf` / `docx` / `xlsx` / `pptx` / `image`), and `binary` (base64) for unknown.

The tool handler SHALL bound reads to 8 MB hard ceiling regardless of caller's `max_bytes`, mirroring the existing builtin sandbox limits. Reads that resolve to an unknown or already-deleted ref SHALL return a structured error `{ kind: 'attachment-not-found', vaultRef }` without throwing. Parser failure SHALL fall through to base64 with a `{ kind: 'parser-failed', vaultRef, parserKind, reason }` field included alongside the bytes so the model can still inspect raw content.

Historical attachments (older user messages under the same `chat_thread`) SHALL remain readable via explicit `read_attachment(vaultRef)` calls as long as the blob is in the store; the tool SHALL NOT enforce a "current turn only" restriction. The tool SHALL enforce `(companyId, chat_thread)` scope from the current run: refs from another company or another `chat_thread`, or calls without a run scope, SHALL return `{ kind: 'attachment-forbidden', vaultRef, reason }` without reading the store.

#### Scenario: Gateway lane registers the tool on boss and every employee

- **WHEN** the runtime initializes with `lane=gateway` and a chat turn is dispatched
- **THEN** the assembled tool kit for the boss node SHALL include a `read_attachment` schema
- **AND** the assembled tool kit for every employee node SHALL include a `read_attachment` schema
- **AND** the system preface for that turn SHALL list each `pendingAttachment` ref

#### Scenario: Read returns text content

- **WHEN** the LLM invokes `read_attachment` with a valid `vaultRef` for a 4 KB UTF-8 markdown file and `mode='auto'`
- **THEN** the tool result SHALL include `kind='text'`, full UTF-8 content in `content`, and matching `byteLength` + `mimeType`

#### Scenario: Read returns structured PDF parse

- **WHEN** the LLM invokes `read_attachment` for a 12-page PDF with `mode='auto'`
- **THEN** the tool result SHALL include `structured: { kind: 'pdf', pages: string[12], text }`
- **AND** `content` SHALL be the joined `text` for legacy callers

#### Scenario: Hard cap is enforced

- **WHEN** the LLM invokes `read_attachment` with `max_bytes=20_000_000` against a 12 MB file
- **THEN** the tool result SHALL truncate content at the 8 MB hard ceiling
- **AND** SHALL include `truncated: true` and the original `byteLength`

#### Scenario: Missing ref returns typed error

- **WHEN** the LLM invokes `read_attachment` with a ref that points at a GC'd or never-existing attachment
- **THEN** the tool SHALL return `{ kind: 'attachment-not-found', vaultRef }`
- **AND** SHALL NOT throw

#### Scenario: Parser failure falls through to base64

- **WHEN** the LLM invokes `read_attachment` for a corrupted DOCX and `mode='auto'`
- **THEN** the tool SHALL return `{ kind: 'parser-failed', vaultRef, parserKind: 'docx', reason }` AND `content` (base64 of raw bytes)
- **AND** the model can still inspect raw bytes if it chooses

#### Scenario: Historical attachment remains readable

- **WHEN** thread T contains a 3-day-old user message with attachment ref R, and the user opens T today and dispatches a new turn
- **THEN** the LLM SHALL be able to invoke `read_attachment(R)` successfully
- **AND** the response SHALL be identical to a same-day read

#### Scenario: Cross-thread or cross-company ref is forbidden

- **WHEN** a gateway-lane run under company C1 and thread T1 invokes `read_attachment` for a ref scoped to company C2 or thread T2
- **THEN** the tool SHALL return `{ kind: 'attachment-forbidden', vaultRef, reason }`
- **AND** the attachment store SHALL NOT be read

### Requirement: SDK lanes are fail-closed at four layers

`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` lanes SHALL refuse attachment access at four enforcement layers:

1. **Tool kit registration**: SHALL NOT register `read_attachment`. The schema SHALL be invisible to SDK adapters.
2. **Chat-send pre-flight**: when `state.pendingAttachments.length > 0 && env.lane !== 'gateway'`, the boss-node entry SHALL short-circuit BEFORE any model call and surface typed chat outcome `attachments-require-gateway-lane`. The user SHALL see a system message; no tokens SHALL be charged.
3. **System preface listing**: SHALL be built only when `lane === 'gateway'`. SDK-lane prompts SHALL NEVER carry `[attachment ...]` lines, even if `pendingAttachments` is non-empty in state.
4. **Adapter-side rejection**: existing `llmToolCallsEnabled=false` invariant on SDK adapters SHALL reject any unknown tool request, including `read_attachment` if a future bug bypasses layers 1–3.

Each layer SHALL have an explicit test asserting the contract.

#### Scenario: SDK tool kit does not register `read_attachment`

- **WHEN** the runtime initializes with `lane=claude-agent-sdk` and a chat turn carries attachments
- **THEN** the assembled tool kit SHALL NOT include `read_attachment`

#### Scenario: SDK lane pre-flight surfaces typed outcome

- **WHEN** the runtime is `lane=codex-agent-sdk` and the user sends a message with attachments
- **THEN** the chat turn SHALL surface the typed outcome `attachments-require-gateway-lane` to the user as a chat-level system message
- **AND** no model call SHALL be issued
- **AND** no provider tokens SHALL be charged

#### Scenario: SDK system preface never lists attachments

- **WHEN** an SDK lane chat turn is dispatched with non-empty `pendingAttachments` (e.g., a regression bypasses layer 2)
- **THEN** the assembled system message SHALL NOT contain any `[attachment ...]` lines

#### Scenario: SDK adapter rejects accidental tool request

- **WHEN** an SDK adapter receives a `read_attachment` tool request from the model
- **THEN** the adapter SHALL fail closed per the existing `llmToolCallsEnabled=false` contract
- **AND** SHALL NOT execute any filesystem or store read

### Requirement: Chat run scope carries `pendingAttachments`

Chat `RunScope` SHALL carry `pendingAttachments: ChatAttachmentRef[]` populated at user-submit time from the most recent user message's `attachments` field. The run scope SHALL propagate into gateway tool execution so manager and employee nodes can call `read_attachment` with current company/thread scope.

The system preface for any gateway-lane node receiving `pendingAttachments` SHALL list each ref as `[attachment <filename>, <mimeType>, <byteLength> bytes, ref=<vaultRef>, kind=<kind>, summary=<one-line preview>]` where `summary` is generated from parser output at staging time (e.g., "12 pages" for PDF; "3 sheets, 1024 rows" for XLSX; "1024×768" for image).

#### Scenario: Boss receives refs and propagates on dispatch

- **WHEN** the user sends a message with one PDF attachment and one PNG
- **THEN** the chat run scope SHALL carry `pendingAttachments` with both refs
- **AND** the boss system preface SHALL list both refs with kind + summary
- **AND** when the boss dispatches to employee Maya, Maya's tool calls SHALL inherit `pendingAttachments` through run scope
- **AND** Maya's system preface SHALL also list both refs

#### Scenario: Direct chat under same thread inherits store access

- **WHEN** the user attaches a file in team chat under thread T1, then opens direct chat with employee Alex under T1, and Alex's turn dispatches
- **THEN** Alex's `read_attachment(vaultRef)` SHALL succeed against the original blob
- **AND** the `vaultRef` SHALL contain no `employeeId` segment

### Requirement: Tauri binary IPC commands carry bytes without JSON encoding

The desktop runtime SHALL expose five Tauri commands: `attachment_write`, `attachment_read`, `attachment_list`, `attachment_list_all`, `attachment_delete`. `attachment_write` SHALL accept bytes via a binary-safe Tauri invoke arg (raw `Vec<u8>` via `InvokeBody::Raw`); bytes SHALL NOT be base64-encoded into a JSON string. `attachment_read` SHALL stream bytes back via the same binary mechanism, again without base64 round-trip. `attachment_list_all` SHALL recursively enumerate only `.meta.json` files and SHALL NOT read blob bytes. The `fs-shell` permission/capability SHALL declare an explicit allowlist for these five command names; missing any one SHALL be treated as a build-time failure via `scripts/check-attachment-capabilities.mjs` invoked from `apps/desktop` `prebuild`.

Each command SHALL constrain paths to `<app_local_data_dir>/attachments/<companyId>/<threadId>/...` and SHALL refuse paths containing `..` or absolute prefixes. `attachment_write` SHALL refuse writes whose `bytes.len()` exceeds 8 MB; `attachment_read` SHALL refuse reads whose `max_bytes` exceeds 8 MB. The web runtime SHALL implement the same operations against IndexedDB through a parallel TypeScript adapter that satisfies the same contract.

A wire-payload assertion test SHALL run as part of the Rust integration suite confirming raw `Vec<u8>` transport (write payload size within 256 bytes of `bytes.len()`, no base64 inflation).

#### Scenario: Write avoids base64 round-trip

- **WHEN** a 4 MB file is staged and the user presses send in the desktop runtime
- **THEN** the bytes SHALL cross the JS↔Rust boundary as raw `Vec<u8>` (or equivalent binary transport)
- **AND** the JS-side payload SHALL NOT contain a base64-encoded string of the bytes
- **AND** the Rust-side wire size SHALL be within 256 bytes of `bytes.len()`

#### Scenario: Path traversal is refused

- **WHEN** any IPC caller invokes `attachment_read` with a `vaultRef` decoding to a path containing `..`
- **THEN** the command SHALL return an `invalid-path` error
- **AND** SHALL NOT touch the filesystem

#### Scenario: Capabilities allowlist must list all five commands

- **WHEN** the `fs-shell` permission ships missing any of `attachment_write` / `attachment_read` / `attachment_list` / `attachment_list_all` / `attachment_delete`
- **THEN** the desktop build SHALL fail at the `prebuild` validation step with an explicit message naming the missing entry

### Requirement: Cross-platform parity is contractual

Every observable behavior in this capability SHALL be identical between the web SPA (in browser) and Tauri release `.app`, except the documented "IDB unavailable" web fallback. Parser outputs SHALL be byte-equal across platforms for identical inputs. Composer affordances (paperclip, drag-drop, paste, attachment-only send), staging behavior (dedupe, caps, sha256), persisted-bubble rendering, `read_attachment` semantics, GC cascade behavior, and event sequences SHALL all match.

Parity SHALL be enforced by the live verify checklist running every spec scenario on both platforms before archive.

#### Scenario: Same fixture renders identically on both platforms

- **WHEN** a user attaches the same fixture PDF on web SPA and on Tauri release `.app`
- **THEN** chip filename + size + parser-summary preview SHALL match byte-for-byte
- **AND** `read_attachment` invoked by the LLM SHALL return identical `structured` output

### Requirement: Lifecycle and GC cascade across thread / project / company hard delete

A boot-time GC pass SHALL enumerate persisted attachments and drop any whose parent `chat_threads` row no longer exists. Hard delete of a `chat_threads` row SHALL cascade to attachment deletion for that thread under both web (IDB) and desktop (filesystem) backends. Hard delete of a `projects` row SHALL cascade through `chat_threads` to attachments and remove child threads consistently across SQL-backed and memory-backed repos. Hard delete of a `companies` row SHALL cascade through projects to attachments and remove child projects / threads consistently across SQL-backed and memory-backed repos. Soft archive (`archived_at` set) SHALL retain blobs; unarchive SHALL restore the bubbles with intact chips.

GC SHALL emit a `chat.attachment.gc.dropped` event per dropped ref with `{ attachmentId, threadId, vaultRef, reason: 'orphaned' | 'thread-deleted' | 'project-deleted' | 'company-deleted' }`. GC SHALL NOT block runtime initialization; it SHALL run after first paint via `requestIdleCallback` (or `setTimeout(..., 0)` fallback) with a 50 ms time-slice per batch. A summary `chat.attachment.gc.swept` event SHALL fire at completion with `{ scanned, dropped, durationMs }`.

#### Scenario: Hard-deleted thread removes blobs

- **WHEN** the user hard-deletes thread T2 holding three attachments
- **THEN** all three blobs SHALL be deleted from the underlying store
- **AND** three `chat.attachment.gc.dropped` events SHALL fire with `reason: 'thread-deleted'`

#### Scenario: Project hard delete cascades to attachments

- **WHEN** the user hard-deletes project P3 containing two threads with attachments totalling five blobs
- **THEN** all five blobs SHALL be deleted
- **AND** five `chat.attachment.gc.dropped` events SHALL fire with `reason: 'project-deleted'`

#### Scenario: Company hard delete cascades fully

- **WHEN** the user hard-deletes company C1 containing two projects with attachments totalling ten blobs
- **THEN** all ten blobs SHALL be deleted
- **AND** ten `chat.attachment.gc.dropped` events SHALL fire with `reason: 'company-deleted'`

#### Scenario: Orphaned blob is dropped on boot

- **WHEN** an attachment blob exists on disk / in IDB but no message or checkpoint references its `vaultRef`
- **THEN** the next boot-time GC pass SHALL delete the blob
- **AND** SHALL emit `chat.attachment.gc.dropped` with `reason: 'orphaned'`

#### Scenario: Soft archive preserves blobs and unarchive restores

- **WHEN** the user archives thread T3 (sets `archived_at`) instead of hard-deleting it
- **THEN** the attachment blobs for T3 SHALL remain
- **AND** unarchiving T3 SHALL restore the bubbles with intact chips

### Requirement: Attachment events are observable on the runtime event bus

The runtime event bus SHALL emit events under the `chat.attachment.` prefix at every state transition: `chat.attachment.staged`, `chat.attachment.persisted`, `chat.attachment.read`, `chat.attachment.gc.dropped`, `chat.attachment.gc.swept`, `chat.attachment.failed`, `chat.attachment.evicted`. `EVENT_PREFIXES` (consumed by the event log store) SHALL include `chat.attachment.`. Activity feed mappers SHALL classify these events into a dedicated `Attachment` lane.

#### Scenario: Send produces the full event sequence

- **WHEN** the user stages one file and presses send
- **THEN** exactly one `chat.attachment.staged` event SHALL fire on intake
- **AND** exactly one `chat.attachment.persisted` event SHALL fire after the blob write completes
- **AND** the events SHALL carry `{ vaultRef, filename, byteLength, mimeType, sha256 }`

#### Scenario: AI read produces a single read event

- **WHEN** the LLM invokes `read_attachment` once and receives content
- **THEN** exactly one `chat.attachment.read` event SHALL fire
- **AND** the event SHALL carry `{ vaultRef, byteLengthRead, truncated, mode }`

### Requirement: Web runtime degrades to a typed `[evicted]` state on IDB eviction

When the web runtime cannot read a blob from IndexedDB because the browser has evicted it (quota reclamation, manual cache clear) — distinct from "private browsing IDB unavailable" — the affected user-bubble chip SHALL render the `[evicted]` variant: disabled chip, dimmed style, tooltip `No longer available locally. Re-attach to recover.`. The chip SHALL NOT render as a red error. A `chat.attachment.evicted` event SHALL fire with `{ vaultRef, filename }` for telemetry.

The user MAY re-attach the same file in a new message; the new attachment SHALL get a fresh `attachmentId` and `vaultRef`. The model invoking `read_attachment` against an evicted ref SHALL receive `{ kind: 'attachment-not-found', vaultRef }`.

#### Scenario: Evicted blob renders typed chip variant

- **WHEN** the web runtime reads a chip's `vaultRef` and the IDB store no longer has the blob
- **THEN** the chip SHALL render the `[evicted]` variant
- **AND** the chip click SHALL NOT trigger a download attempt
- **AND** a `chat.attachment.evicted` event SHALL fire with `{ vaultRef, filename }`

### Requirement: Web runtime falls back gracefully when IDB is unavailable

If the web runtime cannot open IndexedDB at all (private browsing, disabled storage, initial quota check fails), the composer SHALL disable the paperclip button and show inline hint `Attachments require browser storage access`. Drag-drop SHALL render a `Storage unavailable` error overlay. Clipboard paste SHALL drop file payloads while still pasting any text payload. The desktop runtime SHALL never enter this degraded mode.

#### Scenario: IDB unavailable in private browsing

- **WHEN** the web app launches where `indexedDB.open(...)` rejects
- **THEN** the paperclip button SHALL render disabled with a tooltip explaining the limitation
- **AND** drag-drop SHALL show a `Storage unavailable` error overlay instead of staging files
- **AND** clipboard paste SHALL drop file payloads while still pasting text

### Requirement: LangGraph checkpoint round-trips `pendingAttachments` losslessly

The `tauri-checkpoint-serialization` capability SHALL serialize and deserialize `pendingAttachments: ChatAttachmentRef[]` losslessly. A fixture round-trip test SHALL exist in this change asserting byte-equal output for a checkpoint containing a non-empty `pendingAttachments` array.

#### Scenario: Checkpoint round-trip is byte-equal

- **WHEN** a checkpoint with `pendingAttachments = [refA, refB]` is serialized and re-deserialized
- **THEN** the reconstructed state SHALL contain `pendingAttachments` byte-equal to the input
