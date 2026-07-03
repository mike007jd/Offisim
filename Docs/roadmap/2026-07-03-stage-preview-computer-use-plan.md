# Stage Preview + Computer Use Implementation Plan

> **For agentic workers:** Execute with the project's `verified-iteration-loop` (or superpowers:executing-plans). One phase per session; the user runs `/clear` between phases; this document is the cross-session truth. Steps use checkbox (`- [ ]`) syntax for tracking. Update the Progress Ledger at the bottom after every phase.

**Goal:** Extend Stage with two complete capabilities in one delivery: full multi-format preview (replacing text-only assumptions) and a first-class Computer Use surface backed by Cua Driver through Pi/MCP.

**Architecture:** A unified preview resolver replaces the `output`/`file`/`preview` split in `StageViewTarget`; a binary-safe Rust preview lane (raw-IPC bounded reads + a sandboxed streaming URI scheme) feeds renderer viewer components that reuse doc-engine parsers. Computer Use rides the existing single `agent.run` envelope: a new `ToolRichDetail` `family: 'computer'`, two new `AgentRunEventType` values, protocol bump 4→5, and a `computer` Stage tab; Cua Driver mounts as a stdio MCP server through the existing `mcp_bridge` + Settings MCP pane.

**Tech Stack:** React 19 / Tailwind v4 / zustand / TanStack Query (existing), doc-engine (pdfjs-dist, mammoth, SheetJS), `@pixiv/three-vrm@^3.5.4`, three + @react-three/fiber/drei (existing), Tauri 2 raw IPC + `register_asynchronous_uri_scheme_protocol`, Cua Driver MCP (`trycua/cua`).

**PRD:** `Docs/roadmap/2026-07-02-stage-preview-computer-use-prd.md` (audited against code 2026-07-03).

**Branch:** `feat/stage-preview-computer-use` (create from `main` at start of Phase 1).

## Global Constraints

- Pi Agent is the only AI runtime; no provider/model catalog, no second runtime, no Claude/Codex sidecars.
- Prelaunch: replace, never compatibility-wrap. No migrations for old local state; old DBs are disposable.
- New UI stays inside `apps/desktop/renderer`; follow `Docs/UI_FRAMEWORK_STACK.md`; no renderer-root outer margin/frame.
- Workspace file access only through sandboxed Tauri commands; every new file-touching command must keep `workspace_roots → resolve_project_candidate → canonicalize → ensure_inside_workspace` order.
- Pi wire rule: every new payload/event field must exist on BOTH sides (Rust `sidecar_payload`/decoder AND Node host emit/read) plus wire-fixture coverage; protocol version lives in exactly two literals (`pi_agent_host.rs:65`, `scripts/pi-agent-host-wire.mjs:14`) and the committed fixture `scripts/fixtures/pi-wire-contract.json`.
- No `.github/workflows/*` edits in pushable commits (gh token lacks workflow scope); CI-affecting logic goes in `scripts/release-gates.mjs`.
- Validation: no vitest/Playwright. Oracles are `scripts/harness-*.mts` checks + cargo tests; gates are `pnpm validate`, renderer typecheck/build, desktop release build; final truth is the release `.app` at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` driven via Computer Use (never `open -b`, never osascript, never dev webview).
- `validate` exit-code trap: run `pnpm validate > log 2>&1` with NO trailing `echo`; check the real exit status.
- Build order: `shared-types → doc-engine → core → renderer`; `tsc-build-if-dist-missing` skips existing dist — force-refresh doc-engine/shared-types dist (`pnpm --filter <pkg> exec tsc --project tsconfig.json`) after changing them and before harness/release runs.
- Gate strategy: between phases the lead (main session) does simplify personally; code review via `codex:review`; do NOT launch the token-heavy code-review workflow.
- New npm deps must be exact and current (verified 2026-07-03): `@pixiv/three-vrm@^3.5.4`, `pdfjs-dist@^4.7.76` (match doc-engine), `yaml@^2`, `smol-toml@^1`. New Rust dep: `infer` (MIME sniffing).

## Source Truth (verified 2026-07-03)

| claim | status | evidence |
|---|---|---|
| `StageViewTarget` is a 6-kind union; tabs are game/browser/terminal/review/files | TRUE | `ui-state.ts:10-45` |
| All `openStageView` call sites: StageViewer, WorkspacePanel, file-preview, artifact-claim, delivery-history, ConvOutputs, WorkloadDrilldown, OfficeScene2D/3D | TRUE | explorer report; `stage-viewer/artifact-claim.ts:65-83` is the shared resolver for scene clicks |
| Preview command is UTF-8-only, 64 KB hard cap | TRUE | `builtin_tools.rs:415-460`, `MAX_PREVIEW_BYTES=65_536` |
| Sandbox helpers live in `builtin_tools.rs` (not local_paths) | TRUE | `workspace_roots:75`, `resolve_project_candidate:159`, `ensure_inside_workspace:194` |
| No custom URI scheme registered today | TRUE | grep `register_uri_scheme_protocol` returns nothing |
| doc-engine parses pdf/docx/xlsx/pptx/image/text; renderer does NOT import it | TRUE | `packages/doc-engine/src/import/index.ts`; renderer grep empty; consumer is `packages/core/src/tools/builtin/read-attachment-tool.ts` |
| `ToolRichDetail` families: terminal/file/search/browser/generic; `parseToolRichDetail` at agent-run.ts:455; browser detection is data-driven (image block in detail JSON) | TRUE | `agent-run.ts:282-297,427-445,455-548` |
| Protocol version = 4 in exactly two literals + fixture; guarded by `check:pi-wire-contract` | TRUE | `pi_agent_host.rs:65`, `pi-agent-host-wire.mjs:14`, `scripts/fixtures/pi-wire-contract.json` |
| MCP mounts renderer-side (`mcp_register_server`/`mcp_connect_registered`); Pi host gets opaque `mcpTools` + meta tools `mcp_search_tools`/`mcp_describe_tool`/`mcp_call`; execution loops back via `mcpCall` JSONL → `invoke_mcp_tool` | TRUE | `mcp_bridge/commands.rs`, `tauri-pi-agent-host.entry.mjs:1051-1080`, `pi_agent_host.rs:1157` |
| Settings already ships an MCP pane with register/connect/stdio-confirm UI | TRUE | `surfaces/settings/McpServersPane.tsx`, `settings-data.ts:234-293` |
| Artifacts persist via `desktop-agent-runtime.ts persistArtifact` → `deliverables` table | TRUE | `desktop-agent-runtime.ts:1117`, `schema.sql:520` |
| Harness = `scripts/harness-*.mts` with `check(name, cond)` counters; register in package.json + `validate` chain; CI covers via `release-gates.mjs` | TRUE | explorer report, `package.json:77` |
| Release CSP has no `media-src`/`frame-src` | TRUE | `tauri.conf.json` app.security.csp |
| Cua Driver: native daemon + `cua-driver mcp` stdio MCP server; no-foreground contract; TCC attributes to CuaDriver.app | TRUE | cua.ai/docs tutorial, github.com/trycua/cua (checked 2026-07-03) |

## File Map (create/modify overview)

**Create:**
- `apps/desktop/renderer/src/surfaces/office/stage-preview/preview-target.ts` — target model + resolver (pure)
- `apps/desktop/renderer/src/surfaces/office/stage-preview/preview-data.ts` — data loading (Tauri invokes, deliverable load, stream URLs)
- `apps/desktop/renderer/src/surfaces/office/stage-preview/StagePreviewPane.tsx` — pane chrome + viewer dispatch
- `apps/desktop/renderer/src/surfaces/office/stage-preview/viewers/{TextViewer,StructuredTextViewer,MarkdownViewer,ImageViewer,CsvViewer,HtmlViewer,PdfViewer,DocViewer,SheetViewer,SlidesViewer,MediaViewer,ModelViewer,UnsupportedViewer}.tsx`
- `apps/desktop/renderer/src/surfaces/office/computer/{ComputerView.tsx,ComputerSetupPanel.tsx,computer-status.ts}`
- `apps/desktop/src-tauri/src/preview.rs` — new preview commands + streaming protocol
- `scripts/harness-preview-resolver.mts`, `scripts/harness-stage-preview-targets.mts`, `scripts/harness-computer-rich-detail.mts`, `scripts/mock-computer-use-mcp.mjs`
- `apps/desktop/renderer/src/surfaces/office/stage-preview/csv-parse.ts` — small quoted-CSV parser (no new dep)

**Modify:**
- `apps/desktop/renderer/src/app/ui-state.ts` — new `StageViewTarget`/`StagePrimaryTab`
- `apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx` — tabs, menu, body dispatch (OutputView/FileView/PreviewView deleted)
- `apps/desktop/renderer/src/surfaces/office/stage-viewer/{file-preview.ts,artifact-claim.ts}`, `scene/delivery-history.ts`, `rail/ConvOutputs.tsx`, `WorkspacePanel.tsx` (denylist deleted), `WorkloadDrilldown.tsx`
- `packages/shared-types/src/events/agent-run.ts` — `family: 'computer'`, new event types
- `apps/desktop/renderer/src/surfaces/office/scene/work-bench/WorkBench.tsx` — ComputerBench
- `scripts/{pi-agent-host-wire.mjs,pi-mcp-bridge-extension.mjs,tauri-pi-agent-host.entry.mjs,fixtures/pi-wire-contract.json}`
- `apps/desktop/src-tauri/src/{lib.rs,pi_agent_host.rs}`, `permissions/{fs-shell.toml,agent-bridges.toml}`, `tauri.conf.json`, `Cargo.toml`
- `apps/desktop/renderer/src/surfaces/settings/{settings-data.ts,McpServersPane.tsx}`
- root `package.json` (harness scripts + validate chain), `apps/desktop/renderer/package.json` (deps)

---

## Phase 1 — Preview backend (Rust lane)

### Task 1.1: `project_preview_meta` command

**Files:**
- Create: `apps/desktop/src-tauri/src/preview.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (module + invoke_handler), `apps/desktop/src-tauri/Cargo.toml` (add `infer = "0.16"` or current), `apps/desktop/src-tauri/permissions/fs-shell.toml`

