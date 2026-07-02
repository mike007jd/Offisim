# Stage Preview + Computer Use PRD

## Current Time Baseline
- Checked at: 2026-07-02 19:27 NZST.
- Scope: Offisim desktop Stage center panel, file/artifact/browser preview, and Computer Use integration.
- Status: production-stage requirement document for prelaunch Offisim.

## One Sentence Decision
Keep Tauri, rebuild Stage into a strong multi-format preview workbench, and integrate Computer Use as a Pi/MCP-driven capability with first-class UI, permissions, screenshots, action trace, and results.

## Product Context
Offisim is still prelaunch. There are no real users, no production data, and no historical compatibility contracts. This work should replace weak preview assumptions directly, not add compatibility or migration layers around them.

Current Stage limitations are self-imposed, not caused by Tauri:

- `file` preview is text-only and capped through a UTF-8 preview path.
- `preview` mostly means browser iframe or screenshot.
- image/PDF/media/3D files are blocked from inline preview in the workspace panel.
- existing `doc-engine` already knows how to parse PDF, DOCX, XLSX, PPTX, image, text, data, and code, but Stage does not use it as a viewer system.

Tauri should stay. The fix is a stronger Stage preview architecture plus a proper Computer Use integration boundary.

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

Product implication: Offisim should not invent a raw desktop-control engine. It should provide a Computer Use host surface and adapter boundary, then bind to Pi/MCP/OpenAI/trycua/open-computer-use style backends.

## Product Goals
1. Make the center Stage useful for real work artifacts.
2. Make preview support at least competitive with Codex-style file previews.
3. Make Computer Use a first-class Offisim workflow, not an afterthought.
4. Preserve Pi Agent as the only AI runtime owner.
5. Avoid compatibility or migration debt from the old text-only preview model.

## Stage Preview Requirements
Replace the current coarse `file` / `preview` split with a unified preview resolver.

Required target model:

- source: workspace file, artifact/deliverable, browser output, screenshot, generated output, or Computer Use artifact.
- metadata: path, URL, title, MIME, extension, byte size, modified time, source run/thread, trust level.
- viewer kind: text, code, json, markdown, image, pdf, html, csv, spreadsheet, doc, slides, video, audio, 3d, diff, logs, browser, screenshot, unsupported.
- actions: open externally, reveal in Finder, copy path, copy URL, open logs, open thread, download/export where applicable.

Stage routing should move to a preview-first shape:

- primary tabs should become game / preview / computer / terminal / review, or an equivalent structure where files and outputs are preview sources instead of separate product tabs.
- `StageViewTarget` should be replaced, not compatibility-wrapped, because Offisim is prelaunch.
- output, workspace file, browser screenshot, generated HTML, artifact, and Computer Use artifact should all resolve through the same preview target model.
- `OutputView`, `FileView`, and `PreviewView` should converge into a `StagePreviewPane` with viewer components.

Representative shape:

- `ResolvedPreviewTarget.source`: workspace-file, deliverable, browser, screenshot, generated-output, computer-artifact.
- `ResolvedPreviewTarget.viewerKind`: text, code, json, markdown, image, pdf, html, csv, spreadsheet, doc, slides, video, audio, 3d, diff, logs, browser, screenshot, unsupported.
- `ResolvedPreviewTarget.trustLevel`: workspace, generated, external, computer.

Required viewers:

- text/code/log: large-file-aware, monospaced, search, line numbers, truncation state.
- json/yaml/toml/xml: formatted structure view with raw toggle.
- markdown: rendered view plus raw toggle.
- image: PNG, JPEG, GIF, WebP, SVG; zoom/pan/fit/actual size; metadata.
- PDF: page viewer, thumbnails or page list, zoom, text extraction/search when available.
- CSV/table: virtualized table, column headers, raw toggle.
- XLSX: sheet tabs, bounded rows, cell preview.
- DOCX/PPTX: structured readable preview using existing doc-engine output.
- HTML: sandboxed `srcDoc` for trusted generated outputs and iframe for allowed local URLs.
- video/audio: native media element with metadata.
- 3D: GLB/GLTF/VRM viewer using existing Three stack, OrbitControls, lighting, reset camera.
- unsupported/binary: clear reason plus external-open/reveal actions.

Implementation direction:

- introduce a binary-safe workspace preview command, not only UTF-8 text preview.
- use MIME sniffing plus extension fallback.
- create safe blob/object URLs inside renderer for binary preview.
- reuse existing `doc-engine` parsers where possible.
- keep workspace sandbox boundaries through Tauri commands.
- remove the hard-coded "image/pdf/media cannot preview inline" behavior.
- delete the workspace panel's non-text extension denylist; every file should enter the resolver, and unsupported/binary should be a normal viewer state with actions.

The Tauri preview command should return metadata plus either bounded text or bounded bytes, while preserving the existing workspace-root/canonicalization/sandbox guarantees:

- path.
- file name.
- MIME type if known.
- extension.
- byte length.
- modified time.
- truncated flag.
- text when safe and useful.
- bytes/base64 or a temporary safe blob path/reference for binary preview.
- resolver hint.

## Computer Use Requirements
Computer Use is required, but Offisim should integrate it through a driver boundary.

Offisim responsibilities:

- show Computer Use task state in Stage.
- show target app/window/browser context.
- show live screenshot or latest screenshot.
- show action trace: click, type, key, scroll, wait, screenshot, observe.
- show permission/approval prompts.
- show sensitive-action pauses.
- show result artifacts and logs.
- let user stop/take over.
- persist run trace as inspectable evidence.

Pi/MCP responsibilities:

- own the AI model/tool loop.
- own provider auth and model selection.
- call the Computer Use backend as a tool/MCP capability.
- emit structured events back to Offisim.

Backend adapter candidates:

- OpenAI Computer Use / Codex-like adapter for official CUA semantics.
- `trycua/cua` adapter for sandbox/driver infrastructure.
- `QwenLM/open-computer-use` adapter for MCP-based desktop control.
- browser-only adapter using Browser Use / Skyvern / Midscene when the target is web-only.

Offisim must not become a second AI runtime or provider catalog. Computer Use is a tool capability surfaced by Pi and visualized by Offisim.

Computer Use needs explicit event semantics, not generic MCP audit rows only. Add a dedicated event family such as:

- `computer.task.started`
- `computer.target.selected`
- `computer.screenshot`
- `computer.observe`
- `computer.action`
- `computer.approval.requested`
- `computer.sensitive.pause`
- `computer.artifact.created`
- `computer.task.completed`
- `computer.task.failed`

Each action event should carry action kind, target app/window/url, optional screenshot, optional coordinates, safe text preview, result state, and artifact references. This is what lets the Stage render viewport, timeline, approvals, and handoff without parsing backend-specific logs.

Approval should reuse the existing UI approval bridge where possible, but Computer Use needs explicit semantics for target app, screen-recording/accessibility setup, sensitive action pause, external navigation, download, and credential/secret blocked states.

## Codex-Aligned Behavior
Codex's current product pattern should be copied at the product level:

- install/enable Computer Use capability explicitly.
- require OS-level Screen Recording / Accessibility where needed.
- require target app/window permission.
- prefer structured plugin/MCP integration when available.
- use visual Computer Use only when structured access is insufficient.
- keep tasks narrow and target-specific.
- show screenshots/actions/logs as inspectable trace.
- pause for sensitive or disruptive actions.
- do not automate admin authentication, security/privacy permission prompts, or protected secrets flows.

## Stage Integration
Computer Use should appear as a Stage view:

- primary tab: `Computer` or equivalent.
- task header: target app/window, status, elapsed time, controlling employee/run.
- live viewport: screenshot stream or latest screenshot.
- action timeline: every observe/action/result.
- approvals: inline blocking panel.
- artifacts: screenshots, files, browser URLs, logs, output.
- handoff: open produced files in Stage Preview, not in a separate viewer.

This makes Computer Use part of the same workbench as preview, review, browser, terminal, and files.

## Implementation Sequence
1. Replace the Stage target model with the preview-first target shape.
2. Add the binary-safe workspace preview command.
3. Remove workspace file preview denylist and route every file through the resolver.
4. Connect `doc-engine` to Stage for image/PDF/text/data/docx/xlsx/pptx preview paths.
5. Merge output/file/browser/artifact preview handling into `StagePreviewPane`.
6. Add Computer Use event contract and mocked backend UI.
7. Connect a Pi/MCP Computer Use adapter after the UI and event contract are proven.
8. Verify in release `.app` with screenshots and action traces.

## Non-Goals
- Do not switch from Tauri to Electron.
- Do not implement a raw mouse/keyboard/screenshot engine from scratch.
- Do not add a separate non-Pi runtime.
- Do not add provider/model catalog UI for Computer Use.
- Do not preserve the old text-only preview as a compatibility mode.
- Do not treat localhost/dev browser screenshots as final desktop verification.

## Verification Plan
- preview resolver harness for MIME/extension/viewer selection.
- Tauri command harness for workspace sandbox and binary-safe preview reads.
- renderer typecheck and build.
- `pnpm validate`.
- release `.app` build.
- Computer Use adapter contract harness with mocked screenshots/actions.
- release `.app` Computer Use UI verification with a mocked backend first.
- later live backend verification with a selected backend after credentials/permissions are installed.
- screenshot evidence for image, PDF, JSON, CSV/XLSX, HTML, video, GLB/GLTF, unsupported binary, and Computer Use trace.

## Final Requirement Statement
Offisim's center Stage must become a production-grade workbench: strong multi-format preview, browser/output/file/review continuity, and a first-class Computer Use surface driven by Pi/MCP backends. Keep Tauri, remove the weak text-only assumptions, and build the prelaunch baseline cleanly instead of layering compatibility around the old implementation.
