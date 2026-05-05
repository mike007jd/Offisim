# Live Verify Evidence — `add-chat-attachment-end-to-end`

Current status on 2026-05-05: OpenSpec progress is **102/103**. The change is still **not archive-ready** because 12.8 Tauri release `.app` Finder drag/drop remains open.

## Gates Run

| Gate | Status | Evidence |
|---|---|---|
| Sequential build chain | PASS | Earlier full chain passed: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/doc-engine build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`. |
| Core / web typecheck after `unarchive()` fix | PASS | `pnpm --filter @offisim/core typecheck`; `pnpm --filter @offisim/web typecheck`. |
| UI office build after `unarchive()` fix | PASS | `pnpm --filter @offisim/ui-office build`. |
| Desktop release build after attachment layout + native drop fallback | PASS | `pnpm --filter @offisim/ui-office build`; `pnpm --filter @offisim/desktop build`; prebuild origin sync + attachment capability gate passed. Latest release binary timestamp `2026-05-05T18:19:57+1200`; sha256 `86bbfb443867058805b25dce1f9a31d4fe0ab2c6482c1716e9b7b9b3d8b182a1`. |
| Chat attachment harness | PASS | `pnpm harness:chat-attachment-roundtrip` — checkpoint round-trip, `ChatMessage.attachments` round-trip, and `read_attachment` scope guard. |
| Doc parser harness | PASS | `pnpm harness:doc-engine` — 8 parser scenarios, 0 failed. |
| Tauri Rust tests | PASS | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — includes 8 MB raw IPC, sha256 corruption drop, UUID/path rejection, and recursive `attachment_list_all`. |
| Web 8-kind gateway read matrix | PASS | Paperclip staged/sent PDF, DOCX, XLSX, PPTX, PNG, MD, CSV, JSON; after reload all 8 download links matched fixture byte counts. Screenshots: `web-8-kind-staged-2026-05-05T01-45-26-416Z.png`, `web-8-kind-sent-2026-05-05T01-45-26-416Z.png`, `web-8-kind-after-reload-2026-05-05T01-45-26-416Z.png`, `web-8-kind-download-after-reload-2026-05-05T01-49-00-906Z.png`. |
| Web drag/paste/dedupe/attachment-only | PASS | 3 accepted + 2 named oversize errors; duplicate surfaced `Already attached`; paste staged screenshot; attachment-only send rendered a chip-only user bubble and completed with `read_attachment`. |
| Web storage unavailable | PASS | Patched only `offisim-chat-attachments` IndexedDB open to fail; paperclip disabled, drag overlay showed `Storage unavailable`, clipboard text still pasted. Screenshot: `web-attachment-db-unavailable-2026-05-05T01-41-33-460Z.png`. |
| Web IDB eviction | PASS | Cleared only IndexedDB; reload rendered evicted chip tooltip and new attachment in same thread still staged. Screenshots: `web-idb-evicted-2026-05-05T01-42-55-751Z.png`, `web-idb-evicted-restage-2026-05-05T01-42-55-751Z.png`. |
| Tauri release 8-kind persistence/read matrix | PARTIAL PASS | Exact release `.app` path launched and sent all 8 fixture kinds through native file picker. Disk `.bin` sizes and `.meta.json` sha256 matched fixtures for all 8; duplicate `sample.pdf` showed `Already attached`; attachment-only turn completed. Clipboard-file paste staged `screenshot.png` in release app; evidence: `tauri-release-desktop-input-2026-05-05.json`. Drag/drop is still unverified. |
| Tauri release attachment layout | PASS | `.live-verify/add-chat-attachment-end-to-end/tauri-release-attachment-layout-2026-05-05.json`: fixed right-rail attachment chip overflow with message/chip min-width and overflow guards, rebuilt release `.app`, and verified chips wrap/truncate inside the panel. |
| Tauri native drag/drop fallback | ROOT-CAUSE FIX BUILT / UNVERIFIED | `.live-verify/add-chat-attachment-end-to-end/tauri-native-dragdrop-fallback-2026-05-05.json`: added release-code handling for Tauri native `onDragDropEvent` paths and plugin-fs scope allowance for user-dropped files. Later root-cause passes fixed the listener target from `getCurrentWebview()` to `getCurrentWebviewWindow()` and made native drop hit-testing accept both raw and devicePixelRatio-normalized coordinates. Build passed, but foreground Finder/Offisim drag/drop verification was intentionally stopped because it disrupted the user's active work; 12.8 remains open until a dedicated desktop-verification window. |
| Gateway PDF page-3 quote | PASS | Release `.app` task `tr-yolo-f5badcd8-a1b4-44ea-8374-2c7328037042`; audit `ma-bf9a9772-afad-4a88-b8f5-bd3d311aac08` used `read_attachment(mode='structured')` and output quoted page 3 exactly. |
| SDK lane fail-fast | PASS | Release `.app` lane switched to Claude Agent SDK; sending `sample.md` produced typed system message before provider/task creation. `task_runs` / `llm_calls` showed zero new provider call for that send; lane restored to Gateway. |
| Historical attachment reuse | PASS | After release app restart/reopen, a no-attachment turn referenced the earlier PDF. Task `tr-yolo-a1653dbc-bdc0-4eb0-a4bf-5b2c8fa46ad5`, audit `ma-fd363d23-6232-4f3f-9996-44d023fd4116`; page-3 text returned without reattach. |
| Direct chat same-thread reuse | PASS | Maya direct chat task `tr-dc-50896464-e5d0-4d54-becc-d302aa08a2b2`; audit `ma-df49a40e-b2ea-4ec8-98be-acc503c9ec3c`; vaultRef had no employee segment and read succeeded. |
| Web GC cascade | PASS | `.live-verify/add-chat-attachment-end-to-end/gc-cascade-web-2026-05-05.json`: thread 3 -> 0 with 3 events, project 5 -> 0 with 5 events, company 10 -> 0 with 10 events, archive/unarchive retained 1 blob and restored visibility, orphan sweep 1 -> 0 with reason `orphaned`. |
| Desktop GC cascade | PASS | `.live-verify/add-chat-attachment-end-to-end/gc-cascade-tauri-desktop-2026-05-05.json`: real desktop app data root + SQLite DB with scoped `lv_gc_20260505_*` rows/files only; thread 3 -> 0, project 5 -> 0, company 10 -> 0, archive/unarchive retention, orphan sweep 1 -> 0; post-run cleanup confirmed zero scoped DB rows and no scoped attachment directories. |
| Cross-platform read parity | PASS | `.live-verify/add-chat-attachment-end-to-end/cross-platform-parity-sample-pdf-2026-05-05.json`: web and Tauri release `read_attachment(mode='structured')` outputs for `sample.pdf` have identical stable sha256 `a63fa9210840a73746ff45e790961ea0fae9b5080e7ec6d8e9f136b6faa2a2c2`. |
| Archive gate audit | PASS / DENIED ARCHIVE | `.live-verify/add-chat-attachment-end-to-end/archive-gate-2026-05-05.md`: proposal/design/specs re-read, landed code paths cross-checked, tasks/evidence reconciled. The gate denies archive because 12.8 release `.app` drag/drop remains unverified. |

## Fixes Landed During Verification

- Added `packages/core/src/agents/attachment-lane-guard.ts` and wired SDK-lane attachment fail-fast through boss, YOLO, direct setup, employee preflight, and PM planner preflight.
- Added deterministic harness `sdk-lane-yolo-attachments-short-circuit-before-model.json` and fixed two attachment harness scenarios that previously self-attested via exact sentinel output.
- Tightened `read_attachment` scope guard: current company + runScope thread must match the vaultRef before any store read.
- Confirmed Tauri runtime uses the same `TauriAttachmentStore` for builtin tools, runtime context, and delete cascades.
- Added `chatThreads.unarchive()` to memory, drizzle, and Tauri repos because the spec required archive/unarchive restore but only `archive()` existed.

## Remaining Non-Archive Gates

- **12.8**: release `.app` drag/drop is still unverified. Native picker, duplicate, attachment-only send, disk bytes, metadata sha, and clipboard-file paste are verified. Native Tauri drop fallback, WebviewWindow listener targeting, and coordinate hit-test compatibility are implemented and release-built, but no successful Gateway-lane Finder-to-composer drag has been observed yet. Foreground live retry is paused to avoid disrupting the user's active work session.
- No other gate remains open; 12.18 ran and carried 12.8 as a non-archive blocker.

## Current Blocker

Current blocker is release `.app` Finder drag/drop: the code now handles Tauri native path drops, listens on the correct Tauri WebviewWindow target, and accepts both observed coordinate spaces. Do not mark the OpenSpec change complete or archive until 12.8 drag/drop is proven during an explicit short desktop-verification window, or product explicitly accepts a documented exception.