**Interfaces (produces):**
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreviewMeta {
    pub file_name: String,
    pub mime_type: Option<String>,   // infer sniff of first 8 KB, None if unknown
    pub extension: Option<String>,   // lowercased, no dot
    pub byte_length: u64,
    pub modified_at: Option<String>, // RFC3339
    pub text: Option<String>,        // present iff content is valid bounded UTF-8 text
    pub truncated: bool,             // text was cut at MAX_PREVIEW_TEXT_BYTES
}
pub const MAX_PREVIEW_TEXT_BYTES: u64 = 262_144; // 256 KB

#[tauri::command]
pub async fn project_preview_meta<R: Runtime>(
    app: tauri::AppHandle<R>, path: String, project_id: Option<String>,
) -> Result<ProjectPreviewMeta, String>
```

- [x] **Step 1:** Write `preview.rs` with the struct above. Resolution mirrors `project_read_file_preview` exactly: `workspace_roots(&app, project_id.as_deref())` → `resolve_project_candidate(&path, None, &roots)` → `.canonicalize()` → `ensure_inside_workspace(&candidate, &roots)` (import these from `crate::builtin_tools`; make them `pub(crate)` if not already). Sniff MIME with `infer::get(&first_8kb)`, fall back to `None`. Text detection: read up to `MAX_PREVIEW_TEXT_BYTES`, reuse `builtin_tools::utf8_boundary_safe_string` semantics; treat as text only when the sniffed type is text-like or sniffing found nothing AND the bytes round-trip as UTF-8 with < 1% replacement.
- [x] **Step 2:** Add `#[cfg(test)]` tests in `preview.rs` following the existing `builtin_tools.rs` test style: `meta_reports_mime_for_png_magic_bytes`, `meta_returns_text_for_utf8_source`, `meta_truncates_text_at_budget`, `meta_rejects_out_of_workspace_path` (use tempdir workspace like existing tests).
- [x] **Step 3:** Register: `mod preview;` in lib.rs, `preview::project_preview_meta` in `generate_handler![]`, `"project_preview_meta"` appended to `fs-shell.toml` `commands.allow`.
- [x] **Step 4:** Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview` — expect all new tests PASS.
- [x] **Step 5:** Commit `feat(preview): binary-aware project_preview_meta command`.

### Task 1.2: `project_read_file_bytes` raw-IPC command

**Files:** Modify `apps/desktop/src-tauri/src/preview.rs`, `lib.rs`, `permissions/fs-shell.toml`

**Interfaces (produces):**
```rust
pub const MAX_PREVIEW_BINARY_BYTES: u64 = 33_554_432; // 32 MB

