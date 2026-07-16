# Stage Preview + Computer Use PRD

> **Historical / superseded (2026-07-16):** implementation-era PRD, not current
> runtime/account truth or release proof. Use the [current Codex-alignment tasks](./2026-07-13-ui-ux-consistency-pass/tasks.md),
> [feature catalog](../FEATURES.md), and current release gates.

## Current Time Baseline
- Checked at: 2026-07-02 19:27 NZST; code audit pass 2026-07-03.
- Audit basis: `builtin_tools.rs`, `WorkspacePanel.tsx`, `StageViewer.tsx`, `ui-state.ts`, `packages/doc-engine`, `shared-types/events/agent-run.ts`, release CSP in `tauri.conf.json`.
- Scope: Offisim desktop Stage center panel, file/artifact/browser preview, and Computer Use integration.
- Status: production-stage requirement document for prelaunch Offisim.

## One Sentence Decision
Keep Tauri, extend Stage's preview capability from text-only to full multi-format, and deliver Computer Use as a Pi/MCP-driven capability backed by Cua Driver (`trycua/cua`) with first-class UI, permissions, screenshots, action trace, and results — as one complete delivery, not a staged subset.

Framing: preview and Computer Use are both capabilities of the existing Stage, not new product surfaces. This PRD extends what Stage can show and do; it does not introduce a separate workbench product.

## Delivery Contract
This PRD is a single complete deliverable. Every viewer, every transport, every Computer Use surface, and the live backend verification in this document are in scope for this epic. There is no "first viewer set", no "optional follow-up", no "later phase" carve-out. The epic is done only when the full verification matrix passes in the release `.app`.

## Product Context
Offisim is still prelaunch. There are no real users, no production data, and no historical compatibility contracts. This work replaces weak preview assumptions directly, with no compatibility or migration layers around them.

Current Stage limitations are self-imposed, not caused by Tauri (all verified against code, 2026-07-03):

- `file` preview is text-only through the UTF-8 `project_read_file_preview` path, hard-capped at 64 KB (`MAX_PREVIEW_BYTES`).
- `preview` means localhost browser iframe or screenshot only.
- image/PDF/media/3D files are hard-blocked from inline preview by the `NON_TEXT_PREVIEW_EXTENSIONS` denylist in `WorkspacePanel.tsx`.
- `doc-engine` already parses PDF, DOCX, XLSX, PPTX, image, text, data, and code, but Stage does not use it as a viewer system.

Tauri stays. The fix is a stronger Stage preview architecture plus a proper Computer Use integration boundary.

## Research Summary
Current mainstream Computer Use work is split into five lanes:

1. Official model/tool products:
   - OpenAI Codex Computer Use: app/plugin permissions, Screen Recording + Accessibility on macOS, app allow/deny policy, narrow scoped tasks, screenshot/action context, structured plugin preferred when available.
   - Anthropic Computer Use: client-side screenshots/actions, explicit risk guidance, reference Docker/native loops, human oversight for sensitive flows.

2. Open-source full desktop infrastructure:
   - `trycua/cua`: open-source infrastructure for Computer-Use Agents; sandboxes, SDKs, benchmarks; macOS/Linux/Windows.
   - `QwenLM/open-computer-use`: MCP-based Computer Use service; accessibility APIs; macOS/Linux/Windows; published as an npm package.

3. Vision-native GUI agent stacks:
   - `bytedance/UI-TARS-desktop`: native GUI agent with screenshot recognition, mouse/keyboard control, local/remote computer and browser operators.
   - `bytedance/UI-TARS`: model/research line for GUI/computer/game/tool use.
   - `xlang-ai/OpenCUA`: open foundations, datasets, models, and benchmark work for Computer-Use Agents.

4. Browser/UI automation lane:
   - `browser-use/browser-use`: widely used browser agent stack for Claude Code, Codex, and other coding agents.
   - `Skyvern-AI/skyvern`: Playwright-compatible browser automation with LLM + vision, no-code workflow builder.
   - `web-infra-dev/midscene`: vision-driven UI automation across browser/mobile/desktop screenshot surfaces.

