## Why

Chat input area today only ships text — users can't attach a file (image, PDF, DOCX, XLSX, PPTX, code, log) to a chat turn, so any "look at this thing" workflow has to detour through workspace files, Skill upload, or out-of-band paste. The Codex two-pass audit on `close-frontend-ux-debt` (2026-05-02) confirmed the surface is **end-to-end across five layers** (input UI → client persistence → thread / message contract → AI tool exposure → Tauri binary-safe IPC) plus **document parsing** (PDF/DOCX/XLSX/PPTX have no importer in `@offisim/doc-engine` today — only exporters). We pull this out as its own change so all five layers + the parser layer are designed and shipped together as production 1.0; the in-memory `InMemoryUploadRefResolver` (skill-install single-shot) is not silently overloaded into a long-lived chat artifact, and we do NOT punt parser implementation to a follow-up.

## What Changes

- New chat composer affordances: paperclip button, drag-and-drop into the chat composer, image / file paste from clipboard. Staged attachments render as removable chips under the textarea before send. **Attachment-only sends** are supported (zero text + ≥ 1 attachment is a valid send).
- New client-side attachment store with persistence. **Web** → IndexedDB blobs in `offisim-chat-attachments`. **Desktop** → workspace-scoped folder under `<app_local_data_dir>/attachments/<companyId>/<threadId>/<attachmentId>.bin` plus sibling `.meta.json`. Both backends implement the same `AttachmentStore` interface; behavior parity is a hard requirement, not a "best effort."
- New thread / message contract: `ChatMessage.attachments?: ChatAttachmentRef[]` carrying `{ attachmentId, vaultRef, filename, mimeType, byteLength, kind, parsedRev }`. User bubbles render attachments inline; `RunScope.pendingAttachments` carries current-turn refs into gateway tool execution.
- New AI-side `read_attachment` builtin tool registered in the **gateway lane only**. Tool schema accepts `{ vaultRef, max_bytes?, mode? }` where `mode ∈ { 'auto' | 'text' | 'binary' | 'structured' }`. Returns `{ filename, mimeType, byteLength, content, structured?, truncated }` where `structured` carries parsed pages / sheets / slides for known doc types.
- **New document parsers in `@offisim/doc-engine`** (importer side, not just exporter): PDF via `pdfjs-dist`, DOCX via `mammoth`, XLSX via SheetJS (already a dep), PPTX via `jszip` + XML walk. Plain text / source / JSON / markdown / log files decoded as UTF-8. Images return base64 plus extracted dimensions. Every parser covered by deterministic fixture tests.
- New Tauri binary-safe IPC: `attachment_write`, `attachment_read`, `attachment_list`, `attachment_list_all`, `attachment_delete`. Bytes cross Rust↔JS via `Vec<u8>` raw IPC arg / return — base64 round-trip is forbidden in the hot path. `attachment_list_all` recursively reads metadata only for desktop GC.
- New `AttachmentStore` runtime injection (web + tauri); the skill-install `InMemoryUploadRefResolver` stays untouched.
- **Multi-layer fail-closed against SDK lanes**: gateway-only tool registration is landed; SDK adapters' existing fail-closed contract (`llmToolCallsEnabled=false`) catches any tool request that slipped through. Explicit typed `attachments-require-gateway-lane` chat-send pre-flight and system-preface listing remain open tasks before archive.
- **Run-scope routing**: when the user's turn carries attachments, refs are stored on `RunScope.pendingAttachments`; gateway tool calls inherit the run scope so `read_attachment` can enforce current `(companyId, threadId)`. Historical attachments (older messages with attachment refs) are accessible from any future turn under the same `chat_thread` via explicit `read_attachment(vaultRef)` calls.
- **Lifecycle / GC closure**: hard-delete of `chat_threads` cascades to attachment deletion; soft archive retains; unarchive restores; project hard-delete cascades through `chat_threads` to attachments; company hard-delete cascades through projects to attachments. Boot-time GC sweep drops parent-missing orphan blobs. Web-side IDB quota eviction surfaces a typed `[evicted]` chip variant; the user can re-attach the same file to recover.
- **Cross-platform parity** is contractual: every requirement scenario MUST pass on both web SPA (in-browser) and Tauri release `.app`. Behavior divergence is a bug, not a degraded mode — except the documented "IDB unavailable" private-browsing fallback, which is itself fully spec'd.

## Capabilities

### New Capabilities

- `chat-attachments-end-to-end`: Full pipeline for user-attached files in chat — composer affordances (3 input modes + attachment-only send), client persistence (IDB / filesystem with parity), thread / message contract, document parsers (PDF/DOCX/XLSX/PPTX/text/image), AI read-by-ref tool with structured output, Tauri binary-safe IPC, multi-layer SDK fail-closed, full lifecycle / GC closure across thread / project / company delete cascades.

### Modified Capabilities

