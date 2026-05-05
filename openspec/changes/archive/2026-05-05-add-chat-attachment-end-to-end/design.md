## Context

Chat in Offisim today is text-only. The composer (`packages/ui-office/src/components/chat/ChatInput.tsx`) accepts a textarea + slash menu + mention menu and nothing else: no DOM listener for `dragover` / `drop` / `paste` files, no file picker affordance, `canSend` requires non-empty text. User messages flow through `chat-session-store.ts` (zustand, in-memory) and through LangGraph checkpoints (`graph_checkpoints` table); there is no `chat_messages` table. Any attachment metadata has to ride on those two transports.

`@offisim/doc-engine` today is **export-only**: it pulls `pdf-lib`, `docx`, `xlsx` (SheetJS), `pptxgenjs` to *generate* documents. There are zero importers, so PDF/DOCX/XLSX/PPTX read paths do not exist. We add the importers in this change rather than punting to a follow-up — production 1.0 means the model can actually read the file types users will paste.

The repo already has **one** upload primitive — `InMemoryUploadRefResolver` (`apps/web/src/lib/skill-install-env.ts`) — used by the skill-install LLM tool path. It is a single-shot, in-memory map whose entries are **consumed on resolve**. That shape is wrong for chat:

- Chat attachments must outlive a single tool call (the LLM may re-read across reasoning + answer).
- They must outlive page reloads (user scrolls back to a 3-day-old message and clicks the chip).
- They must survive the JS↔Rust boundary in Tauri without base64 inflation (8 MB blobs through JSON IPC ≈ 11 MB string + parse + GC churn).
- They must remain reachable from any future turn under the same `chat_thread`, including direct-chat sub-conversationKeys.

The employee Vault (`packages/core/src/vault/`) is unrelated — Obsidian-style markdown mirror of employee state, governed by frontmatter rules. Chat attachments are binary user uploads; they do NOT live inside the employee vault tree.

Constraints framing the decisions:

- **Binary IPC** — Tauri 2 supports raw `Vec<u8>` invoke args. We opt in; the default codegen base64-encodes.
- **CSP** — release CSP `connect-src` and platform CORS are enforced by `scripts/check-platform-tauri-origin-sync.mjs`. Local-only attachment IO doesn't touch network so CSP is unaffected.
- **Capabilities triple-check** — adding any Tauri command requires `Cargo.toml` plugin / `lib.rs` register / `capabilities/default.json` allowlist; missing any one is the documented Phase-1c silent-no-op trap. We add a `prebuild` validator.
- **SDK lane fail-closed** — `claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk` set `llmToolCallsEnabled=false` and reject any tool request. Our design must cooperate at four layers: tool kit registration, chat-send pre-flight, system preface, adapter-side rejection.
- **Web/Tauri parity** — same observable behavior on both platforms, except the explicit "IDB unavailable" web fallback. Parser outputs are byte-identical for the same input.
- **No data migration** — pre-release; dirty data dropped via release run action. Schema changes touch both `schema.ts` and `schema.sql` in lockstep without migration.

## Goals / Non-Goals

**Goals:**
- One staging path that serves paperclip click, drag-drop, and clipboard paste with the same internal shape; supports attachment-only sends.
- Persistence model that survives reload via the existing checkpoint + zustand transports; web (IDB) and desktop (filesystem) reach byte-level parity.
- Binary-safe Tauri IPC for blob writes / reads — no base64 round-trip in the hot path.
- Real document parsers for PDF / DOCX / XLSX / PPTX shipped in this change, with fixture tests and structured outputs (pages / sheets / slides).
- AI-side ergonomics: model knows refs exist via system preface, opts into reading via `read_attachment`, gets bounded text/binary/structured back. Boss + every employee node both register the tool when lane=gateway. Historical refs (older messages under the same thread) are reachable from any future turn.
- SDK lane gating that's loud and enforced at four layers — the user sees `attachments-require-gateway-lane` BEFORE any model call wastes tokens.
- Lifecycle / GC closure: hard-delete cascades at thread / project / company; soft archive retains; unarchive restores; orphan sweep on boot.
- Cross-platform parity is contractual — every spec scenario passes on both web and Tauri release `.app`.