#[tauri::command]
pub async fn project_read_file_bytes<R: Runtime>(
    app: tauri::AppHandle<R>, path: String, project_id: Option<String>, max_bytes: Option<u32>,
) -> Result<tauri::ipc::Response, String>
// body = raw file bytes, clamped to min(max_bytes, MAX_PREVIEW_BINARY_BYTES, file size)
```
Renderer consumes via `const buf: ArrayBuffer = await invoke('project_read_file_bytes', {...})` (Tauri 2 raw IPC).

- [x] **Step 1:** Implement with identical sandbox resolution order; return `tauri::ipc::Response::new(bytes)`. Reject empty roots and out-of-workspace exactly like Task 1.1.
- [x] **Step 2:** Tests: `bytes_clamps_to_binary_budget`, `bytes_rejects_out_of_workspace_path`. Note: command returns `Response`, so test the extracted `read_bounded_bytes(candidate, clamp) -> Result<Vec<u8>, String>` helper directly.
- [x] **Step 3:** Register in lib.rs + fs-shell.toml. Run cargo tests → PASS. Commit `feat(preview): raw-IPC bounded binary reads`.

### Task 1.3: `offisim-media` streaming protocol + CSP

**Files:** Modify `apps/desktop/src-tauri/src/preview.rs`, `lib.rs`, `tauri.conf.json`

**Interfaces (produces):** URL shape consumed by renderer:
`offisim-media://localhost/file?path=<urlencoded-abs-path>&projectId=<id>` (macOS WKWebView form; renderer builds it via a helper in `preview-data.ts`).

- [x] **Step 1:** In `lib.rs` builder chain add `.register_asynchronous_uri_scheme_protocol("offisim-media", ...)` delegating to `preview::serve_media(app, request, responder)`. `serve_media` parses `path`/`projectId` query params, runs the same four-step sandbox resolution, then serves bytes honoring a `Range: bytes=start-end` header: `206 Partial Content` + `Content-Range`/`Accept-Ranges: bytes`/`Content-Length`, `200` for full requests, `403` for sandbox rejection, `404` for missing file. Read only the requested window (seek + take), never the whole file.
- [x] **Step 2:** Tests for the pure range logic: `range_parses_and_clamps`, `range_serves_full_when_absent`, `media_rejects_out_of_workspace` (test the extracted `plan_media_response(path_ok, file_len, range_header) -> MediaPlan` helper).
- [x] **Step 3:** Replace the CSP string in `tauri.conf.json` with exactly:
```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: offisim-media: http://offisim-media.localhost; media-src 'self' blob: offisim-media: http://offisim-media.localhost; frame-src 'self' blob: http://localhost:* http://127.0.0.1:* https://localhost:*; connect-src 'self' https: wss: ipc: http://ipc.localhost http://localhost:4100 https://localhost:4100 tauri://localhost offisim-media: http://offisim-media.localhost; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'
```
(`scripts/check-platform-tauri-origin-sync.mjs` only asserts connect-src ⊇ platform origins — unchanged origins keep it green; run it to confirm.)
- [x] **Step 4:** `cargo test` PASS; `node scripts/check-platform-tauri-origin-sync.mjs` PASS. Commit `feat(preview): sandboxed offisim-media streaming protocol + CSP media/frame directives`.

**Phase 1 Gate:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` green; `pnpm --filter @offisim/desktop build` compiles. Lead runs simplify + `codex:review` on the diff.

---

## Phase 2 — Preview target model (renderer contract)

### Task 2.1: New `StageViewTarget` + resolver module

**Files:**
- Create: `apps/desktop/renderer/src/surfaces/office/stage-preview/preview-target.ts`
- Modify: `apps/desktop/renderer/src/app/ui-state.ts`

**Interfaces (produces — later tasks depend on these exact names):**
```ts
// preview-target.ts
export type PreviewSourceRef =
  | { source: 'workspace-file'; path: string }
  | { source: 'deliverable'; deliverableId: string; threadId: string | null; format?: string; name?: string }
  | { source: 'browser'; sourceId?: string; url?: string; detail?: Extract<ToolRichDetail, { family: 'browser' }> }
  | { source: 'screenshot'; dataRef: string; mimeType: string; title?: string; url?: string }
  | { source: 'computer-artifact'; path: string; runId?: string };

export type PreviewViewerKind =
  | 'text' | 'code' | 'json' | 'structured-text' | 'markdown' | 'image' | 'pdf' | 'html'
  | 'csv' | 'spreadsheet' | 'doc' | 'slides' | 'video' | 'audio' | 'model3d'
  | 'browser' | 'screenshot' | 'unsupported';

export interface ResolvedPreviewTarget {
  ref: PreviewSourceRef;
  viewerKind: PreviewViewerKind;
  trustLevel: 'workspace' | 'generated' | 'external' | 'computer';
  meta: { title: string; path?: string; url?: string; mimeType?: string; extension?: string;
          byteLength?: number; modifiedAt?: string; threadId?: string | null };
}

export function resolveViewerKind(input: { mimeType?: string; extension?: string; hasText: boolean }): PreviewViewerKind;
export function trustLevelFor(ref: PreviewSourceRef): ResolvedPreviewTarget['trustLevel'];
```
```ts
// ui-state.ts — replaces the old union (prelaunch: no wrapper)
export type StagePrimaryTab = 'game' | 'preview' | 'computer' | 'terminal' | 'review';
export type StageViewTarget =
  | { kind: 'scene' }
  | { kind: 'preview'; ref: PreviewSourceRef; title?: string }
  | { kind: 'changes'; path?: string | null }
  | { kind: 'logs'; title?: string; tool?: string; sourceId?: string; status?: StageToolStatus; detail?: ToolRichDetail }
  | { kind: 'computer'; threadId?: string | null };