5. Benchmarks/evaluation:
   - OSWorld / OSWorld-Verified: the common evaluation reference for open-ended computer tasks across operating systems.
   - CUA benchmarks increasingly track success rate, latency, trajectory quality, and action trace reliability.

Product implication: Offisim does not invent a raw desktop-control engine. It provides a Computer Use host surface and adapter boundary, and binds a real MCP desktop-control backend through Pi in this same delivery.

## Solution Research (verified 2026-07-03)
Backend candidates were verified against current sources, not memory:

- `trycua/cua` — Cua Driver (github.com/trycua/cua, MIT, 19.3k stars, latest release 2026-06-26, checked 2026-07-03):
  - native daemon installed via the project's installer script; on macOS it runs as its own `CuaDriver` app bundle plus `cua-driver` CLI.
  - exposes a stdio MCP server (`cua-driver mcp`) that any MCP client can mount — fits Pi's MCP seam directly.
  - "no-foreground contract": drives target apps in the background without stealing keyboard focus or moving the user's cursor (macOS 14+). This is the decisive product fit — Offisim employees work while the user keeps full control of their own mouse and keyboard.
  - macOS TCC (Accessibility + Screen Recording) attributes to `CuaDriver.app`, with its own `cua-driver permissions grant` flow — clean permission lifecycle, decoupled from Offisim.app signing and rebuilds.
- `@qwen-code/open-computer-use` (npm, QwenLM, checked 2026-07-03): MCP-based desktop control via accessibility APIs, ~50 MB npx-installable package, macOS/Linux/Windows. Foreground control (owns the real cursor while acting), TCC attributes to the spawning host process. Retained as the fallback adapter behind the same event contract.

Preview capability needs exactly one new dependency; everything else is already in the repo:

- `@pixiv/three-vrm@3.5.2` (npm, published 2026-06, checked 2026-07-03) — VRM loads as a GLTFLoader plugin on the existing three 0.184 + @react-three stack.
- already present: `pdfjs-dist` ^4.7.76, `mammoth` (DOCX→HTML), SheetJS `xlsx` 0.20.3, `fflate`, three + @react-three/fiber/drei + local meshopt decoder.

## Product Goals
1. Make the center Stage useful for real work artifacts.
2. Make preview support at least competitive with Codex-style file previews.
3. Make Computer Use a first-class Offisim workflow, not an afterthought.
4. Preserve Pi Agent as the only AI runtime owner.
5. Avoid compatibility or migration debt from the old text-only preview model.

## Stage Information Architecture
Primary tabs become: `game` / `preview` / `computer` / `terminal` / `review`.

- `preview` absorbs the current `browser` and `files` tabs: workspace files, artifacts/deliverables, browser output, screenshots, generated HTML, and Computer Use artifacts all open as preview targets.
- `computer` is the Computer Use surface described below.
- `terminal` and `review` keep their current roles (run logs; git changes/diff).
- `game` keeps the office scene.

`StageViewTarget` is replaced, not compatibility-wrapped. All current `openStageView` call sites move to the resolver in the same change: `ui-state.ts`, `StageViewer.tsx`, `WorkspacePanel.tsx`, `stage-viewer/file-preview.ts`, `stage-viewer/artifact-claim.ts`, `scene/delivery-history.ts`, and `rail/ConvOutputs.tsx`. `OutputView`, `FileView`, and `PreviewView` converge into a `StagePreviewPane` with viewer components.

## Preview Target Model
A unified preview resolver replaces the coarse `file` / `preview` split.

- `ResolvedPreviewTarget.source`: workspace-file, deliverable, browser, screenshot, generated-output, computer-artifact.
- `ResolvedPreviewTarget.viewerKind`: text, code, json, markdown, image, pdf, html, csv, spreadsheet, doc, slides, video, audio, 3d, diff, logs, browser, screenshot, unsupported.
- `ResolvedPreviewTarget.trustLevel`: workspace, generated, external, computer.
- metadata: path, URL, title, MIME, extension, byte size, modified time, source run/thread, trust level.
- actions: open externally, reveal in Finder, copy path, copy URL, open logs, open thread, download/export where applicable.