**Non-Goals:**
- Image annotation / cropping / markup in the bubble (read-only).
- Cross-device sync of attachments.
- A2A external employee receiving attachments (text-only by invariant).
- Editing / re-uploading after send (re-attach to a new message).
- OCR over image content in v1.
- Streaming partial reads of large files (8 MB cap → one-shot is faster than streaming overhead).

## Decisions

### Decision 1 — Storage location is per-platform, scope is `(companyId, threadId)`

- **Web**: IndexedDB database `offisim-chat-attachments`, `blobs` object store keyed by `vaultRef` for `{ bytes: Blob, meta }` and a parallel `metas` object store keyed by `vaultRef` for metadata-only listing / GC. Uses the browser's `structured-clone` for Blob storage and avoids pulling blobs into JS heap when only metadata is needed.
- **Desktop**: Files under `<app_local_data_dir>/attachments/<companyId>/<threadId>/<attachmentId>.bin` plus `<attachmentId>.meta.json`. Reuses the same dir pattern as `runtime_secret.txt` and vault directories, NOT inside vault tree.
- **Scope key is `(companyId, threadId)`** — explicitly NOT `conversationKey` — so attachment is reachable from team chat and any direct chat under the same thread (per `workspace-thread-architecture` Decision 2).
- Both backends record `sha256` in metadata to support cross-message deduplication when the same file is sent twice in a thread (we still write a fresh attachmentId — dedup is observability, not storage).
- **Alternative considered**: Store inside the per-employee vault directory. Rejected — pollutes the markdown source-of-truth domain, breaks vault frontmatter invariants, forces direct-chat-only semantics that contradict workspace-thread-architecture.
- **Alternative considered**: SQLite `chat_attachments` BLOB table. Rejected — row-size hurts hot-path query perf; filesystem + IDB is simpler and lets us escape SQLite's blob ceiling.

### Decision 2 — `vaultRef` is a URN-like string with strict validation

- Format: `attachment://<companyId>/<threadId>/<attachmentId>` where `<attachmentId>` is UUIDv4.
- `parseVaultRef(s)` in `packages/shared-types/src/chat-attachments.ts` rejects `..`, missing segments, non-UUID `attachmentId`, path-relative shapes. Returns `{ kind: 'ok', ref } | { kind: 'invalid', reason }`.
- The string is stable, embeddable in `ChatMessage`, serializable into LangGraph checkpoints, loggable.

### Decision 3 — Tauri IPC uses raw `Vec<u8>` invoke args

- `attachment_write` accepts `(metadata: AttachmentMeta, bytes: Vec<u8>)` via standard `tauri::command` with `Vec<u8>` arg + `InvokeBody::Raw` transport. JS caller passes `Uint8Array` / `ArrayBuffer`; bytes do NOT base64-round-trip.
- `attachment_read` returns `Vec<u8>` directly; JS receives `ArrayBuffer`.
- `attachment_list(companyId, threadId)` returns `Vec<AttachmentMeta>` (JSON-fine because metadata is small).
- `attachment_list_all()` recursively enumerates only `.meta.json` files under the attachment root so desktop GC can see persisted blobs without reading binary payloads.
- `attachment_delete(vaultRef)` returns `Result<(), AttachmentError>`.
- Each command constrains paths to `<app_local_data_dir>/attachments/<companyId>/<threadId>/...` and refuses `..` / absolute prefixes.
- `Channel<Vec<u8>>` was considered for streamed reads. Rejected at 8 MB cap — one-shot beats streaming overhead.

### Decision 4 — Document parsers ship as `@offisim/doc-engine` import side