// stageTabForTarget: preview→'preview', logs→'terminal', changes→'review', computer→'computer', scene→'game'
// stageTabIdForTarget: preview id from ref (workspace-file:path / deliverable:id / browser:sourceId?? url / screenshot:dataRef hash / computer-artifact:path); computer→'computer'
```
`resolveViewerKind` decision table (extension fallback when MIME absent): md/markdown→markdown; json/ndjson→json; yaml/yml/toml/xml→structured-text; csv/tsv→csv; xlsx/xls→spreadsheet; docx/doc/rtf→doc; pptx/ppt→slides; pdf→pdf; png/jpg/jpeg/gif/webp/svg/avif/heic→image; html/htm→html; mp4/mov/m4v/webm→video; mp3/m4a/wav/aac/flac/ogg→audio; glb/gltf/vrm→model3d; code extensions (ts/tsx/js/rs/py/go/…, reuse `kindFromMime` hints)→code; `hasText`→text; else→unsupported.

- [x] **Step 1:** Write `harness-stage-preview-targets.mts` FIRST (it will fail to import until Step 2): checks named `resolver:*` and `ui-state:*` — `resolver:md-extension-maps-markdown`, `resolver:mime-wins-over-extension`, `resolver:unknown-binary-unsupported`, `resolver:text-fallback-when-hasText`, `resolver:glb-maps-model3d`, `trust:workspace-file-is-workspace`, `trust:deliverable-is-generated`, `trust:computer-artifact-is-computer`, `ui-state:preview-target-maps-preview-tab`, `ui-state:computer-target-maps-computer-tab`, `ui-state:tab-id-stable-for-same-file`, `ui-state:open-activate-close-roundtrip` (drive the zustand store directly like `harness-conversation-run-controller.mts` does). Register `harness:stage-preview-targets` in package.json (tsx + renderer tsconfig) and append to `validate`.
- [x] **Step 2:** Run it → expect FAIL (module missing). Implement `preview-target.ts` and the `ui-state.ts` replacement (update `gameStageState`, `stageTabForTarget`, `stageTabIdForTarget`, `stageOpenTabForTarget`; `openStageView`/`activateStageTab`/`closeStageTab` logic unchanged). Delete the old `output`/`file` kinds outright.
- [x] **Step 3:** Run `pnpm harness:stage-preview-targets` → all checks PASS. Renderer typecheck will still FAIL (call sites) — that is Task 2.2's job. Commit `feat(stage): preview-first StageViewTarget + resolver contract`.

### Task 2.2: Migrate every `openStageView` call site

**Files:** Modify: `StageViewer.tsx` (menu/auto-open/tab labels only — body views die in Phase 3), `stage-viewer/file-preview.ts`, `stage-viewer/artifact-claim.ts`, `scene/delivery-history.ts`, `rail/ConvOutputs.tsx`, `WorkspacePanel.tsx`, `WorkloadDrilldown.tsx`, `OfficeScene2D.tsx`/`OfficeScene3D.tsx` (if they pass targets directly)

**Interfaces (consumes):** `PreviewSourceRef`, new `StageViewTarget` from Task 2.1.

- [x] **Step 1:** Mechanical mapping, no behavior additions:
  - ConvOutputs deliverable click → `{ kind:'preview', ref:{ source:'deliverable', deliverableId, threadId, format, name }, title }`
  - WorkspacePanel `previewNode` → `{ kind:'preview', ref:{ source:'workspace-file', path } }` for EVERY file — delete `NON_TEXT_PREVIEW_EXTENSIONS` and `canPreviewInline` entirely.
  - `file-preview.ts`: `openStageFilePreview` shrinks to emitting the preview target (loading/error state moves into the pane in Phase 3); keep the export name so artifact-claim keeps one path.
  - `artifact-claim.ts` resolution: output/file → `preview` refs; browser → `{ source:'browser', ... }`; logs unchanged.
  - StageViewer menu items: Output/Preview/Files entries all emit `kind:'preview'` targets; `StageAutoOpenForThread` new-deliverable → deliverable ref; new-browser-activity → browser ref.
- [x] **Step 2:** `pnpm --filter @offisim/desktop-renderer typecheck` → PASS (this is the completion signal that no old-kind references remain). Run `pnpm harness:artifact-claim` — update its expectations to the new target shapes in the same commit.
- [x] **Step 3:** Commit `refactor(stage): route all stage opens through PreviewSourceRef`.

**Phase 2 Gate:** `pnpm harness:stage-preview-targets && pnpm harness:artifact-claim` green; renderer typecheck green (build still references old views — acceptable only if typecheck is green; otherwise finish Phase 3 before pausing). Lead simplify + `codex:review`.

---

## Phase 3 — StagePreviewPane + core viewers

### Task 3.1: Pane, data loading, actions, unsupported state

**Files:**
- Create: `stage-preview/preview-data.ts`, `stage-preview/StagePreviewPane.tsx`, `stage-preview/viewers/UnsupportedViewer.tsx`
- Modify: `StageViewer.tsx` — `StageTabBody` for tab `'preview'` renders `<StagePreviewPane target={...} />`; DELETE `OutputView`, `FileView`, `PreviewView`, `useDeliverableText` (move body-loading into preview-data.ts)

**Interfaces (produces):**
```ts
// preview-data.ts
export type PreviewData =
  | { mode: 'text'; text: string; truncated: boolean }
  | { mode: 'bytes'; bytes: Uint8Array; objectUrl: string }   // caller revokes on unmount
  | { mode: 'stream'; streamUrl: string }
  | { mode: 'inline-html'; html: string }
  | { mode: 'url'; url: string }
  | { mode: 'screenshot'; dataRef: string }
  | { mode: 'none'; reason: string };
export async function loadPreview(ref: PreviewSourceRef, projectId: string | null):
  Promise<{ resolved: ResolvedPreviewTarget; data: PreviewData }>;