- `chat-streaming-ux`: User message contract gains `attachments` field; new requirements cover staged + persisted user-bubble rendering, attachment-only sends, and the typed `[evicted]` chip variant. Assistant streaming behavior is unchanged.
- `workspace-thread-architecture`: New requirements cover attachment scoping by `(companyId, threadId)` (reachable from team chat AND any direct chat under the thread), historical-ref reusability across turns, and the cascade contract on hard-delete vs. soft-archive at thread / project / company levels.

## Impact

**Code (new)**
- `packages/shared-types/src/chat-attachments.ts` — `ChatAttachmentRef`, `StagedAttachment`, `VaultRef` branded type, `AttachmentKind`, `parseVaultRef`, parser output types
- `packages/shared-types/src/events/chat-attachment-events.ts` — `chat.attachment.{staged,persisted,read,gc.dropped,gc.swept,failed,evicted}` payload types
- `packages/doc-engine/src/import/{index,pdf,docx,xlsx,pptx,text,image}.ts` — full parser suite with deterministic outputs
- `packages/doc-engine/test/import/fixtures/` — at least one fixture per parser plus malformed-input tests
- `packages/ui-office/src/lib/attachment-store.ts` — `AttachmentStore` interface + shared utilities
- `apps/web/src/lib/web-attachment-store.ts` — IndexedDB backend
- `apps/web/src/lib/tauri-attachment-store.ts` — Tauri IPC backend
- `apps/web/src/lib/attachment-gc.ts` — boot-time orphan sweeper
- `apps/desktop/src-tauri/src/attachment_store.rs` — five binary-safe IPC commands + integration tests
- `scripts/check-attachment-capabilities.mjs` — prebuild gate for the five-command allowlist
- `packages/core/src/tools/builtin/read-attachment-tool.ts` — gateway-lane tool def + handler
- `packages/core/src/runtime/attachment-store-bridge.ts` — runtime injection contract

**Code (modified)**
- `packages/ui-office/src/components/chat/{ChatInput,ChatPanel,MessageBubble,chat-session-store}.tsx` — staged chips, drag/drop/paste handlers, sent-bubble chips, attachment-only send, evicted chip variant
- `packages/core/src/agents/{boss-node,employee-tool-kit,manager-node}.ts` — propagate `RunScope` through dispatch / tool execution; explicit system preface listing remains open before archive
- `packages/core/src/agents/sdk-adapters/{claude-agent,codex-agent,openai-agents}.ts` — confirm fail-closed on accidental `read_attachment` calls; add explicit test
- `packages/core/src/runtime/repositories.ts` + per-family `chat-threads/{drizzle,memory}.ts` + `apps/web/src/lib/tauri-repos/<chat-threads-family>.ts` — `delete()` cascades to `attachmentStore.deleteByThread()`
- `packages/core/src/runtime/repos/projects/{drizzle,memory}.ts` + Tauri parallel — project delete cascades through chat threads to attachments
- `packages/core/src/runtime/repos/companies/{drizzle,memory}.ts` + Tauri parallel — company delete cascades
- `apps/web/src/lib/{browser-runtime,tauri-runtime}.ts` — register `AttachmentStore` per platform
- `apps/desktop/src-tauri/src/lib.rs` — register the five commands after `single-instance`
- `apps/desktop/src-tauri/permissions/fs-shell.toml` — allowlist the five commands
- `apps/desktop/package.json` — `prebuild` script invokes the new capabilities check
- `packages/db-local/src/schema.{ts,sql}` — no new table; if cross-thread enumeration becomes the perf bottleneck on web during apply, add a `chat_attachments_index` table on **both** files (lockstep, single-baseline, no migration script)

**Public surface**
- `read_attachment` tool name reserved on the gateway-lane tool kit for boss + every employee node.
- New runtime event prefix `chat.attachment.` registered in `EVENT_PREFIXES`; event log store, activity feed, and `useEventLogStore` see attachment events.
- Planned typed chat outcome `attachments-require-gateway-lane` rendered as a chat-level system message via `interaction-follow-up.ts` remains open before archive.

**Dependencies (new npm)**
- `pdfjs-dist` (Mozilla pdf.js) — PDF text extraction in browser + webview
- `mammoth` — DOCX → plain text + HTML
- `jszip` — PPTX zip walk + XML extraction
- `sha2` + `hex` — desktop-side sha256 verification on read / write

**Out of scope (true non-goals only)**
- Image annotation / cropping / markup in the bubble (read-only; bubble shows filename + thumbnail).
- Cross-device sync of attachments (single-device only; aligns with existing vault and credential isolation models).
- Server-side fan-out to A2A external employees (external lane is product-text-only by invariant; `attachments-require-gateway-lane` typed outcome covers this).
- Editing / re-uploading an attachment after send (delete-message semantics only; user re-attaches in a new message).
- OCR over image content in v1 — image attachments return base64 + dimensions for vision-capable LLMs to ingest. (Future change can add Tesseract / vendor OCR.)
