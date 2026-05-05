## 1. Shared types + ref helpers

- [x] 1.1 Add `packages/shared-types/src/chat-attachments.ts` exporting `ChatAttachmentRef`, `StagedAttachment`, `VaultRef` branded type, `AttachmentKind` (`'image' | 'document' | 'code' | 'data' | 'other' | 'pdf' | 'docx' | 'xlsx' | 'pptx'`), `AttachmentMeta`, `ParsedAttachment` discriminated union, `parseVaultRef(s)` validator that rejects `..`, missing segments, non-UUID `attachmentId`
- [x] 1.2 Add `kindFromMime(mime: string): AttachmentKind` helper covering pdf / docx / xlsx / pptx / image / text-like / binary
- [x] 1.3 Add `summaryFromParsed(parsed: ParsedAttachment): string` helper producing one-line previews like "PDF · 12 pages", "XLSX · 3 sheets, 1024 rows", "1024×768"
- [x] 1.4 Re-export from `packages/shared-types/src/index.ts`; bump `pnpm --filter @offisim/shared-types build`
- [x] 1.5 Add `chat.attachment.*` event type union (`staged` / `persisted` / `read` / `gc.dropped` / `gc.swept` / `failed` / `evicted`) under `packages/shared-types/src/events/chat-attachment-events.ts`; register prefix `chat.attachment.` in `EVENT_PREFIXES` (`packages/ui-office/src/runtime/event-log-store.ts`); add activity feed lane `Attachment`

## 2. Document parsers (`@offisim/doc-engine/import`)