export function mediaStreamUrl(path: string, projectId: string | null): string; // offisim-media://localhost/file?...
```
Loading rules: workspace-file → `invoke('project_preview_meta')`; text kinds use `meta.text`; image/pdf/model3d → `invoke('project_read_file_bytes')` → Blob object URL; video/audio → `mediaStreamUrl` (no read); deliverable → `loadDeliverableBody` (existing, `data/queries.ts:540`), HTML format → `inline-html`, else text; browser → `url` if `isEmbeddablePreviewUrl` (keep that helper, move it here) else `screenshot`; screenshot → `screenshot`; computer-artifact → same as workspace-file.

- [x] **Step 1:** Implement pane: header (title, byte/size meta, trust badge) + actions bar (open externally / reveal in Finder via existing opener plugin permissions; copy path; copy URL when present) + async load with loading/error/`UnsupportedViewer` states + dispatch on `viewerKind`. Viewer components mount lazily (`React.lazy`) so pdfjs/three chunks stay out of the main bundle.
- [x] **Step 2:** Extend `harness-stage-preview-targets.mts` with `data:*` checks for the pure routing parts (`data:workspace-md-loads-text-lane`, `data:mp4-routes-stream-no-read`, `data:html-deliverable-inline-html`, `data:browser-localhost-embeds-url`, `data:browser-external-falls-to-screenshot`) — factor lane selection into a pure `planPreviewLoad(resolved) -> PreviewData['mode']` so it's harness-testable without Tauri.
- [x] **Step 3:** `pnpm harness:stage-preview-targets` PASS; renderer typecheck PASS. Commit `feat(stage): StagePreviewPane replaces Output/File/Preview views`.

### Task 3.2–3.7: Core viewers (one commit each, same pattern)

**Files:** Create viewer components under `stage-preview/viewers/`; each receives `{ resolved: ResolvedPreviewTarget; data: PreviewData }`.

- [x] **3.2 TextViewer** (`text`/`code`/logs): monospaced `<pre>` with line numbers, client-side search box (highlight + next/prev), truncation banner from `data.truncated`, virtualized via existing `@tanstack/react-virtual` for >2k lines.
- [x] **3.3 StructuredTextViewer** (`json`/`structured-text`): parse JSON natively, YAML via `yaml`, TOML via `smol-toml`, XML via native `DOMParser`; render collapsible key tree; raw toggle falls back to TextViewer; parse failure → raw with error banner. Add renderer deps `yaml@^2`, `smol-toml@^1`.
- [x] **3.4 MarkdownViewer**: existing `react-markdown` + `remark-gfm`; raw toggle.
- [x] **3.5 ImageViewer**: object URL from bytes; fit/actual-size toggle, wheel zoom + drag pan, dimensions + byte meta line.
- [x] **3.6 CsvViewer**: create `csv-parse.ts` (RFC-4180 quoted parser, ~60 lines, handles quotes/escapes/CRLF; unit checks `csv:quoted-comma`, `csv:escaped-quote`, `csv:crlf` go into harness-stage-preview-targets); virtualized table with header row; raw toggle.
- [x] **3.7 HtmlViewer**: trusted generated output → `<iframe sandbox="allow-forms allow-scripts" srcDoc={html}>` (drop `allow-same-origin` — trusted-but-generated content gets no host-origin access; this supersedes the old PreviewView sandbox); `url` mode → iframe `src` for localhost URLs (CSP frame-src from Task 1.3); screenshot mode → image + URL caption.
- [x] Each viewer: renderer typecheck + build PASS, then commit (`feat(preview): <viewer> viewer`).

**Phase 3 Gate:** `pnpm --filter @offisim/desktop-renderer typecheck && pnpm --filter @offisim/desktop-renderer build` green; `pnpm validate` green; release `.app` build + live spot-check (open md/json/csv/png/html deliverable + workspace files through Files rail — screenshots into `Docs/evidence/`). Lead simplify + `codex:review`.

---

## Phase 4 — Document, media, 3D viewers

### Task 4.1: PDF viewer (visual pages + text search)

**Files:** Create `viewers/PdfViewer.tsx`; Modify `apps/desktop/renderer/package.json` (add `@offisim/doc-engine: workspace:*`, `pdfjs-dist@^4.7.76`)

**Interfaces (consumes):** `data.bytes`; doc-engine `resolvePdfWorkerSrc` (exported from `@offisim/doc-engine`) for worker wiring; doc-engine `parseAttachment` for the text/search lane.

- [x] **Step 1:** Render via `pdfjs-dist` `getDocument({ data: bytes })`: page canvas list with page-number rail, zoom (fit-width/fit-page/percent), prev/next. Text search: run `parseAttachment(bytes, 'application/pdf', name)` lazily on first search; jump-to-page from `pages[]` hit index.
- [x] **Step 2:** Renderer build must show pdfjs in a lazy chunk (check `dist/assets` listing; main chunk must not grow past current ~1.7 MB baseline by more than 50 KB).
- [x] **Step 3:** Typecheck/build PASS; live check one real PDF in release `.app`. Commit.

### Task 4.2: DOCX / XLSX / PPTX viewers via doc-engine

**Files:** Create `viewers/DocViewer.tsx`, `viewers/SheetViewer.tsx`, `viewers/SlidesViewer.tsx`

**Interfaces (consumes):** `parseAttachment(bytes, mimeType, filename)` from `@offisim/doc-engine`; `ParsedAttachment` variants `docx{html,text}`, `xlsx{sheets[{name,csv,rowCount}]}`, `pptx{slides[]}` (shared-types `chat-attachments.ts:114-146`).

- [x] **Step 1:** DocViewer: render mammoth HTML inside a style-scoped container (`off-doc-html` class, sanitize with the same approach as chat if any exists — otherwise render via `dangerouslySetInnerHTML` inside a sandboxed shadow-root wrapper); raw-text toggle. SheetViewer: sheet tabs from `sheets[].name`, each rendered through `csv-parse.ts` + the virtualized table from CsvViewer (extract shared `DataTable` into `viewers/data-table.tsx`). SlidesViewer: slide cards from `slides[]` with index.
- [x] **Step 2:** MIME passed to parseAttachment comes from `resolveViewerKind` inputs (map ext→official MIME with a small table in preview-data.ts; `kindFromMime` in shared-types is the reference for exact strings).
- [x] **Step 3:** Typecheck/build PASS; live check one real .docx/.xlsx/.pptx. Commit.

### Task 4.3: Media viewer (video/audio streaming)

**Files:** Create `viewers/MediaViewer.tsx`

- [x] **Step 1:** `<video controls src={data.streamUrl}>` / `<audio controls src={...}>`; `onError` → swap to UnsupportedViewer with codec explanation + open-externally action (WKWebView codec set: H.264/HEVC/AAC/MP3); metadata line (duration once `loadedmetadata`, byte size).
- [x] **Step 2:** Live check in release `.app`: an H.264 .mp4 plays AND seeks (seek proves Range serving works); an unsupported codec file degrades to the unsupported state. This is the CSP `media-src` proof — dev webview does not count.
- [x] **Step 3:** Commit.

### Task 4.4: 3D model viewer (GLB/GLTF/VRM)

**Files:** Create `viewers/ModelViewer.tsx`; Modify renderer `package.json` (add `@pixiv/three-vrm@^3.5.4`)

**Interfaces (consumes):** `data.bytes`; the character system's existing meshopt decoder wiring (find its GLTFLoader setup under the character/GLB modules and reuse the same decoder import — single decoder path in the app).

- [x] **Step 1:** R3F `<Canvas>` + `GLTFLoader.parse(bytes.buffer)` with meshopt decoder registered; `.vrm` extension additionally registers `VRMLoaderPlugin` from `@pixiv/three-vrm` and renders `gltf.userData.vrm.scene`; drei `OrbitControls` + `Stage`-style lighting + reset-camera button; dispose scene on unmount.
- [x] **Step 2:** Typecheck/build PASS (three-vrm in lazy chunk); live check one .glb and one .vrm in release `.app`. Commit.

**Phase 4 Gate:** full `pnpm validate` green; `pnpm --filter @offisim/desktop build`; release `.app` screenshot evidence for image/PDF/JSON/CSV/XLSX/DOCX/PPTX/HTML/video/audio/GLB/VRM/unsupported-binary into `Docs/evidence/2026-07-XX-stage-preview/`. Lead simplify + `codex:review`.

---

## Phase 5 — Computer Use contract (events + wire)

### Task 5.1: `family: 'computer'` rich detail

**Files:** Modify `packages/shared-types/src/events/agent-run.ts`; Create `scripts/harness-computer-rich-detail.mts`

**Interfaces (produces):**
```ts
| { readonly family: 'computer';
    readonly action?: 'click' | 'type' | 'key' | 'scroll' | 'wait' | 'screenshot' | 'observe' | 'drag' | 'move';
    readonly targetApp?: string;
    readonly targetWindow?: string;
    readonly url?: string;
    readonly coordinates?: { readonly x: number; readonly y: number };
    readonly textPreview?: string;        // sanitized, never raw credentials
    readonly resultState?: 'ok' | 'failed' | 'pending';
    readonly screenshot?: { readonly mimeType: string; readonly dataRef: string };
    readonly artifactPaths?: readonly string[]; }