Resolution uses MIME sniffing plus extension fallback. The workspace panel's non-text extension denylist is deleted; every file enters the resolver, and unsupported/binary is a normal viewer state with actions, not a blocked path.

## Viewer Matrix (all in scope)
- text/code/log: large-file-aware, monospaced, search, line numbers, truncation state.
- json/yaml/toml/xml: formatted structure view with raw toggle.
- markdown: rendered view plus raw toggle.
- image: PNG, JPEG, GIF, WebP, SVG, AVIF, HEIC (where WKWebView decodes it); zoom/pan/fit/actual size; dimensions and byte metadata.
- PDF: visual page viewer with page list/thumbnails and zoom, rendered through pdfjs-dist canvas directly (already a doc-engine dependency); text extraction and search reuse doc-engine `parsePdf` output. Both paths ship together.
- CSV/table: virtualized table, column headers, raw toggle.
- XLSX: sheet tabs, bounded rows, cell preview, reusing doc-engine sheet/CSV output.
- DOCX: readable rendered preview reusing doc-engine HTML output (mammoth), raw text toggle.
- PPTX: slide-by-slide readable preview reusing doc-engine slide output.
- HTML: sandboxed `srcDoc` for trusted generated outputs and iframe for allowed local URLs.
- video/audio: native media element with metadata, served through the streaming protocol below. Codec reality: WKWebView's native set (H.264/HEVC, AAC/MP3); codecs WKWebView cannot decode resolve to the unsupported state with external-open actions instead of a broken player.
- 3D: GLB/GLTF/VRM viewer on the existing Three stack (three + @react-three/fiber/drei + local meshopt decoder); VRM ships in this delivery via `@pixiv/three-vrm@3.5.2` as a GLTFLoader plugin; OrbitControls, lighting, reset camera.
- diff: file diff view (review tab continuity).
- browser/screenshot: iframe and screenshot targets as today, routed through the resolver.
- unsupported/binary: clear reason plus external-open/reveal actions.

## Workspace Preview Backend
A binary-safe workspace preview command replaces text-only preview, preserving the existing workspace-root/canonicalization/sandbox guarantees. It returns metadata plus either bounded text or bounded bytes:

- path, file name, MIME type if known, extension, byte length, modified time, truncated flag.
- text when safe and useful.
- bounded raw bytes for binary preview.
- resolver hint.

Binary transport constraints (verified against current code, 2026-07-03):

- no base64 through JSON IPC for large binaries; bounded reads use Tauri 2 raw IPC binary responses (`tauri::ipc::Response`), with renderer-side blob/object URLs built from those bytes.
- video/audio stream through a sandboxed custom URI scheme handler (`register_uri_scheme_protocol`) that reuses the existing `workspace_root` canonicalization checks and supports range requests; full-file reads into memory are not acceptable for media.
- the global Tauri `assetProtocol` scope stays disabled for workspace preview; its allowlist is a second permission model that would bypass the project sandbox commands.
- `MAX_PREVIEW_BYTES` (64 KB) remains the text-tree budget; the binary-safe command carries explicit per-kind budgets (text ~256 KB, image/PDF/3D bounded reads in the low tens of MB, media streamed instead of read).

## Release CSP Prerequisites
Current release CSP verified 2026-07-03. These changes land in the same commits as the viewers that need them (same failure class as the meshopt WASM CSP incident):

- `img-src` already allows `data:` and `blob:`; image blob preview works as-is.
- add `media-src 'self' blob:` with the media viewer; today media falls back to `default-src 'self'` and blob video/audio would be silently blocked in the release `.app`.
- declare `frame-src` explicitly for the localhost iframe and HTML preview iframe behavior; release behavior is verified, not assumed from dev webview behavior.
- `worker-src 'self' blob:` and `wasm-unsafe-eval` are already present and cover the pdfjs worker path.

## Computer Use Requirements
Computer Use is delivered complete in this epic: UI, event contract, permissions, adapter boundary, and one real MCP desktop-control backend bound through Pi and live-verified.