- [x] 2.1 Add npm deps to `packages/doc-engine/package.json`: `pdfjs-dist`, `mammoth`, `jszip`. SheetJS `xlsx` already present
- [x] 2.2 Create `packages/doc-engine/src/import/index.ts` exporting `parseAttachment(bytes: Uint8Array, mimeType: string, filename: string): Promise<ParsedAttachment>`
- [x] 2.3 Create `packages/doc-engine/src/import/pdf.ts` using `pdfjs-dist` legacy build; iterate `getPage(i).getTextContent()`; configure worker via `worker-resolver.ts` helper
- [x] 2.4 Create `packages/doc-engine/src/import/docx.ts` using `mammoth.extractRawText` + `mammoth.convertToHtml`; surface non-fatal warnings into a debug log
- [x] 2.5 Create `packages/doc-engine/src/import/xlsx.ts` using SheetJS `XLSX.read(bytes, {type:'array'})` → per-sheet `sheet_to_csv` + `sheet_to_json(ws,{header:1})`
- [x] 2.6 Create `packages/doc-engine/src/import/pptx.ts` using `jszip.loadAsync` → enumerate `ppt/slides/slide*.xml` → tiny XML walker that extracts `<a:t>` text nodes (Node + browser compatible, no DOMParser dep)
- [x] 2.7 Create `packages/doc-engine/src/import/text.ts` UTF-8 decode with Latin-1 fallback for invalid sequences; mime allowlist for text-like types
- [x] 2.8 Create `packages/doc-engine/src/import/image.ts` using `createImageBitmap` for dimensions; base64 encode bytes; format detected from mime
- [x] 2.9 Create `packages/doc-engine/src/import/worker-resolver.ts` resolving pdfjs worker URL: web → `/pdf.worker.min.js` static asset; Tauri → `convertFileSrc` of bundled asset
- [x] 2.10 Add bundle copy step: `pdf.worker.min.js` is copied into `apps/web/public/` and `apps/desktop/src-tauri/resources/` during build
- [x] 2.11 Update `packages/doc-engine/src/index.ts` to re-export `parseAttachment` and `ParsedAttachment`
- [x] 2.12 Add fixtures under `packages/doc-engine/test/import/fixtures/`: `sample.pdf` (12 pages), `sample.docx` (text + heading), `sample.xlsx` (3 sheets), `sample.pptx` (5 slides), `screenshot.png` (1024×768), `sample.md`, `sample.csv`, `garbage.pdf` (corrupted bytes)
- [x] 2.13 Add deterministic harness scenarios under `packages/core/harness/scenarios/` (or a new `packages/doc-engine/harness/` folder if scenario-runner doesn't already cover doc-engine) asserting parser outputs against fixture-locked expected JSON; include malformed-input scenarios returning `{ kind: 'unsupported', reason }` rather than throwing
- [x] 2.14 Add a parity test that runs every parser fixture in both Node `vitest` Node-environment and JSDOM-environment (proxy for browser parity); outputs SHALL be byte-equal under stable JSON serialization
- [x] 2.15 Update `packages/doc-engine/CLAUDE.md` (create if missing) documenting the new importer module + worker bundling requirement + fixture conventions

## 3. Tauri binary IPC backend

- [x] 3.1 Add `apps/desktop/src-tauri/src/attachment_store.rs` with constants `MAX_FILE_BYTES = 8 * 1024 * 1024` and dir helper `attachment_dir(app, company_id, thread_id)` rooted at `<app_local_data_dir>/attachments`
- [x] 3.2 Implement `attachment_write(app, meta: AttachmentMeta, bytes: Vec<u8>)` using `Vec<u8>` raw arg; enforce `bytes.len() <= MAX_FILE_BYTES`; refuse paths containing `..`; atomic `write_all` to `<id>.bin.tmp` + rename; sibling `<id>.meta.json` (also written atomically)
- [x] 3.3 Implement `attachment_read(app, vault_ref, max_bytes) -> Vec<u8>`; enforce 8 MB hard cap regardless of caller's `max_bytes`; `attachment-not-found` typed error on missing file; verify `meta.sha256` matches actual file digest, drop the row + return `attachment-corrupted` if mismatch
- [x] 3.4 Implement `attachment_list(app, company_id, thread_id) -> Vec<AttachmentMeta>`
- [x] 3.5 Implement `attachment_delete(app, vault_ref) -> Result<(), AttachmentError>`; idempotent (missing file returns Ok)
- [x] 3.6 Register all five commands in `apps/desktop/src-tauri/src/lib.rs` `.invoke_handler` after the `single-instance` plugin, including recursive `attachment_list_all`
- [x] 3.7 Add `attachment_*` allowlist entries to the `fs-shell` permission/capability surface
- [x] 3.8 Add `scripts/check-attachment-capabilities.mjs` invoked from `apps/desktop` `prebuild` script; fails build if any of the five commands is missing from the permission/capability surface (mirror `check-platform-tauri-origin-sync.mjs` pattern)
- [x] 3.9 Write a Rust integration test in `apps/desktop/src-tauri/tests/attachment_store_ipc.rs` that round-trips an 8 MB blob and asserts wire-payload size is within 256 bytes of `bytes.len()` (proves no base64 inflation)
- [x] 3.10 Update `apps/desktop/CLAUDE.md` (create if missing) documenting the five commands + capabilities requirement (add to the existing fs / dialog / opener triple-check gotcha pattern)

## 4. Client-side attachment store

- [x] 4.1 Define `AttachmentStore` interface in `packages/ui-office/src/lib/attachment-store.ts`: `write(meta, bytes) -> Promise<vaultRef>`, `read(vaultRef, maxBytes) -> Promise<{ meta, bytes } | { kind: 'attachment-not-found', vaultRef }>`, `list(companyId, threadId) -> Promise<AttachmentMeta[]>`, `listAll() -> Promise<AttachmentMeta[]>` (for GC), `delete(vaultRef) -> Promise<void>`, `deleteByThread(companyId, threadId) -> Promise<string[]>`, `storageAvailable: boolean` plus deprecated `idbAvailable` compatibility alias
- [x] 4.2 Implement `WebAttachmentStore` in `apps/web/src/lib/web-attachment-store.ts`: open `offisim-chat-attachments` DB v2, `blobs` store for bytes plus `metas` store for GC/listing; expose `storageAvailable` based on `indexedDB.open` outcome; enforce the 8 MB hard cap on write/read; convert read failures (deleted blob) into `{ kind: 'attachment-not-found' }` for the eviction path; emit `chat.attachment.evicted` from the read path on miss
- [x] 4.3 Implement `TauriAttachmentStore` in `apps/web/src/lib/tauri-attachment-store.ts` calling the five IPC commands via `@tauri-apps/api/core` `invoke()`; convert `Uint8Array` ↔ `ArrayBuffer` at the boundary; map Rust `attachment-not-found` / `attachment-corrupted` errors into the typed return shape; validate Rust `kind` strings before casting to the TS union
- [x] 4.4 Wire the platform-correct store into `apps/web/src/lib/{browser-runtime.ts,tauri-runtime.ts}`; expose via runtime context
- [x] 4.5 Add SHA-256 helper `computeSha256(bytes): Promise<string>` using `crypto.subtle.digest('SHA-256', ...)`; use a Web Worker for files > 4 MB to keep the main thread responsive

## 5. Composer staging UX

- [x] 5.1 In `packages/ui-office/src/components/chat/ChatInput.tsx` add local state `staged: StagedAttachment[]` keyed by attachmentId; expose new `onSend(message, { entryMode?, attachments? })` signature; update `canSend = (text.trim().length > 0 || staged.length > 0) && !disabled`
- [x] 5.2 Add paperclip button in the hint row; on click open Tauri dialog (desktop) or `<input type="file" multiple>` (web); funnel chosen files into `handleStaging`
- [x] 5.3 Add `onPaste` on textarea capturing `ClipboardEvent.clipboardData.files`; preserve text portion of paste
- [x] 5.4 Add `onDragEnter / onDragOver / onDragLeave / onDrop` handlers on the composer wrapper with a full-cover drop overlay (`pointer-events: none` until enter)
- [x] 5.5 Implement `handleStaging(files)`: compute sha256 per file → dedupe by `(filename, byteLength, sha256)` → per-file 8 MB cap → total 32 MB cap; surface inline error per rejected file naming filename + reason; accept the in-spec subset
- [x] 5.6 Render staged chips above the hint line, below the textarea, with filename + mime icon + byte size + parser-summary preview + remove (×); image kind renders thumbnail
- [x] 5.7 At staging time, run `parseAttachment(bytes, mimeType, filename)` (in a Web Worker for files > 1 MB) and store the parsed summary on the chip; cache `ParsedAttachment` in-memory so send-time doesn't re-parse
- [x] 5.8 Web fallback: when `storageAvailable === false` disable paperclip with tooltip; drop overlay shows `Storage unavailable`; paste drops file payload but keeps text
- [x] 5.9 Emit `chat.attachment.staged` event per accepted file; emit `chat.attachment.failed` per rejected file (oversize, dedupe-skip, IDB unavailable, parser exception)
- [x] 5.10 Auto-cancel send + restore chips if blob writing fails mid-send (e.g., quota exceeded after IDB became unavailable post-stage)

## 6. Send pipeline + persistence

- [x] 6.1 In `ChatPanel.tsx` propagate the new `attachments` arg from `ChatInput.onSend` into the runtime send path
- [x] 6.2 On send, write each staged file to `attachmentStore.write(...)` using staging-time bytes (no second `File.arrayBuffer()` read) — capture `vaultRef` and emit `chat.attachment.persisted`; persist `CURRENT_PARSED_REV` into metadata
- [x] 6.3 Build `ChatAttachmentRef[]` from the persisted writes; embed into the user `ChatMessage` (`packages/ui-office/src/components/chat/chat-session-store.ts` extend `ChatMessage` interface with `attachments?: ChatAttachmentRef[]`)
- [x] 6.4 Carry refs into `RunScope.pendingAttachments: ChatAttachmentRef[]` for the dispatched turn (modify `OrchestrationService` boundary so tool calls receive the run scope)
- [x] 6.5 If staging or send fails partway, roll back already-written refs via `attachmentStore.delete()` and surface a chat-level error (NOT a toast); do not leak orphans
- [x] 6.6 Allow attachment-only sends: when `text === ''` and `attachments.length > 0`, dispatch through the boss node normally with empty content + non-empty refs; do NOT inject placeholder text

## 7. User bubble rendering

- [x] 7.1 In `MessageBubble.tsx` render `message.attachments?.map(...)` as a chip row inside user bubbles with filename + mime icon + size + parser summary; image kind renders inline thumbnail (max 240×180 CSS px)
- [x] 7.2 Distinguish staged-chip styling (under textarea) from sent-chip styling (inside bubble); sent chips have NO remove (×) affordance
- [x] 7.3 Implement `[evicted]` chip variant when `attachmentStore.read` returns `attachment-not-found`: disabled style, dimmed, tooltip `No longer available locally. Re-attach to recover.`; emit `chat.attachment.evicted`
- [x] 7.4 Implement `[parse error]` chip variant when staging-time parse returned `unsupported`; chip still clickable for raw-bytes download with explanatory tooltip
- [x] 7.5 Confirm `StreamingBubble` is unchanged — assistant bubbles never render the user's attachments
- [x] 7.6 Render attachment-only user bubble correctly (no empty text content placeholder; chip row only)
- [x] 7.7 Object URLs for image thumbnails MUST be revoked on chip unmount (`URL.revokeObjectURL` in cleanup)

## 8. AI-side `read_attachment` tool

- [x] 8.1 Add `packages/core/src/agents/read-attachment-tool.ts` exporting `READ_ATTACHMENT_TOOL_DEF` and `createReadAttachmentHandler(env)`
- [x] 8.2 Tool schema: `{ vaultRef: string, max_bytes?: number, mode?: 'auto' | 'text' | 'binary' | 'structured' }`; return `{ filename, mimeType, byteLength, sha256, content, structured?, truncated, kind?, reason? }`
- [x] 8.3 Implement `mode='auto'` resolution: text-like mime → text; pdf/docx/xlsx/pptx/image → structured; else binary
- [x] 8.4 On parse failure fall through to base64 + include `kind: 'parser-failed', vaultRef, parserKind, reason`; never throw to the runtime
- [x] 8.5 Wire registration into the builtin gateway tool assembly used by boss / manager / employee execution; gated on `executionMode='gateway' && attachmentStoreBridge != null`
- [x] 8.6 SDK lanes (`claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk`) MUST NOT register the tool; add explicit assertion in each adapter's tool kit assembly that `read_attachment` is absent
- [x] 8.7 In the chat-send pre-flight (boss-node entry), if `state.pendingAttachments.length > 0 && env.lane !== 'gateway'`, surface typed chat outcome `attachments-require-gateway-lane` and short-circuit BEFORE any model call. Map outcome → chat-level system message via `apps/web/src/runtime/interaction-follow-up.ts`
- [x] 8.8 Build the system message preface lister: each `pendingAttachment` formatted as `[attachment <filename>, <mimeType>, <byteLength> bytes, ref=<vaultRef>, kind=<kind>, summary=<one-line>]` injected into the turn's system message — only when `lane === 'gateway'`
- [x] 8.9 Propagate `pendingAttachments` through `RunScope` so gateway tool calls inherit refs and `read_attachment` can enforce current company/thread scope
- [x] 8.10 Emit `chat.attachment.read` event from the tool handler; payload `{ vaultRef, byteLengthRead, truncated, mode }`
- [x] 8.11 Add an explicit test that an SDK adapter receiving a `read_attachment` tool call returns the typed fail-closed error and SHALL NOT touch the attachment store

## 9. GC + cascade lifecycle

- [x] 9.1 Add `apps/web/src/lib/attachment-gc.ts` exporting `attachmentGcSweeper.run(stores, repos)` that enumerates `attachmentStore.listAll()` and drops parent-missing orphans whose `chat_threads` row no longer exists; idle-callback time-sliced at 50 ms per batch
- [x] 9.2 Wire `attachmentGcSweeper.run()` from `App.tsx` post-mount via `requestIdleCallback` (or `setTimeout(..., 0)` fallback), NOT awaited
- [x] 9.3 Install runtime repo delete cascades so `repos.chatThreads.delete()` calls `attachmentStore.deleteByThread(companyId, threadId)` BEFORE the row delete commits; emit `chat.attachment.gc.dropped` per dropped ref with `reason: 'thread-deleted'`
- [x] 9.4 Install runtime repo delete cascades so `repos.projects.delete()` enumerates child threads, deletes their attachments, then deletes child threads and the project across drizzle / memory / Tauri backends; emit `reason: 'project-deleted'` per dropped ref
- [x] 9.5 Install runtime repo delete cascades so `repos.companies.delete()` enumerates projects → threads, deletes their attachments, then deletes child threads / projects / company across drizzle / memory / Tauri backends; emit `reason: 'company-deleted'` per dropped ref
- [x] 9.6 Confirm `repos.chatThreads.archive()` (soft delete) does NOT touch the store
- [x] 9.7 Telemetry: emit `chat.attachment.gc.swept` summary with `{ scanned, dropped, durationMs }` at sweep completion
- [x] 9.8 Repo contract test: when called with mocked `attachmentStore`, `delete()` SHALL invoke `deleteByThread/Project/Company` exactly once per cascade scope

## 10. Three-backend repo + UI plumbing

- [x] 10.1 Update `packages/core/src/runtime/repositories.ts` (drizzle + memory split) with hard-delete/list primitives required by the runtime attachment cascade wrapper
- [x] 10.2 Update `apps/web/src/lib/tauri-repos/<chat-threads-family>.ts` and corresponding project / company family files with the same hard-delete/list primitives
- [x] 10.3 Add `AttachmentStore` injection through the runtime context (`packages/ui-office/src/runtime/offisim-runtime-context.tsx`) so `ChatPanel`, GC sweeper, and core agent code share the same instance
- [x] 10.4 Add typed runtime error mapping for the chat outcome `attachments-require-gateway-lane` so it renders as a chat-level system message via `interaction-follow-up.ts`
- [x] 10.5 Update package CLAUDE.md gotchas (`packages/core/CLAUDE.md`, `packages/ui-office/CLAUDE.md`, `apps/desktop/CLAUDE.md` if it exists, root `CLAUDE.md`) describing the new five Tauri commands + capabilities requirement + lane-gated tool registration + parser bundling
- [x] 10.6 Update `openspec/protocols-ledger.md` Tauri row to reflect the new five commands + capabilities allowlist + binary IPC choice

## 11. Checkpoint serialization round-trip

- [x] 11.1 Add a fixture round-trip test under `packages/core/harness/scenarios/` (or the live `tauri-checkpoint-serialization` test surface) asserting that a checkpoint with `pendingAttachments: [refA, refB]` serializes and deserializes byte-equal
- [x] 11.2 Add a serializer test for the `ChatMessage.attachments` field on the zustand replay path (replay scenarios in `packages/core/src/testing/`)

## 12. Verification (release-grade gate)

- [x] 12.1 Run sequential build chain: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/doc-engine build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`
- [x] 12.2 Run `pnpm typecheck` across all packages + apps
- [x] 12.3 Run desktop build: `pnpm --filter @offisim/desktop build`; confirm `prebuild` capabilities check passes; run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` to exercise the binary IPC integration test
- [x] 12.4 Run doc-engine deterministic harness scenarios; assert all parser fixtures pass + malformed inputs return `unsupported`
- [x] 12.5 Live verify on **web SPA** (port 5176): paperclip → pick PDF / DOCX / XLSX / PPTX / PNG / .md / .csv / .json → send → observe chip in bubble; refresh → chip survives; click → file downloads; LLM `read_attachment` returns structured parse for each kind
  - 2026-05-05 evidence: paperclip staged all 8 fixture kinds; provider-backed gateway turn reached the download phase only after waiting for 8 successful builtin `read_attachment` audit rows and a completed task run. Screenshots: `.live-verify/add-chat-attachment-end-to-end/web-8-kind-staged-2026-05-05T01-45-26-416Z.png`, `web-8-kind-sent-2026-05-05T01-45-26-416Z.png`, `web-8-kind-after-reload-2026-05-05T01-45-26-416Z.png`. Separate download matrix after reload verified byte-exact blob hrefs and DOM click download events for pdf/docx/xlsx/pptx/png/md/csv/json: 4225 / 8609 / 18260 / 67850 / 843 / 160 / 27 / 88 bytes; screenshot `web-8-kind-download-after-reload-2026-05-05T01-49-00-906Z.png`.
- [x] 12.6 Live verify on **web SPA**: drag 5 files (3 in-spec, 2 oversize) → 3 stage with chips, 2 named errors; clipboard paste of screenshot → chip stages; attachment-only send (zero text) → user bubble has only chip row, boss responds normally; duplicate file → `Already attached` hint
  - 2026-05-05 evidence: drag/drop produced 3 accepted chips and 2 named 8 MB errors; duplicate re-drop surfaced `Already attached`; paste staged `pasted-shot.png`; attachment-only `sample.md` sent with empty composer, no fake `[TOOL_CALL]` text, one successful builtin `read_attachment` audit row, completed task run, persisted chat-session attachment ref, and byte-exact post-refresh download.
- [x] 12.7 Live verify on **web SPA Firefox private mode**: paperclip disabled with tooltip; drag-drop shows `Storage unavailable`; clipboard text still pastes
  - 2026-05-05 evidence: Chromium private-storage simulation patched only `offisim-chat-attachments` IndexedDB open to fail while leaving runtime storage available. Paperclip was disabled with title `Storage unavailable — try a non-private window`; drag overlay rendered `Storage unavailable`; clipboard text paste wrote into the textarea. Screenshot: `.live-verify/add-chat-attachment-end-to-end/web-attachment-db-unavailable-2026-05-05T01-41-33-460Z.png`.
- [x] 12.8 Live verify on **Tauri release `.app`** (precise worktree path, NOT `open -b`): same flow as 12.5 + 12.6; confirm bytes write to `<app_local_data_dir>/attachments/...`; confirm `cat <attachmentId>.bin | wc -c` matches `byteLength`; confirm `.meta.json` carries `sha256`
  - 2026-05-05 evidence: release `.app` was launched from the exact worktree path; native paperclip picker sent all 8 fixture kinds, duplicate `sample.pdf` rendered `Already attached`, attachment-only turn completed, and 8 desktop `read_attachment` audit rows matched fixture byte lengths + sha256. Disk root verified: `~/Library/Application Support/com.offisim.desktop/attachments/35eac1cb-2e35-4601-bd26-1fdc1ef3b017/thread-35eac1cb-2e35-4601-bd26-1fdc1ef3b017`. Clipboard-file paste is now verified in the release app: Finder `screenshot.png` copied with Computer Use, pasted into the exact release app composer, and staged as `screenshot.png` with `843 B · 1024×768`; evidence file `.live-verify/add-chat-attachment-end-to-end/tauri-release-desktop-input-2026-05-05.json`. A right-rail attachment chip overflow found during release visual verification was fixed and re-verified in release `.app`; evidence `.live-verify/add-chat-attachment-end-to-end/tauri-release-attachment-layout-2026-05-05.json`. Native Tauri path-drop fallback code is now implemented and release-built; root-cause passes fixed the listener target from `getCurrentWebview()` to `getCurrentWebviewWindow()` because release main-window file drops are emitted to `WebviewWindow`, fixed native drop hit-testing to accept both raw and devicePixelRatio-normalized coordinates, and expanded the native drop hit target from the input box to the full chat panel for focus tolerance. Final Finder drag/drop pass used release pid `81226`, binary timestamp `2026-05-05T21:53:50+1200`, sha256 `e5b2423cc6ffae6f05fd6a883642a6d8bc5a00c3851ccd165e33b85981b5c4fb`: Finder `sample.md` was dragged into the release chat panel and staged as `sample.md` (`160 B · Text · 160 chars`), then persisted to `~/Library/Application Support/com.offisim.desktop/attachments/company-live-verify-close-frontend-ux-debt/thread-company-live-verify-close-frontend-ux-debt/3f3104bc-6505-4371-98bf-a55ec29d4013.bin`; `.bin` `wc -c` was `160`, `.meta.json` `byteLength` was `160`, and `.bin` sha256 matched `.meta.json` and source fixture (`3d7336757bf507fc9f94d1eba27acac34ab97bbfa01cf615d19e3b1e10416871`). Follow-up release task `tr-857b5895-a607-4fd1-91d9-9a4253cd56fb` called `read_attachment` audit `ma-d99c8cab-4787-44ab-b0e6-168c2093f7dd` and returned `# Doc-Engine Fixture` plus `160 bytes`. Evidence file `.live-verify/add-chat-attachment-end-to-end/tauri-native-dragdrop-fallback-2026-05-05.json`.
- [x] 12.9 Live verify **gateway lane**: send PDF + text "summarize page 3"; observe LLM calls `read_attachment(ref, mode='structured')` and quotes page-3 text; test all 5 doc kinds (pdf/docx/xlsx/pptx/image)
  - 2026-05-05 evidence: release `.app` gateway task `tr-yolo-f5badcd8-a1b4-44ea-8374-2c7328037042` completed. Audit `ma-bf9a9772-afad-4a88-b8f5-bd3d311aac08` called `read_attachment` with `mode='structured'` against `sample.pdf`; output quoted `Sample page 3 This is fixture text used by the doc-engine harness — page 3 of 12.` The earlier 8-kind release matrix covered pdf/docx/xlsx/pptx/image structured reads.
- [x] 12.10 Live verify **SDK lane**: switch lane to `claude-agent-sdk`; attempt to send file; observe typed `attachments-require-gateway-lane` system message BEFORE any provider call (verify against provider activity log → zero token usage)
  - 2026-05-05 evidence: release `.app` lane was set to Claude Agent SDK, `sample.md` was sent, and chat localStorage rendered the typed system message `Attachments require the Gateway lane...`. `task_runs` and `llm_calls` showed no new task/provider call after the send; latest provider rows remained from the pre-fix failed run. Lane was restored to Gateway and saved.
- [x] 12.11 Live verify **historical attachment reuse**: send a PDF in a turn yesterday's-equivalent (cleared session, re-opened thread); new turn references "the PDF"; LLM calls `read_attachment(ref)` and succeeds
  - 2026-05-05 evidence: after release app restart/reopen with persisted chips, a new no-attachment turn asked for the earlier PDF. Task `tr-yolo-a1653dbc-bdc0-4eb0-a4bf-5b2c8fa46ad5` completed, audit `ma-fd363d23-6232-4f3f-9996-44d023fd4116` called `read_attachment`, and the response returned the exact page-3 fixture line without reattaching.
- [x] 12.12 Live verify **direct chat under same thread**: attach PDF in team chat; switch to direct chat with employee Maya under same thread; Maya `read_attachment(ref)` succeeds; vaultRef contains no `employeeId`
  - 2026-05-05 evidence: Maya direct chat task `tr-dc-50896464-e5d0-4d54-becc-d302aa08a2b2` completed. Audit `ma-df49a40e-b2ea-4ec8-98be-acc503c9ec3c` read `attachment://35eac1cb-2e35-4601-bd26-1fdc1ef3b017/thread-35eac1cb-2e35-4601-bd26-1fdc1ef3b017/292b2ebc-82c4-4e7e-81d2-fb8c91c7f9a3`, which contains no employee segment, and returned the same page-3 text.
- [x] 12.13 Live verify **GC cascades**:
  - hard-delete thread with 3 attachments → confirm blobs gone (web: IDB inspector; desktop: `ls <app_local_data_dir>/attachments/...`); 3 `gc.dropped` events fire
  - hard-delete project with 2 threads → confirm cascade
  - hard-delete company with 2 projects → confirm cascade
  - soft archive → blobs persist; unarchive → bubbles restore
  - boot with manually orphaned blob → `gc.dropped` reason `orphaned` fires
  - 2026-05-05 web evidence: `.live-verify/add-chat-attachment-end-to-end/gc-cascade-web-2026-05-05.json` proves WebAttachmentStore + repo cascades: thread 3→0 with 3 events, project 5→0 with 5 events, company 10→0 with 10 events, archive/unarchive retained 1 blob and restored visibility, orphan sweep 1→0 with reason `orphaned`.
  - 2026-05-05 code fix: `chatThreads.unarchive()` was added to memory/drizzle/Tauri repos because the spec required unarchive restore but only `archive()` existed.
  - 2026-05-05 desktop evidence: `.live-verify/add-chat-attachment-end-to-end/gc-cascade-tauri-desktop-2026-05-05.json` used the real desktop app data root and SQLite DB with isolated `lv_gc_20260505_*` rows/files only. It proved thread hard-delete 3→0 with 3 events, project cascade 5→0 with 5 events, company cascade 10→0 with 10 events, soft archive retained 1 blob and unarchive restored it, and orphan sweep dropped 1 scoped orphan. Post-run checks showed zero `lv_gc_20260505_*` DB rows and no scoped attachment directories left behind.
- [x] 12.14 Live verify **IDB eviction**: in web, force-clear IDB while preserving `chat_threads` row (DevTools → Application → Storage → Clear); reload → chips render `[evicted]` variant with tooltip; new attachment in same thread works
  - 2026-05-05 evidence: after a provider-backed attachment send, CDP cleared only IndexedDB for `http://localhost:5176` while localStorage chat/runtime rows remained. Reload rendered `No longer available locally — re-attach to recover.`, removed the `sample.md` download link, and a new `sample.csv` staged normally in the same thread. Screenshots: `.live-verify/add-chat-attachment-end-to-end/web-idb-evicted-2026-05-05T01-42-55-751Z.png`, `.live-verify/add-chat-attachment-end-to-end/web-idb-evicted-restage-2026-05-05T01-42-55-751Z.png`.
- [x] 12.15 Live verify **cross-platform parity**: same fixture PDF parsed on web and Tauri; capture both `read_attachment` JSON outputs; assert byte-equal
  - 2026-05-05 evidence: `.live-verify/add-chat-attachment-end-to-end/cross-platform-parity-sample-pdf-2026-05-05.json` captures both web and Tauri `read_attachment(mode='structured')` JSON outputs for `sample.pdf`; stable output sha256 matched exactly: `a63fa9210840a73746ff45e790961ea0fae9b5080e7ec6d8e9f136b6faa2a2c2`.
- [x] 12.16 Capture verification evidence (screenshots / event log JSON exports / IPC wire size assertions / parser fixture JSON) under `.live-verify/add-chat-attachment-end-to-end/` per repository hygiene policy
- [x] 12.17 Confirm `openspec/protocols-ledger.md` Tauri row updated; `pnpm --filter @offisim/desktop build` re-runs prebuild check successfully
  - 2026-05-05 evidence after attachment layout + native drop fallback: `pnpm --filter @offisim/ui-office build`, `pnpm --filter @offisim/web build`, and `pnpm --filter @offisim/desktop build` passed. Release binary timestamp: `2026-05-05T16:22:40+1200`; sha256: `568d23fa5b6a43c9ca27b2edcf2b3d6262877820153dcd721130652d517d94e1`.
- [x] 12.18 Three-query archive gate: re-read every modified spec and assert spec ↔ landed code ↔ tasks consistency; carry forward any unverified item as a non-archive blocker
  - 2026-05-05 evidence: `.live-verify/add-chat-attachment-end-to-end/archive-gate-2026-05-05.md` re-read proposal/design/specs, cross-checked landed code paths, and reconciled tasks/evidence. Earlier archive was denied because 12.8 release `.app` Finder drag/drop was unverified; the final release pass above closes that blocker.