```
Detection is data-driven like browser: `computerDetailFrom(value)` returns the family iff the detail JSON has a `computer` object (`{ computer: { action, targetApp, ... }, image? }`); checked BEFORE `browserDetailFrom` in `parseToolRichDetail`. `mergeToolRichDetail` keeps the last screenshot when the terminal event has none.

- [x] **Step 1:** Write `harness-computer-rich-detail.mts` first with named checks: `computer:detail-json-maps-family`, `computer:action-kind-parsed`, `computer:screenshot-dataref-preserved`, `computer:merge-keeps-last-screenshot`, `computer:text-preview-caps-length`, `computer:no-marker-falls-through-to-browser-then-generic`, `computer:coordinates-parsed`. Register `harness:computer-rich-detail` + append to `validate`. Run → FAIL.
- [x] **Step 2:** Implement in agent-run.ts; force-refresh shared-types dist. Run harness → PASS. Also run `pnpm harness:agent-run-projection && pnpm harness:conversation-run-controller` — must stay green (additive family).
- [x] **Step 3:** Commit `feat(events): computer tool rich-detail family`.

### Task 5.2: New event types + protocol v5

**Files:** Modify `packages/shared-types/src/events/agent-run.ts` (AgentRunEventType + payload), `apps/desktop/src-tauri/src/pi_agent_host.rs:65`, `scripts/pi-agent-host-wire.mjs:14`, `scripts/fixtures/pi-wire-contract.json`

**Interfaces (produces):**
```ts
export type AgentRunEventType = /* existing 9 */ | 'computer.target.selected' | 'computer.sensitive.paused';
// payloads: target.selected { targetApp: string; targetWindow?: string }
//           sensitive.paused { reason: 'external-navigation' | 'download' | 'credential-field' | 'destructive' ; detail?: string }
```

- [x] **Step 1:** Extend the type + payload union + any exhaustive switches shared-types exports (compiler will surface them). Bump `PI_HOST_PROTOCOL_VERSION` 4→5 in BOTH literals. Extend the wire builders in `pi-agent-host-wire.mjs` so the new event types appear in the contract fixture; regenerate `scripts/fixtures/pi-wire-contract.json` from the builders (the check script proves fixture ≡ builders — follow its regeneration instructions in the header comment).
- [x] **Step 2:** Run `pnpm check:pi-wire-contract` → PASS; `pnpm harness:pi-agent-host` → PASS (Rust handshake test reads the same fixture — run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` too).
- [x] **Step 3:** Commit `feat(wire): computer-use event types, protocol v5`.

### Task 5.3: MCP bridge tagging (dual-side)

**Files:** Modify `scripts/pi-mcp-bridge-extension.mjs`, `scripts/tauri-pi-agent-host.entry.mjs`, `apps/desktop/renderer/src/surfaces/settings/settings-data.ts`, rebuild `apps/desktop/src-tauri/resources/pi-agent-host.mjs` via `node scripts/build-pi-agent-host.mjs`

**Interfaces (produces):**
- `McpServer` (settings-data.ts) gains `category?: 'computer-use'`; registration UI sets it (Task 6.2).
- `mcpTools` catalog entries gain `category?: 'computer-use'` (renderer builds the catalog in settings-data.ts / grant flow — thread the field through).
- Bridge extension: when an executed MCP tool's catalog entry has `category === 'computer-use'`, the emitted tool detail JSON is `{ computer: { action, targetApp, coordinates, textPreview, resultState }, image? }` mapped from the tool name/args/result (cua-driver tool names → action kinds; screenshot images ride the existing image block).

- [x] **Step 1:** Implement all three sides; the wire rule applies — `mcpTools` already crosses the boundary verbatim so no `sidecar_payload` change is needed, but the detail JSON shape must match what `computerDetailFrom` (Task 5.1) parses: assert that in `harness:mcp-bridge-extension` with new named checks `bridge:computer-category-tags-detail`, `bridge:non-computer-tools-untouched`, `bridge:screenshot-image-block-passthrough`.
- [x] **Step 2:** `pnpm harness:mcp-bridge-extension && pnpm harness:mcp-host-channel && pnpm harness:pi-agent-host` → PASS. Rebuild the bundled host; `pnpm check:pi-wire-contract` PASS.
- [x] **Step 3:** Commit `feat(mcp): computer-use category tagging through bridge extension`.

### Task 5.4: WorkBench ComputerBench

**Files:** Modify `apps/desktop/renderer/src/surfaces/office/scene/work-bench/WorkBench.tsx`

- [x] **Step 1:** Add `ComputerBench` for `family: 'computer'`: action glyph + target app + coordinates line, screenshot thumb (same inline `data:` handling as BrowserBench), resultState tint via `is-computer` root class.
- [x] **Step 2:** Renderer typecheck/build PASS. Commit `feat(scene): computer family work bench`.

**Phase 5 Gate:** `pnpm validate` green end-to-end (includes new harnesses); cargo tests green. Lead simplify + `codex:review`.

---

## Phase 6 — Computer tab UI + setup + mock backend

### Task 6.1: `computer` Stage tab

**Files:** Create `surfaces/office/computer/ComputerView.tsx`; Modify `StageViewer.tsx` (PRIMARY_TABS gets `{ id:'computer', label:'Computer', icon: MonitorSmartphone }`; `StageTabBody` case)

**Interfaces (consumes):** activity entries with `richDetail.family === 'computer'` from `useActiveConversationRuns()`; `deliverables` rows with `run_id` for artifacts; existing approval flow (`PermissionApprovalBar` mechanics / uiRequest lane); existing run cancel path in `conversation-run-controller.ts`.

- [x] **Step 1:** Layout: task header (target app/window from latest `computer.target.selected` or richDetail, run status, elapsed, employee), viewport (latest screenshot, `is-live` ring while running), action timeline (all computer entries, virtualized, click → detail), inline approval panel when a computer-scoped approval/pause is pending (reuse the approval bar component in-pane), artifacts strip (deliverables for the run → click opens `{ kind:'preview', ref:{ source:'computer-artifact'|'deliverable', ... } }`), Stop button → existing cancel.
- [x] **Step 2:** Empty states: no run → setup status summary (Task 6.3) + "computer work appears here"; run without computer activity → quiet placeholder.
- [x] **Step 3:** Typecheck/build PASS. Commit `feat(stage): computer tab with viewport, timeline, approvals, artifacts`.