- New module: `packages/doc-engine/src/import/` exporting `parseAttachment(ref, bytes, mimeType): Promise<ParsedAttachment>`. `ParsedAttachment` is a discriminated union: `{ kind: 'text', text }`, `{ kind: 'pdf', pages: string[], text }`, `{ kind: 'docx', text, html }`, `{ kind: 'xlsx', sheets: [{ name, csv, rows }] }`, `{ kind: 'pptx', slides: string[], text }`, `{ kind: 'image', base64, width, height, format }`, `{ kind: 'binary', base64 }`, `{ kind: 'unsupported', reason }`.
- **PDF**: `pdfjs-dist` legacy build (Node + browser compatible). Worker configured at runtime: web → `/pdf.worker.min.js` static asset; Tauri → bundled in app via `@tauri-apps/api/path` + `convertFileSrc`. Text extraction iterates `getDocument(...).getPage(i).getTextContent()`.
- **DOCX**: `mammoth.extractRawText({ arrayBuffer })` → `{ value: text, messages }`. We discard messages (warnings) but log them.
- **XLSX**: SheetJS already a dep. `XLSX.read(bytes, { type: 'array' })` → workbook → per-sheet `XLSX.utils.sheet_to_csv(ws)` plus `sheet_to_json(ws, { header: 1 })` for `rows`.
- **PPTX**: `jszip.loadAsync(bytes)` → enumerate `ppt/slides/slide*.xml` → DOMParser-equivalent (use a tiny XML walker since DOMParser is browser-only and we want Node-compatible parser code) → extract `<a:t>` text nodes per slide.
- **Plain text** (`text/*`, `application/json`, `application/xml`, `application/yaml`, `application/x-sh`, `application/javascript`, `application/typescript`, `text/markdown`, common code mime types in a curated allowlist): TextDecoder UTF-8 with fallback to Latin-1 for invalid sequences.
- **Image** (`image/png` / `image/jpeg` / `image/webp` / `image/gif`): base64 + dimensions extracted via `createImageBitmap(blob).then(b => ({width:b.width,height:b.height}))` (works in browser + Tauri webview).
- **Unknown / binary**: base64 + `kind: 'binary'`.
- All parsers run client-side (browser / webview), keeping desktop and web parity. No Rust-side parsing — keeps attack surface and dep tree simpler.
- Parser version stamp: `parsedRev` in `ChatAttachmentRef` increments when the parser library or output schema changes; tool calls re-parse on cache miss. Initial value comes from shared `CURRENT_PARSED_REV = 1` so staging and send cannot drift.
- **Alternative considered**: stream parsed output through a Rust sidecar. Rejected — adds new sidecar process, multi-platform complexity, no clear gain at 8 MB.
- **Alternative considered**: parse lazily on first `read_attachment` call only. Rejected — staging-time parse means the user sees an inline preview hint (e.g., "PDF · 12 pages") on the chip, and we surface parser errors in the composer not deep in the agent run.
- **Alternative considered**: defer doc-engine importers, return base64 in v1. Rejected by user direction — production 1.0.

### Decision 5 — `read_attachment` is gateway-lane, registered on boss + every employee node

- Tool def: `{ name: 'read_attachment', schema: { vaultRef: string, max_bytes?: number, mode?: 'auto' | 'text' | 'binary' | 'structured' } }`.
- Wired into the core builtin gateway tool assembly shared by boss, manager, and employee execution, gated on `executionMode='gateway' && attachmentStoreBridge != null`.
- Default `mode='auto'`: `text` for text-like mime, `structured` for known doc types (PDF/DOCX/XLSX/PPTX/image), `binary` (base64) for unknown. Caller can force a mode.
- Returns `{ filename, mimeType, byteLength, content, structured?, truncated, sha256 }`. `content` is utf-8 string for text mode, base64 string for binary mode, JSON-stringified summary for structured mode (full structured payload also under `structured`).
- 8 MB hard cap on read; mirrors `builtin_tools.rs` constants. Larger files return `truncated: true` with metadata intact.
- Missing / GC'd ref: returns `{ kind: 'attachment-not-found', vaultRef }` typed error. Does NOT throw.
- Scope mismatch: current run scope must match the ref's `(companyId, threadId)`. Cross-company, cross-thread, or missing-scope reads return `{ kind: 'attachment-forbidden', vaultRef, reason }` before touching the store.
- Parser failure: returns `{ kind: 'parser-failed', vaultRef, parserKind, reason }` AND falls back to base64 so the model can still see the bytes if it wants to.
- **Alternative considered**: only register on the active dispatch target. Rejected — boss summary needs to read what the user attached, employee needs to read for actual work; both register.

