# Plan B: Doc Engine + Pitch Hall Multi-Format Export

> **For agentic workers:** Use superpowers:executing-plans to implement. Steps use checkbox syntax for tracking.
> **File ownership:** This plan touches `packages/doc-engine/` (new), `packages/ui-office/src/components/pitch/`, `packages/ui-office/src/hooks/useDeliverables.ts`, and root `pnpm-workspace.yaml`. Does NOT touch apps/platform, apps/market, packages/renderer, or packages/core/src/graph/.

**Goal:** Create the `packages/doc-engine` package (specified in TechStack v1.5 but never built) and upgrade PitchHall from .txt-only to DOCX/PDF/PPTX/CSV/HTML export.

**Why this matters:** PRD 5 acceptance criteria: "能够从一句自然语言指令走到正式产出下载". Users expect DOCX/PDF, not plain text. This is a product credibility blocker.

**Tech Stack:** docx (npm), pptxgenjs, pdf-lib, SheetJS (xlsx), TypeScript

---

## Task 1: Create packages/doc-engine Package

**Files:**
- Create: `packages/doc-engine/package.json`
- Create: `packages/doc-engine/tsconfig.json`
- Create: `packages/doc-engine/src/index.ts`
- Create: `packages/doc-engine/src/types.ts`
- Create: `packages/doc-engine/src/docx-exporter.ts`
- Create: `packages/doc-engine/src/pdf-exporter.ts`
- Create: `packages/doc-engine/src/pptx-exporter.ts`
- Create: `packages/doc-engine/src/csv-exporter.ts`
- Create: `packages/doc-engine/src/html-exporter.ts`
- Create: `packages/doc-engine/src/__tests__/`

**Spec:**

Package structure follows existing pattern (reference: packages/install-core/package.json):
```json
{
  "name": "@aics/doc-engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "dependencies": {
    "docx": "^9.0.0",
    "pptxgenjs": "^3.12.0",
    "pdf-lib": "^1.17.0",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  }
}
```

Core API:
```typescript
// types.ts
export interface ExportableDocument {
  title: string;
  content: string;                    // markdown or plain text
  contributors: { name: string }[];
  createdAt: number;
  metadata?: Record<string, string>;
}

export type ExportFormat = 'docx' | 'pdf' | 'pptx' | 'csv' | 'html' | 'txt';

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

// index.ts
export async function exportDocument(doc: ExportableDocument, format: ExportFormat): Promise<ExportResult>;
```

Each exporter must:
- Accept `ExportableDocument` as input
- Return `ExportResult` with proper MIME type
- Handle markdown content (split by headers for PPTX slides, paragraphs for DOCX)
- Include title page with contributors and date
- Work in browser environment (no Node.js-only APIs)

- [ ] Step 1: Create package scaffolding (package.json, tsconfig.json, types.ts)
- [ ] Step 2: Implement docx-exporter (title page + content paragraphs + contributor footer)
- [ ] Step 3: Implement pdf-exporter using pdf-lib (title + content + page numbers)
- [ ] Step 4: Implement pptx-exporter (title slide + content slides split by ## headers)
- [ ] Step 5: Implement csv-exporter (structured data extraction from content)
- [ ] Step 6: Implement html-exporter (styled HTML with inline CSS)
- [ ] Step 7: Create barrel index.ts with exportDocument() dispatcher
- [ ] Step 8: `pnpm install` to update lockfile
- [ ] Step 9: Tests for each exporter (valid input → correct blob type/size)
- [ ] Step 10: Commit

---

## Task 2: Upgrade PitchHall Component

**Files:**
- Modify: `packages/ui-office/src/components/pitch/PitchHall.tsx` (123 lines)
- Modify: `packages/ui-office/package.json` (add @aics/doc-engine dep)

**Spec:**

Current PitchHall (line 41-51) uses `new Blob([content], { type: 'text/plain' })` for .txt download only.

Upgrade:
- Add format selector dropdown (default: DOCX) with options: DOCX, PDF, PPTX, CSV, HTML, TXT
- Import `exportDocument` from `@aics/doc-engine`
- Replace the handleDownload callback:
  ```typescript
  const handleDownload = useCallback(async () => {
    const doc: ExportableDocument = {
      title: item.title,
      content: item.content,
      contributors: item.contributingEmployees.map(e => ({ name: e.employeeName })),
      createdAt: item.createdAt,
    };
    const result = await exportDocument(doc, selectedFormat);
    // trigger browser download using result.blob + result.filename
  }, [item, selectedFormat]);
  ```
- Keep the existing .txt path as a fallback (TXT format in the selector)
- Show loading spinner during export (DOCX/PDF generation can take a moment)
- Format selector uses shadcn/ui Select component (already available in ui-core)

- [ ] Step 1: Add @aics/doc-engine as workspace dependency to ui-office
- [ ] Step 2: Add format selector state and UI to PitchHall
- [ ] Step 3: Replace handleDownload with exportDocument() call
- [ ] Step 4: Add loading state during export
- [ ] Step 5: Commit

---

## Verification

- [ ] `pnpm run build` passes for packages/doc-engine
- [ ] `pnpm run test` passes for packages/doc-engine
- [ ] `pnpm run typecheck` passes for packages/doc-engine and packages/ui-office
- [ ] `pnpm run build` passes for packages/ui-office
- [ ] Manual test: create a deliverable in the runtime → export as DOCX → verify the file opens correctly
- [ ] Each format produces a valid, non-empty file with title, content, and contributors