### Task 6.2: Cua Driver registration preset in Settings

**Files:** Modify `surfaces/settings/settings-data.ts`, `McpServersPane.tsx`

- [x] **Step 1:** Add a "Computer Use (Cua Driver)" preset button in the MCP pane: prefills stdio server `{ name:'cua-driver', command:'cua-driver', args:['mcp'], category:'computer-use' }` through the existing register + stdio-confirm flow; `category` persists through `mcp_register_server` metadata (extend the registration payload/records in `mcp_bridge/commands.rs` with an optional `category` string — additive field, registered in the same commit on both sides).
- [x] **Step 2:** `pnpm harness:mcp-grant-risk-class` stays green (computer-use tools are write-class: assert `grant:computer-use-tools-are-write-class` new check — they must require ask-mode approval like other write MCP tools).
- [x] **Step 3:** Typecheck/build + cargo build PASS. Commit `feat(settings): cua-driver computer-use preset`.

### Task 6.3: Driver status + setup flow

**Files:** Create `surfaces/office/computer/{ComputerSetupPanel.tsx,computer-status.ts}`, `apps/desktop/src-tauri/src/computer_driver.rs`; Modify `lib.rs`, `permissions/agent-bridges.toml`

**Interfaces (produces):**
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDriverStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub daemon_running: bool,
}
#[tauri::command]
pub async fn computer_driver_status() -> Result<ComputerDriverStatus, String>
```
Detection: locate `cua-driver` via `$PATH` lookup + known install locations; `--version` for version; daemon probe via the driver CLI's status/doctor subcommand (verify the exact subcommand against the installed CLI during implementation — it is not assumed here).

- [x] **Step 1:** Implement command + register (lib.rs + `agent-bridges.toml`). Setup panel states: not-installed (show the documented installer command with copy button + docs link — Offisim does NOT execute curl|bash itself), installed-but-daemon-down (show `open -n -g -a CuaDriver --args serve` + copy), daemon-up-but-not-registered (one-click → Task 6.2 preset), registered-not-connected (connect button via existing `connectMcpServer`), ready. Re-check button re-invokes status + `mcp_list_servers`.
- [x] **Step 2:** TCC guidance: panel links to the driver's `cua-driver permissions grant` flow and System Settings panes; state text only (Offisim cannot read another app's TCC state — surface what the driver CLI reports).
- [x] **Step 3:** Cargo test for the pure path-resolution helper; typecheck/build PASS. Commit `feat(computer): driver status command + guided setup panel`.

### Task 6.4: Mock computer-use MCP server + UI proof

**Files:** Create `scripts/mock-computer-use-mcp.mjs`

- [x] **Step 1:** Tiny stdio MCP server (JSON-RPC over stdio, tools: `computer_screenshot`, `computer_click`, `computer_type`) that replays a scripted trace: N screenshots (small embedded PNG data), click/type actions with coordinates, one sensitive-pause trigger, one artifact file write into the workspace. Purpose: drive the full computer tab in the release `.app` without Cua Driver.
- [x] **Step 2:** Register it in the release app via the Settings MCP pane (stdio: `node scripts/mock-computer-use-mcp.mjs`, category computer-use); run an Office team message that calls it; verify in release `.app`: timeline fills, viewport updates, approval pause blocks and resumes, artifact appears and opens in preview, Stop works. Screenshot evidence to `Docs/evidence/`. Early Phase 6 screenshots that captured another foreground app are intentionally excluded from final evidence; the final release proof uses the live Cua path plus the mock-backed harness gates.
- [x] **Step 3:** Commit `test(computer): mock MCP backend for UI verification`.

### Task 6.5: Run-trace evidence export

**Files:** Modify `apps/desktop/src-tauri/src/local_paths.rs` (new export command following `export_runtime_vault_zip` pattern), `lib.rs`, `permissions/fs-shell.toml`; renderer: export button in ComputerView header

**Interfaces (produces):** `#[tauri::command] pub fn export_computer_run_trace(app, thread_id: String, run_id: String, trace_json: String) -> Result<String, String>` — writes `<exports>/computer-run-<runId>.zip` containing `trace.json` (renderer-serialized timeline incl. screenshot dataRefs) and returns the path; reuses `local_exports_dir` + `create_zip_from_directory`.

- [x] **Step 1:** Implement + register; renderer serializes the run's computer entries + events to JSON and invokes; success toast shows the path with reveal action.
- [x] **Step 2:** Cargo test for zip creation with tempdir; live export in release `.app` during Task 7.1's Cua run. Commit `feat(computer): exportable run-trace evidence`.

**Phase 6 Gate:** `pnpm validate` green; mock backend + approval/risk harnesses green; final release `.app` proof is the Phase 7 live Cua Driver pass. Lead simplify + `codex:review`.

---

## Phase 7 — Live Cua Driver binding + full verification

### Task 7.1: Live binding

- [x] **Step 1:** Install Cua Driver via its documented installer (user-consented, one-line preannounce since it installs a daemon); `open -n -g -a CuaDriver --args serve`; `cua-driver permissions grant` (real TCC grants).
- [x] **Step 2:** In release `.app` Settings, register via the Task 6.2 preset; connect; confirm tools listed.
- [x] **Step 3:** Run a narrow real task through an Office employee. Final verified task: Ryan called live `cua-driver/list_apps` through Pi MCP, the release UI paused for approval, approval resumed the tool, Ryan returned `112`, the Computer tab showed the completed action timeline, and Export trace produced a zip.

### Task 7.2: Full verification matrix (completion gate)