### Decision 6 — Chat run scope carries `pendingAttachments`

- `RunScope` gains `pendingAttachments: ChatAttachmentRef[]`. `ChatPanel.handleSend` copies refs from the submitted user message into the run scope before calling `sendMessage`.
- Tool calls receive the same run scope through `config.configurable.runScope`, so manager / employee tool execution can pass scope into `read_attachment`.
- System preface (per turn, only when `lane === 'gateway'`) lists each ref as: `[attachment <filename>, <mimeType>, <byteLength> bytes, ref=<vaultRef>, kind=<image|pdf|docx|xlsx|pptx|text|binary>, summary=<one-line preview>]`. The summary is generated at staging time from parser output (e.g., "12 pages, 4823 chars" for PDF; "3 sheets, 1024 rows" for XLSX).
- Historical attachments: if user references "the PDF I sent yesterday", the model can call `read_attachment(vaultRef)` for any ref in the same `chat_thread`. The system preface lists ONLY current-turn refs to keep prompt bounded; older refs surface via `chat.attachment.list` (not exposed to the model — internal tool only) OR the model recalls the ref string from prior turns it has in context.
- Direct-chat under the same thread inherits the same store; refs created in team chat are reachable in direct chat under that thread (per `workspace-thread-architecture` modified spec).

### Decision 7 — Multi-layer SDK fail-closed

Four enforcement layers, all tested:

1. **Tool kit registration**: `if (env.lane === 'gateway' && env.attachmentStore) registerReadAttachment()`. SDK-lane runtime never sees the schema.
2. **Chat-send pre-flight**: in boss-node entry, `if (state.pendingAttachments.length > 0 && env.lane !== 'gateway') return { outcome: 'attachments-require-gateway-lane' }` BEFORE any model call. Surfaces typed system message.
3. **System preface listing**: only built when `lane === 'gateway'`. SDK-lane prompts never carry the `[attachment ...]` lines.
4. **Adapter-side rejection**: existing `llmToolCallsEnabled=false` invariant — adapters reject any unknown tool request. Add explicit test that asserts `read_attachment` calls are rejected.

### Decision 8 — Composer drag-drop / paste / paperclip / attachment-only send

- Three intake handlers in `ChatInput`: paperclip click → file picker; `onPaste` on textarea → `clipboardData.files`; `onDragEnter / onDragOver / onDragLeave / onDrop` on the wrapper → `dataTransfer.files`. All funnel through `handleStaging(files: File[])`.
- `handleStaging` applies dedupe by `(filename, byteLength, sha256)` (compute sha256 client-side via `crypto.subtle.digest`) → per-file 8 MB cap → total 32 MB cap. Rejected files surface inline error naming the offending file.
- Staged state is local to `ChatInput` (`useState<StagedAttachment[]>`); `onSend` callback signature gains `attachments?: StagedAttachment[]`.
- `canSend = (text.trim().length > 0 || staged.length > 0) && !disabled`. Attachment-only send (zero text, ≥ 1 attachment) is valid.
- Visual: chip row above the hint line, below the textarea, only when `staged.length > 0`. Drop overlay is a full-cover absolute div with `pointer-events: none` until `onDragEnter`.
- After send, chips move into the bubble (sent-chip styling) and the row under textarea clears. Sent chips have NO remove (×); removal is delete-message semantics.
- Web fallback when `storageAvailable === false`: paperclip disabled with tooltip; drag-drop overlay shows `Storage unavailable`; paste files dropped (text portion preserved). `idbAvailable` remains as a deprecated compatibility alias only.

