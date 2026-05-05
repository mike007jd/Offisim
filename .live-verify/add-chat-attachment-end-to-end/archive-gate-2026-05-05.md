# Archive Gate — add-chat-attachment-end-to-end

Date: 2026-05-05

Result: **archive denied**. The gate itself ran and the change validates, but the OpenSpec change must remain active because release `.app` Finder drag/drop is still unverified under task 12.8. Native Tauri path-drop fallback, WebviewWindow listener targeting, and coordinate hit-test compatibility were implemented and release-built on the same date, but the live Finder drag/drop proof is still missing.

## Query 1 — Spec Re-Read

- Re-read `proposal.md`, `design.md`, and all three spec deltas:
  - `specs/chat-attachments-end-to-end/spec.md`
  - `specs/chat-streaming-ux/spec.md`
  - `specs/workspace-thread-architecture/spec.md`
- Core contract still matches the landed direction: composer paperclip / drag / paste, persistent web + desktop attachment stores, `ChatMessage.attachments`, `RunScope.pendingAttachments`, gateway-only `read_attachment`, SDK fail-closed behavior, Tauri binary IPC, GC cascades, evicted web chips, and web/Tauri parity.
- One spec requirement is not fully live-verified: Tauri release drag/drop parity. Clipboard-file paste is verified. Native Tauri path-drop code now exists, the listener now targets `WebviewWindow`, and native drop hit-testing accepts both raw and devicePixelRatio-normalized coordinates, but Finder drag/drop still lacks a successful Gateway-lane live proof.

## Query 2 — Landed Code Cross-Check

- Composer and rendering surface exists in `packages/ui-office/src/components/chat/ChatInput.tsx`, `StagedAttachmentChip.tsx`, `SentAttachmentChip.tsx`, `useChatAttachmentStaging.ts`, `chat-attachment-pipeline.ts`, `tauri-dropped-files.ts`, and `MessageBubble.tsx`.
- Web and desktop stores exist in `apps/web/src/lib/web-attachment-store.ts` and `apps/web/src/lib/tauri-attachment-store.ts`; runtime injection is wired through browser and Tauri runtime setup.
- Gateway-only read path exists in `packages/core/src/tools/builtin/read-attachment-tool.ts`, `packages/core/src/runtime/attachment-store-bridge.ts`, `packages/core/src/agents/attachment-lane-guard.ts`, and `packages/core/src/agents/attachment-preface.ts`.
- Tauri IPC exists in `apps/desktop/src-tauri/src/attachment_store.rs`, is registered in `apps/desktop/src-tauri/src/lib.rs`, allowlisted in `apps/desktop/src-tauri/permissions/fs-shell.toml`, and protected by `scripts/check-attachment-capabilities.mjs`. `lib.rs` also grants tauri-plugin-fs read scope for user-dropped native paths before the frontend converts them into staged files. `ChatInput` listens for native drag/drop on the Tauri `WebviewWindow` target so release main-window drops are not missed by a webview-only listener, and its composer hit-test accepts both observed Tauri coordinate spaces.
- GC cascade and orphan sweep exist in `apps/web/src/lib/attachment-cascades.ts` and `apps/web/src/lib/attachment-gc.ts`; `chatThreads.unarchive()` now exists in memory, drizzle, and Tauri project repos.

## Query 3 — Tasks / Evidence Consistency

- `openspec validate add-chat-attachment-end-to-end --strict` passes.
- Task progress after this gate: **102/103**.
- Passed evidence includes web 8-kind matrix, web drag/paste/dedupe/attachment-only, web storage unavailable, web IDB eviction, release native picker 8-kind matrix, gateway page-3 read, SDK lane fail-fast, historical reuse, direct-chat reuse, web GC, desktop scoped GC, cross-platform read parity, release attachment layout, and release build/hash evidence. Built-but-unverified evidence includes `.live-verify/add-chat-attachment-end-to-end/tauri-native-dragdrop-fallback-2026-05-05.json`.
- Non-archive blocker carried forward: **12.8 release `.app` drag/drop**.

## Decision

Do not archive this OpenSpec change. Keep `openspec/changes/add-chat-attachment-end-to-end/` active until release `.app` Finder drag/drop is proven or product explicitly accepts a documented exception.