Offisim responsibilities:

- show Computer Use task state in Stage.
- show target app/window/browser context.
- show live screenshot or latest screenshot.
- show action trace: click, type, key, scroll, wait, screenshot, observe.
- show permission/approval prompts.
- show sensitive-action pauses.
- show result artifacts and logs.
- let user stop/take over.
- persist run trace as inspectable, exportable evidence.

Pi/MCP responsibilities:

- own the AI model/tool loop.
- own provider auth and model selection.
- call the Computer Use backend as a tool/MCP capability.
- emit structured events back to Offisim.

Backend decision:

- primary backend in this delivery: **Cua Driver (`trycua/cua`)**, mounted through Pi's MCP configuration as a stdio MCP server. Decisive reasons: background no-focus-steal control matches Offisim's product (employees work while the user keeps their own cursor), the MCP server fits the existing Pi seam with no second runtime, TCC permissions attribute cleanly to the standalone `CuaDriver.app` daemon, and the project is MIT-licensed and actively maintained.
- fallback adapter behind the same event contract: `@qwen-code/open-computer-use` (npm/npx, foreground control). The adapter boundary also keeps OpenAI-CUA-style and browser-only (Browser Use / Skyvern / Midscene) backends swappable, but the contract is proven against the real primary backend in this epic, not only against mocks.
- browser-heavy tasks keep flowing through Pi's existing browser tooling and the `browser` rich-detail family; Computer Use targets native desktop surfaces.

Offisim must not become a second AI runtime or provider catalog. Computer Use is a tool capability surfaced by Pi and visualized by Offisim.

## Computer Use Event Contract
Computer Use needs explicit event semantics, not generic MCP audit rows only — expressed inside the existing wire architecture, not as a parallel event namespace (verified against `packages/shared-types/src/events/agent-run.ts`, 2026-07-03):

- all run events already flow through the single `agent.run` envelope with `AgentRunEventType` (`run.started`, `tool.started`, `tool.completed`, `artifact.created`, `approval.requested`, `run.completed`, `run.failed`, `run.cancelled`).
- tool work views are already rendered from `ToolRichDetail` families (`terminal`, `file`, `search`, `browser`, `generic`).
- Computer Use adds a `family: 'computer'` rich detail carrying action kind (click, type, key, scroll, wait, screenshot, observe), target app/window/url, optional screenshot reference, optional coordinates, safe text preview, result state, and artifact references.
- task lifecycle, approvals, and artifacts reuse the existing event types; genuinely new semantics (target selection, sensitive-action pause) extend `AgentRunEventType` with a protocol version bump — prelaunch, so replace, no compatibility layer.
- hard wire rule: every new payload field is forwarded on both sides of the Pi host boundary — Rust `sidecar_payload` forwarding and Node host `payload.*` reads — plus harness static guards on both sides and the bundle, the same dual-side rule whose violation caused the `projectId is not defined` failure.

This is what lets the Stage render viewport, timeline, approvals, and handoff without parsing backend-specific logs.

## Permissions and Approval
Approval reuses the existing UI approval bridge (`approval.requested` + the permission-mode gating), extended with Computer Use semantics:

- capability enablement: Computer Use is installed/enabled explicitly, never on by default.
- driver setup: Offisim orchestrates the Cua Driver lifecycle with user consent — detect whether the daemon is installed, run the documented installer after an explicit confirmation, start/health-check the daemon (`CuaDriver.app` + `cua-driver` CLI), and mount its MCP server into Pi's MCP configuration.
- macOS TCC setup: Screen Recording and Accessibility grants attribute to `CuaDriver.app` (its own `permissions grant` flow), not to Offisim.app. The first-run setup flow detects missing grants, guides through the driver's permission flow and the right System Settings panes, and re-checks — setup state is visible in the `computer` tab, not buried in logs.
- target app/window permission: per-task target approval before control starts.
- sensitive action pause: external navigation, downloads, credential/secret fields, destructive OS actions pause and require explicit approval.
- never automated: admin authentication, security/privacy permission prompts, protected secrets flows.

