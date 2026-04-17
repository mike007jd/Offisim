# office-editor-boundaries Specification

## Purpose

`OfficeEditorOverlay` 的职责边界规范——overlay 不再是单文件 950 行 god-component，而是一个 ≤ 200 行的薄 composition shell，仅负责接 `{ open, onClose }` props、调用 4 个 composition hook、拼装 6 个 render-only section component、协调 save-before-close 生命周期。zone preset palette / drag-to-reposition / pan-zoom viewport / required-archetype 守卫 / validation 派生 / save lifecycle 各自落到独立 hook 与 section 模块，单一职责、互不交叉。Section component 是纯 render-only：props in / JSX out，禁止 useState / useRef / useEffect；hook 之间禁止互相 import，跨 hook 数据流由 barrel 显式 props 串联。Public consumer API（import 路径 + props 形状）严格不变，refactor 对调用方零感知。

## Requirements

### Requirement: OfficeEditorOverlay is a thin composition shell

`packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` SHALL contain no more than 200 non-blank, non-comment lines and SHALL only: (a) accept `{ open, onClose }` props, (b) call the 4 composition hooks (`useZoneEditorState` / `useDragReposition` / `useZonePanZoom` / `useZoneValidation`), (c) render the 6 section components (`EditorToolbar` / `PresetPalette` / `ZoneCanvas` / `ZoneInspector` / `StatusBar` / `ValidationBanner`) with props derived from the hooks, (d) orchestrate save-before-close. Inline useState / useRef beyond the `open` reflection SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 200

#### Scenario: No inline state
- **WHEN** grepping `OfficeEditorOverlay.tsx` for `useState\(` or `useRef\(`
- **THEN** at most one match exists (the optional dialog-open ref reflection); all editor state lives in `editor/hooks/*`

### Requirement: Editor section components are render-only

Each of `EditorToolbar` / `PresetPalette` / `ZoneCanvas` / `ZoneInspector` / `StatusBar` / `ValidationBanner` SHALL live in `packages/ui-office/src/components/office/editor/` and SHALL be a render-only component — props in, JSX out, no `useState` / `useRef` / `useEffect`. Section components SHALL NOT import sibling section components; the barrel composes them.

#### Scenario: One file per section
- **WHEN** listing `packages/ui-office/src/components/office/editor/` for `*.tsx` files
- **THEN** exactly these 6 files exist: `EditorToolbar.tsx`, `PresetPalette.tsx`, `ZoneCanvas.tsx`, `ZoneInspector.tsx`, `StatusBar.tsx`, `ValidationBanner.tsx`

#### Scenario: Sections contain no state hooks
- **WHEN** grepping any section component for `useState\(` / `useRef\(` / `useEffect\(`
- **THEN** zero matches exist

### Requirement: Editor composition hooks are single-responsibility

Each of the 4 hooks SHALL live in `packages/ui-office/src/components/office/editor/hooks/` with one file per hook and SHALL export the hook by name. Hook responsibilities:

- `useZoneEditorState` — editor zones / placed items / dirty flag / save orchestration
- `useDragReposition` — drag source/target coordinate translation + obstacle snap + overlap detection
- `useZonePanZoom` — viewport transform (zoom / pan / reset / center-preserving scale)
- `useZoneValidation` — derived errors (required archetype missing / overlap / bounds violation)

A hook SHALL NOT import another hook from the same directory; cross-hook data flow SHALL be threaded through the barrel as explicit props.

#### Scenario: One file per hook
- **WHEN** listing `packages/ui-office/src/components/office/editor/hooks/` for `*.ts` files
- **THEN** exactly these 4 files exist: `useZoneEditorState.ts`, `useDragReposition.ts`, `useZonePanZoom.ts`, `useZoneValidation.ts`

#### Scenario: No cross-hook imports
- **WHEN** grepping `editor/hooks/*.ts` for `from '\\.\\/(useZoneEditorState|useDragReposition|useZonePanZoom|useZoneValidation)'`
- **THEN** zero matches exist

### Requirement: Observable editor behavior is unchanged after refactor

Opening the overlay, adding / dragging / deleting a zone preset, triggering overlap / required-missing validation, saving, and closing SHALL produce byte-identical visible UI and persisted state before and after the refactor.

#### Scenario: Open → add preset → save → reopen round-trip
- **WHEN** the user opens the overlay, drags the `rest-lounge` preset onto the canvas, clicks Save, closes, and reopens
- **THEN** the persisted zone set reflects the new preset in the same location as pre-refactor, and reopening renders identical layout

#### Scenario: Required archetype deletion guard
- **WHEN** the user attempts to delete a zone whose archetype is required (e.g. `meeting`)
- **THEN** deletion is prevented and `ValidationBanner` shows the same guard text as pre-refactor

#### Scenario: Overlap banner updates live during drag
- **WHEN** the user drags a zone into overlap with another
- **THEN** `ValidationBanner` shows the overlap error at the same frame as pre-refactor (React re-render driven)

### Requirement: Public consumer API is unchanged

`OfficeEditorOverlay` SHALL continue to be exported from its original module path and SHALL accept the same `{ open: boolean; onClose: () => void }` props. No consumer import SHALL need modification.

#### Scenario: Consumer import unchanged
- **WHEN** comparing `grep -rn "from '.*OfficeEditorOverlay'"` pre-change vs post-change
- **THEN** every import path and every prop binding is byte-identical