### Decision 9 — Image and parser-error UX in the bubble

- Image chips render an inline thumbnail (max 240×180 CSS px, lazy-loaded via the store's `read(ref)` returning a `Blob` and `URL.createObjectURL`, revoked on unmount).
- Other doc chips render mime icon + filename + size + parser summary preview (e.g., "PDF · 12 pages").
- **Evicted variant** (`[evicted]`): when `attachmentStore.read` returns `attachment-not-found` for a chip — IDB quota reclamation on web, file deleted out-of-band on desktop, GC misfire — the chip renders disabled with tooltip `No longer available locally. Re-attach to recover.` It does NOT show a red error; eviction is expected for old web threads.
- **Parser-failed variant** (`[parse error]`): chip still clickable for raw-bytes download; tooltip names the parser error.

### Decision 10 — GC + cascade lifecycle

- Boot-time GC via `attachmentGcSweeper.run()` from `App.tsx` post-mount, idle-callback wrapped, NOT awaited. Algorithm: enumerate all persisted metadata via `attachmentStore.listAll()`; drop entries whose parent `chat_threads` row no longer exists. This directly covers out-of-band deletes and the desktop filesystem case that previously swept zero rows.
- Hard delete cascades:
  - `repos.chatThreads.delete(threadId)` → `attachmentStore.deleteByThread(threadId)` BEFORE the SQL delete commits. Emit `chat.attachment.gc.dropped` per ref with `reason: 'thread-deleted'`.
  - `repos.projects.delete(projectId)` → enumerate child threads → delete attachments → delete child threads → delete project. This keeps SQL-backed, Tauri-backed, and memory-backed repos behaviorally aligned even where DB foreign keys are absent.
  - `repos.companies.delete(companyId)` → enumerate projects → child threads → delete attachments → delete child threads / projects → delete company.
- Soft archive (`archived_at` set) retains blobs. Unarchive restores bubbles with intact chips.
- GC pass time-slices to ≤ 50 ms per idle callback batch and resumes next idle tick. Telemetry event `chat.attachment.gc.swept` emits at completion with `{ scanned, dropped, durationMs }`.
- **Alternative considered**: lazy GC on first use. Rejected — orphans accumulate quota; boot-time sweep is bounded and cheap.

### Decision 11 — `chat_attachments_index` table is provisional, not in v1

- v1 ships without the table. GC walks IDB / filesystem (bounded by per-thread directory enumeration which is O(per-thread).
- Add the table only if telemetry shows boot delays beyond 200 ms median during apply phase. Schema in waiting (single-baseline policy):
  ```sql
  CREATE TABLE chat_attachments_index (
    attachment_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    thread_id TEXT NOT NULL REFERENCES chat_threads(thread_id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    parsed_rev INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_chat_attachments_thread ON chat_attachments_index(thread_id, created_at);
  ```
- The index would let GC do a single SQL anti-join instead of filesystem walks. Decision criteria: if median GC scan exceeds 200 ms on a 200-attachment dataset during apply-phase live verify, add the table within this change.

### Decision 12 — Checkpoint serialization round-trip

- `pendingAttachments` is a plain JSON-serializable array of `ChatAttachmentRef` objects. Existing `tauri-checkpoint-serialization` capability covers JSON; we add an explicit fixture in `packages/core/harness/scenarios/` (or the live `tauri-checkpoint-serialization` test surface — verify which is the canonical entry during apply) round-tripping a checkpoint with `pendingAttachments: [ref, ref]` → byte-equal output.

## Risks / Trade-offs

- **[Risk]** Tauri IPC `Vec<u8>` raw transport behavior changes across plugin / CLI versions → **Mitigation**: integration test in `apps/desktop/src-tauri/src/attachment_store.rs` asserts wire-payload size ≈ `bytes.len()` (within 256 byte envelope), failing the build if base64 inflation reappears. Locked to Tauri 2.x.
- **[Risk]** `pdfjs-dist` worker bundling differs between web (`/pdf.worker.min.js`) and Tauri (`tauri://localhost`-served asset) → **Mitigation**: worker resolver helper in `packages/doc-engine/src/import/worker-resolver.ts` injects platform-correct URL; integration test parses a fixture PDF on both web SPA and Tauri release `.app`.
- **[Risk]** `mammoth` outputs slightly different whitespace across versions → **Mitigation**: pin to a specific minor; fixture-based tests assert canonical output. If upstream changes whitespace we bump `parsedRev` and re-parse cached entries.
- **[Risk]** Web users in private browsing get a crippled UX → **Mitigation**: explicit disabled state + tooltip; we do NOT silently pretend it works. Spec'd as a first-class scenario.
- **[Risk]** GC sweep on boot is slow with thousands of attachments → **Mitigation**: idle-callback dispatch with 50ms time slice + provisional `chat_attachments_index` table (Decision 11). Decision criteria explicit.
- **[Risk]** SDK adapter sees `read_attachment` schema if a future contributor forgets the lane gate → **Mitigation**: four-layer fail-closed (Decision 7). Tests cover each layer; CI enforces.
- **[Risk]** LangGraph checkpoint bloat from accumulated `pendingAttachments` over many turns → **Mitigation**: only the current turn's refs are in agent state; older refs live in `ChatMessage.attachments` (zustand + checkpoint message history) only. Carried state size is O(current turn).
- **[Risk]** SHA-256 dedupe in browser blocks main thread for large files → **Mitigation**: `crypto.subtle.digest` is async + GPU-accelerated where available; for files > 4 MB compute progressively via Web Worker. Composer shows a "computing checksum" spinner if hashing exceeds 200 ms.
- **[Trade-off]** Two backend implementations of `AttachmentStore` (IDB + filesystem). Justified — the alternative (only IDB) means desktop loses access to user's filesystem reveals and bloats AppData with binary blobs in a database file; only filesystem means web doesn't work at all.
- **[Trade-off]** Parsers run client-side. Justified — keeps attack surface bounded (no Rust XML parser), simplifies parity, fits the 8 MB ceiling.

## Migration Plan

- Pre-release; no migration script.
- `packages/db-local/src/schema.{ts,sql}` is unchanged in v1 (no new table). If `chat_attachments_index` is added during apply per Decision 11, edit both files in lockstep without a migration.
- New Tauri commands ship in the same desktop build; `scripts/check-attachment-capabilities.mjs` runs in `apps/desktop` `prebuild` and fails if any allowlist entry is missing.
- Web fallback (IDB unavailable) ships from day one.
- New npm deps (`pdfjs-dist`, `mammoth`, `jszip`) added to `packages/doc-engine/package.json` and the workspace lockfile.
- Roll-out is single-flag: feature ships when all six layers (UI / store / contract / parser / tool / IPC) pass live verify on both web and Tauri release `.app`. No partial enablement.

## Decided (formerly Open Questions)

All five proposal-phase open questions are converged into concrete decisions:

- **Q1** (doc parsing in v1?): **Decided yes.** PDF / DOCX / XLSX / PPTX parsers ship in this change via `@offisim/doc-engine/import/`. See Decision 4.
- **Q2** (boss-only or every employee?): **Decided every gateway-lane node.** Boss + every employee tool kit register `read_attachment` when `lane=gateway`. See Decision 5 + Decision 6.
- **Q3** (IDB eviction UX?): **Decided typed `[evicted]` chip variant** with re-attach affordance. See Decision 9.
- **Q4** (checkpoint serialization round-trip?): **Decided ship a fixture round-trip test** in this change. See Decision 12.
- **Q5** (drag-drop overflow N files?): **Decided accept N, reject overflow with named errors.** See Decision 8 and the corresponding scenarios in `chat-attachments-end-to-end` spec.
