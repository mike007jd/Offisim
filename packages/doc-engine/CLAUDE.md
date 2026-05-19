# @offisim/doc-engine

Document export + import. Two halves:

- `src/` exporters (csv / docx / html / pdf / pptx / txt) — generate documents from runtime deliverables.
- `src/import/` parsers (pdf / docx / xlsx / pptx / text / image) — decode user-attached files into `ParsedAttachment` (discriminated union from `@offisim/shared-types`).

## Importer module (`src/import/`)

- Single entry: `parseAttachment(bytes: Uint8Array, mimeType: string, filename: string): Promise<ParsedAttachment>`.
- All parser exceptions funnel into `{ kind: 'unsupported', reason }` — never throws into the runtime / composer.
- `kind === 'binary'` is the catch-all (base64 + nothing structured); `kind === 'unsupported'` is the failure path with a human-readable reason.
- Cross-runtime (Node + browser + Tauri webview): no DOM-only globals at module top level; image dimensions parsed from binary headers in Node so harness fixtures don't need JSDOM.
- Internal relative imports use `.js` extensions explicitly so the dist subtree is directly Node-importable from the harness; the existing exporter subtree (which uses bundler-style extensionless imports) is not Node-import-safe and the harness must NOT pull through `dist/index.js` — go through `dist/import/index.js` instead.

## PDF worker bundling (cross-platform)

- pdfjs-dist 4.x ESM lives at `pdfjs-dist/legacy/build/pdf.mjs` (cross-runtime entry).
- Worker file `pdf.worker.min.mjs` MUST be copied into `apps/desktop/renderer/public/` so it serves at `/pdf.worker.min.mjs`. The Tauri release `.app` loads the same web bundle from `tauri://localhost/`, so no separate desktop copy is required for v1.
- Copy step: `scripts/copy-pdf-worker.mjs`, wired into `apps/desktop/renderer` `prebuild` (and `predev`). Bumping the pdfjs-dist version automatically refreshes the bundled worker on next build/dev start — no version-locked check-in.
- `import/worker-resolver.ts` returns `'/pdf.worker.min.mjs'` in browser/webview, `null` in Node (which lets pdfjs fall back to its fakeWorker — slower but safe for tests).

## Fixtures + harness

- Fixtures live under `harness/fixtures/`. Re-generate via `node packages/doc-engine/harness/generate-fixtures.mjs`. The generator uses the same exporters that ship in production so fixture bytes track real-world output across Office-tools version bumps.
- Scenarios in `harness/scenarios.json` assert structural invariants only (page count, sheet names, image dimensions, etc.) — not byte-for-byte text. Encoder drift on the generator side won't break the harness as long as the parser still extracts the right structure.
- Run via root: `pnpm harness:doc-engine`. CI / verification gates should run this alongside the deterministic-runtime harness.
- Per CLAUDE.md "deterministic harness 反自证规则": no `finalOutputContains`-style self-attestation. Each scenario asserts properties that can only hold if the parser actually decoded the bytes (e.g., `pages.length === 12`, `sheets[0].name === 'Scores'`).

## DOCX gotcha

`mammoth` accepts `{ buffer }` (Node) or `{ arrayBuffer }` (browser). Passing the wrong shape returns `Could not find file in options`. The importer probes `typeof Buffer` and feeds whichever the runtime supports.

## Out-of-scope (v1)

- OCR over images — image attachments return base64 + dimensions only; vision-capable LLMs ingest from there.
- Streaming partial reads — 8 MB cap is enforced upstream (Tauri Rust + IDB store), one-shot parse beats streaming overhead at that ceiling.