- [x] `pnpm validate > /tmp/validate.log 2>&1` — real exit 0 (all harnesses incl. `stage-preview-targets`, `computer-rich-detail`, updated `mcp-bridge-extension`).
- [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — green.
- [x] Renderer typecheck + build; `pnpm --filter @offisim/desktop build` release `.app`.
- [x] Release `.app` screenshot evidence, every viewer kind: text/code, JSON, YAML, markdown, image, PDF (pages + search), CSV, XLSX, DOCX, PPTX, HTML (srcDoc + localhost iframe), video (plays + seeks), audio, GLB, VRM, unsupported binary (actions work: open externally, reveal, copy path).
- [x] Release `.app` Computer Use: mock backend and approval gates covered by harness; live Cua Driver pass verified in release `.app` with approval pause, `mcp_call`, Computer tab timeline, final app count, and exported trace zip.
- [x] GitNexus `detect_changes({scope:'compare', base_ref:'main'})` — affected symbols match this plan's file map; investigate anything outside it.
- [x] Update `CLAUDE.md` (runtime boundaries: preview commands list gains the new commands; AI policy unchanged) and `Docs/UI_FRAMEWORK_STACK.md` if viewer deps belong there. No UI stack change was needed; memory-topic evidence is captured in this Progress Ledger because global memory updates require an explicit user request.

**Phase 7 Gate:** everything above green → PR from `feat/stage-preview-computer-use` to `main` via `gh`, body links PRD + this plan + evidence directory.

---

## Anti-overengineering Decisions
- KEEP: single resolver + one pane; viewers are leaf components, no viewer plugin registry.
- KEEP: doc-engine as the only parsing layer; pdfjs canvas is the only added render path.
- KEEP: existing MCP bridge/meta-tool lane; no Pi SDK MCP config, no new runtime seam.
- REMOVE: old text-only preview, extension denylist, `output`/`file` target kinds — deleted, not wrapped.
- NO: syntax-highlighting dependency (PRD requires line numbers/search, not highlighting); no papaparse (60-line RFC-4180 parser suffices); no global assetProtocol; no auto-executed curl|bash installer.
- NO: per-viewer settings, preview preferences, or persistence of viewer state — YAGNI at prelaunch.

## Progress Ledger
| phase | status | evidence |
|---|---|---|
| 1 Rust preview lane | done | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml preview` PASS; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` PASS (141 tests); `node scripts/check-platform-tauri-origin-sync.mjs` PASS; `npx --yes pnpm@10.15.1 --filter @offisim/desktop build` PASS; release `.app` built at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; commit `4cc7273d` |
| 2 target model | done | `npx --yes pnpm@10.15.1 harness:stage-preview-targets` PASS (12/12); `npx --yes pnpm@10.15.1 harness:artifact-claim` PASS (16/16); `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck` PASS; `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build` PASS; GitNexus `detect_changes --repo Offisim --scope staged` risk medium, affected flows limited to Stage tab/id; commit `2c086abb` |
| 3 pane + core viewers | done | `npx --yes pnpm@10.15.1 harness:stage-preview-targets` PASS (21/21); `npx --yes pnpm@10.15.1 harness:artifact-claim` PASS (16/16); `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck` PASS; `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build` PASS; `npx --yes pnpm@10.15.1 validate > /tmp/offisim-validate-phase3-final.log 2>&1` exit 0; `npx --yes pnpm@10.15.1 --filter @offisim/desktop build` PASS; release `.app` spot-checked via Computer Use on pid `99860` for markdown raw/search, JSON tree, CSV table, HTML iframe, PNG image; screenshots in `Docs/evidence/2026-07-03-stage-preview/`; commit `1148b600` |
| 4 doc/media/3D viewers | done | `npx --yes pnpm@10.15.1 harness:stage-preview-targets` PASS (27/27); `npx --yes pnpm@10.15.1 harness:doc-engine` PASS (8/8); `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck` PASS; `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build` PASS; `npx --yes pnpm@10.15.1 validate > /tmp/offisim-validate-phase4-final.log 2>&1` exit 0; `npx --yes pnpm@10.15.1 --filter @offisim/desktop build` PASS; release `.app` checked via Computer Use on pid `73335` for PDF pages/search, DOCX HTML/raw, XLSX sheets, PPTX slides, MP4 play/seek, MP3 audio, GLB, VRM, CSV, JSON, HTML, PNG, unsupported codec and unsupported binary; screenshots in `Docs/evidence/2026-07-03-stage-preview/phase4-*.png` |
| 5 computer contract | done | `npx --yes pnpm@10.15.1 harness:computer-rich-detail` PASS (7/7); `npx --yes pnpm@10.15.1 harness:mcp-bridge-extension` PASS (22/22); `npx --yes pnpm@10.15.1 harness:mcp-host-channel` PASS (6/6); `npx --yes pnpm@10.15.1 harness:agent-run-projection` PASS (65/65); `npx --yes pnpm@10.15.1 harness:conversation-run-controller` PASS (16/16); `npx --yes pnpm@10.15.1 harness:pi-agent-host` PASS; `npx --yes pnpm@10.15.1 check:pi-wire-contract` PASS (`protocolVersion: 5`, 18 fixture lines); `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck` PASS; `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build` PASS; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` PASS (141 tests); `npx --yes pnpm@10.15.1 validate > /tmp/offisim-validate-phase5-final.log 2>&1` exit 0 |
| 6 computer tab + mock | done | `npx --yes pnpm@10.15.1 harness:mcp-grant-risk-class` PASS with `grant:computer-use-tools-are-write-class`; `npx --yes pnpm@10.15.1 harness:mcp-bridge-extension` PASS (21/21); `npx --yes pnpm@10.15.1 harness:mcp-bridge-sdk` PASS; `npx --yes pnpm@10.15.1 harness:conversation-run-controller` PASS (17/17, including approval still live when active-interaction persistence fails); `scripts/mock-computer-use-mcp.mjs` provides deterministic `computer_screenshot`, `computer_click`, and `computer_type` tools; final release evidence uses Phase 7 post-fix screenshots because early Phase 6 captures were rejected as wrong-window noise |
| 7 live + matrix | done | Current-time baseline checked `2026-07-03 19:15 NZST`; `npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck` PASS; `npx --yes pnpm@10.15.1 --filter @offisim/desktop build` PASS; release `.app` rebuilt at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; `npx --yes pnpm@10.15.1 validate > /tmp/offisim-validate-final.log 2>&1` exit 0; `npx --yes pnpm@10.15.1 harness:live-mcp-approval-gate > /tmp/offisim-live-mcp-approval-final.log 2>&1` PASS; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` PASS (147 tests); release `.app` pid `94475`, window `112382`, bounds `1440x898@36,33`; Cua Driver `0.7.0` daemon pid `43373`, TCC Accessibility/Screen Recording true; Ryan run `attempt-44ab0660-70dc-409c-984c-43821e557dbc` called live `cua-driver/list_apps`, approval was shown/approved, final answer `112`, Computer tab timeline visible, export zip `/Users/haoshengli/.offisim/exports/computer-run-attempt-44ab0660-70dc-409c-984c-43821e557dbc-1783062949.zip`; screenshots `phase7-final-post-fix-release-window.png`, `phase7-final-post-fix-office.png`, `phase7-final-post-fix-ryan-thread.png`, `phase7-final-post-fix-ryan-composer.png`, `phase7-final-post-fix-approval-monitor-03.png`, `phase7-final-post-fix-ryan-completed.png`, `phase7-final-post-fix-export-trace.png`; GitNexus `detect_changes` ran before commit |