## Codex-Aligned Behavior
Codex's current product pattern is copied at the product level:

- install/enable Computer Use capability explicitly.
- require OS-level Screen Recording / Accessibility where needed.
- require target app/window permission.
- prefer structured plugin/MCP integration when available.
- use visual Computer Use only when structured access is insufficient.
- keep tasks narrow and target-specific.
- show screenshots/actions/logs as inspectable trace.
- pause for sensitive or disruptive actions.
- do not automate admin authentication, security/privacy permission prompts, or protected secrets flows.

## Computer Tab (Stage Integration)
- primary tab: `computer`.
- task header: target app/window, status, elapsed time, controlling employee/run.
- live viewport: screenshot stream or latest screenshot.
- action timeline: every observe/action/result.
- approvals: inline blocking panel.
- artifacts: screenshots, files, browser URLs, logs, output.
- handoff: produced files open in Stage Preview through the same resolver, not in a separate viewer.
- takeover/stop: one-click stop; user takeover ends agent control immediately.
- background contract: with Cua Driver the agent works on backgrounded target apps without moving the user's cursor or stealing keyboard focus; the `computer` tab viewport is where the user watches that background work happen.
- evidence: the full trace (screenshots, actions, approvals, results) persists with the run and is exportable, so a failed run is diagnosable without asking the user to reproduce.

This makes Computer Use part of the same workbench as preview, review, browser, terminal, and files.

## Implementation Sequence (one epic, all in scope)
1. Replace the Stage target model with the preview-first target shape and migrate all listed call sites.
2. Add the binary-safe workspace preview command with raw-IPC bounded reads and the sandboxed streaming protocol for media.
3. Delete the workspace file preview denylist and route every file through the resolver.
4. Connect doc-engine to Stage for image/PDF-text/data/docx/xlsx/pptx paths; add the pdfjs visual page viewer and the GLB/GLTF/VRM viewer.
5. Merge output/file/browser/artifact preview handling into `StagePreviewPane`; land the CSP changes with the viewers that need them.
6. Add the Computer Use event contract (`family: 'computer'` + event-type extensions + dual-side wire forwarding + harness guards) and the `computer` tab UI against a mocked backend.
7. Bind Cua Driver through Pi's MCP configuration, ship the driver install/health/TCC first-run setup flow, and prove the contract against the real backend.
8. Verify everything in the release `.app` with screenshots and action traces per the matrix below.

Sequencing exists only to order work inside this single delivery; every step above is required for completion.

## Non-Goals
- Do not switch from Tauri to Electron.
- Do not implement a raw mouse/keyboard/screenshot engine from scratch.
- Do not add a separate non-Pi runtime.
- Do not add provider/model catalog UI for Computer Use.
- Do not preserve the old text-only preview as a compatibility mode.
- Do not treat localhost/dev browser screenshots as final desktop verification.

## Verification Matrix (completion gate)
- preview resolver harness for MIME/extension/viewer selection.
- Tauri command harness for workspace sandbox, binary-safe preview reads, and streaming-protocol path validation.
- Computer Use contract harness: event family coverage, dual-side wire forwarding guards, approval/pause semantics.
- renderer typecheck and build; `pnpm validate`; release `.app` build.
- release `.app` screenshot evidence for every viewer kind: text/code, JSON, markdown, image, PDF (visual pages + search), CSV, XLSX, DOCX, PPTX, HTML, video, audio, GLB/GLTF, VRM, diff, unsupported binary.
- release `.app` Computer Use verification: mocked-backend UI pass, then live Cua Driver pass with real daemon install, real TCC grants, real background control of a target app (user cursor untouched), full action trace, approval pause, stop/takeover, and artifact handoff into Stage Preview.
- exported evidence bundle from a real Computer Use run.

## Final Requirement Statement
Stage gains two complete capabilities in one delivery: full multi-format preview (replacing the text-only assumptions) and a first-class Computer Use surface driven by Cua Driver through Pi/MCP. Keep Tauri, keep Stage as the single center surface, and build the prelaunch baseline cleanly — full scope, verified in the release `.app`, with nothing deferred.
