# Offisim Studio 3D Editor + Multi-Company System

## Overview

Two additions to Offisim:

1. **Multi-Company** — remove hardcoded `COMPANY_ID`, add company selection page, support multiple companies per user
2. **Offisim Studio** — standalone 3D editor for office layout, accessible via "Create Your Own" wizard option or from existing company

The existing Runtime interface (3D/2D scene, sidebar, chat, header) is **unchanged**. The wizard's template-based creation flow is **unchanged**.

---

## 1. Multi-Company

### 1.1 Data Model Changes

**No new tables needed.** The `companies` table already exists with `company_id` PK. All entity tables (`employees`, `prefab_instances`, `office_layouts`, etc.) already filter by `company_id`.

**CompanyRepository interface expansion** (currently only has `findById`):

```typescript
export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
  findAll(): Promise<CompanyRow[]>;                          // NEW: company selection page
  create(company: CompanyRow): Promise<CompanyRow>;          // NEW: "Create Your Own" save
  update(companyId: string, fields: Partial<Pick<CompanyRow, 'name' | 'status'>>): Promise<void>;  // NEW: rename etc.
}
```

Update implementations in `memory-repositories.ts` and `drizzle-repositories.ts`.

**COMPANY_ID removal:**
- Remove `COMPANY_ID = 'company-001'` and `THREAD_ID = 'thread-001'` from `packages/ui-office/src/lib/constants.ts`
- Replace with `activeCompanyId` from `CompanyContext`
- Thread ID per company: `thread-${companyId}` (derived, not stored)

**Migration checklist** (files that reference COMPANY_ID):

| Layer | Files | How to get companyId |
|-------|-------|---------------------|
| ui-office hooks | `useCompanyCreation.ts`, `useAgentStates.ts`, `usePrefabInstances.ts`, etc. | `useCompany().activeCompanyId` |
| ui-office components | `CompanyCreationWizard.tsx`, `ChatDrawer.tsx`, etc. | `useCompany().activeCompanyId` |
| apps/web runtime | `AicsRuntimeProvider.tsx`, `initialize-runtime.ts` | prop from App: `<AicsRuntimeProvider companyId={activeCompanyId}>` |
| apps/web lib | `tauri-runtime.ts`, `browser-runtime.ts`, `tauri-repos.ts` | function parameter: `createRuntime(config, eventBus, tauri, companyId)` |
| standalone constants | `useInstallFlow.ts` has its own `const COMPANY_ID` | same pattern — use context or parameter |

### 1.2 Company Selection Page

A dedicated page shown when:
- App launches with multiple companies
- User navigates to company management

**Layout:** Discord-style — left icon bar with company avatars (first letter + color), main area shows selected company info.

**Behavior:**
- Click company icon → enter Runtime for that company (current interface, unchanged)
- Click [+] → open CompanyCreationWizard
- First launch (no companies) → go directly to CompanyCreationWizard

### 1.3 Navigation

Current app uses state-based view switching (`AppView` type in `App.tsx`). No router. Keep this pattern:

```typescript
type AppView = 'office' | 'employee-creator' | 'office-editor' | 'company-select' | 'studio';
```

- `'company-select'` → CompanySelectionPage
- `'studio'` → Studio editor (full-screen)
- Others → existing views (unchanged)

No react-router. State-based is simpler for Tauri desktop.

### 1.4 CompanyContext

```typescript
interface CompanyContextValue {
  activeCompanyId: string | null;  // null = no company selected
  companies: CompanyRow[];
  switchCompany: (id: string) => void;
  refreshCompanies: () => void;
}
```

Provided at app root, above `AicsRuntimeProvider`.

**Company switch lifecycle:** `switchCompany()` sets `activeCompanyId` → `AicsRuntimeProvider` key changes → React unmounts+remounts entire runtime provider → fresh EventBus, fresh data load. This is the safest approach — no manual cleanup needed.

```tsx
// App.tsx
<CompanyProvider>
  <AicsRuntimeProvider key={activeCompanyId} companyId={activeCompanyId}>
    {/* existing app content */}
  </AicsRuntimeProvider>
</CompanyProvider>
```

### 1.5 Wizard Changes

Add one new option to CompanyCreationWizard template list:

- **"Create Your Own"** — icon: wrench/palette — description: "Design your office from scratch in the 3D Studio editor"
- Selecting it → `setView('studio')` with `studioMode: 'create'`
- On save → company is created, prefab instances persisted, redirect to Runtime

Existing template options (Agency Lite, Content Studio, etc.) are unchanged.

---

## 2. Offisim Studio

### 2.1 Identity

Studio is an **independent system**. It has its own components, state management, and scene setup. It does NOT extend or modify Office3DView's edit mode.

The existing editor components (`EditorMode.tsx`, `EditorToolbar.tsx`, `PrefabPalette.tsx`, etc.) remain in place for the lightweight Runtime edit mode. Studio is a full-featured editor that replaces `OfficeEditorOverlay` (the 2D SVG editor) as the primary layout design tool.

**Shared with Runtime:** Only pure rendering components — `Prefab3D`, all `*Mesh3D` components, `useSceneColors()`.

### 2.2 Entry Points

1. **"Create Your Own"** from wizard → blank Studio, no existing data
2. **"Edit Layout"** from Runtime → Studio pre-loaded with company's current prefab instances

### 2.3 UI Layout

```
┌─────────────────────────────────────────────────┐
│  StudioToolbar                                   │
│  [Select][Move][Rotate][Place] | [Grid][Save][←] │
├──────────┬──────────────────────┬───────────────┤
│ Prefab   │                      │ Properties    │
│ Palette  │   R3F Canvas         │ Panel         │
│          │                      │ (选中时显示)   │
│ 6 类别   │   - Grid floor       │               │
│ 可折叠   │   - Prefab3D meshes  │ 名称/类别     │
│          │   - TransformControls│ 位置 XZ       │
│          │   - OrbitControls    │ 旋转          │
│          │   - Ghost preview    │ 删除          │
├──────────┴──────────────────────┴───────────────┤
│  Plot size: [小型20×15][标准40×30][大型60×45][园区80×60] │
└─────────────────────────────────────────────────┘
```

### 2.4 StudioCanvas (R3F Scene)

New file: `packages/ui-office/src/components/studio/StudioCanvas.tsx`

**Scene setup:**
- R3F `<Canvas frameloop="demand">` — static editor scene, only render on change via `invalidate()`
- Neutral ambient + directional light (no dramatic Runtime lighting)
- `<OrbitControls makeDefault />` — drei auto-disables when TransformControls is dragging
- `<Grid infiniteGrid cellSize={0.5} sectionSize={2} fadeDistance={80} />` — drei's Grid component (not GridHelper)
- Plot boundary visualization (glowing wireframe box matching selected plot size)
- `<TransformControls>` — always mounted, controlled via `enabled` prop (never conditionally render — avoids material recompilation on mount/unmount)

**Prefab rendering:**
- Import `Prefab3D` component (same as Runtime)
- Each placed prefab rendered as `<Prefab3D definition={...} position={...} rotation={...} />`

**Performance rules:**
- Never `setState` inside `useFrame` — causes TransformControls flicker. Use `React.memo()` to isolate.
- Ghost preview position via `ref.current.position.copy()`, not React state
- Pre-allocate reusable objects (Raycaster, Vector2, Vector3, Plane) at module scope
- Use `visible` prop to hide/show 3D elements, not conditional rendering

### 2.5 Studio State Management

New file: `packages/ui-office/src/components/studio/StudioState.tsx`

```typescript
type StudioTool = 'select' | 'move' | 'rotate' | 'place';

interface StudioState {
  tool: StudioTool;
  plotSize: PlotSize;
  placingPrefab: PrefabDefinition | null;
  selectedInstanceId: string | null;
  instances: PlacedInstance[];  // local working copy
  dirty: boolean;
}

interface PlacedInstance {
  id: string;
  prefabId: string;
  position: [number, number, number];  // Three.js coords [x, 0, z]
  rotation: 0 | 90 | 180 | 270;       // degrees, 90° steps only
  zoneId: string;
}

interface PlotSize {
  name: string;
  width: number;   // 3D units (X axis)
  depth: number;   // 3D units (Z axis)
}

const PLOT_SIZES: PlotSize[] = [
  { name: '小型工作室', width: 20, depth: 15 },
  { name: '标准办公室', width: 40, depth: 30 },
  { name: '大型办公楼', width: 60, depth: 45 },
  { name: '园区',       width: 80, depth: 60 },
];
```

State management: **Zustand store** (not React Context) — allows `useFrame` callbacks to read state via `getState()` without triggering re-renders. `StudioProvider` wraps the entire Studio UI and initializes the store.

### 2.6 Coordinate Mapping (3D ↔ DB)

DB stores `position_x` and `position_y` (2D). Three.js uses Y-up (XZ is ground plane).

**Convention (consistent with existing Office3DView):**
- `position_x` in DB = Three.js X coordinate
- `position_y` in DB = Three.js Z coordinate
- Three.js Y is always 0 (floor level)

**Load from DB:** `position = [row.position_x, 0, row.position_y]`
**Save to DB:** `position_x = position[0], position_y = position[2]`

### 2.7 Interaction

**Placement:**
- Select prefab from Palette → tool switches to 'place'
- Mouse move over canvas → raycast to floor plane → ghost preview follows cursor (snap to 0.5u grid)
- Left click → place instance, stay in placement mode for quick multi-place
- Right click / ESC → cancel placement
- Prefabs clamped to plot boundary

**Selection:**
- tool === 'select' → click prefab group → `e.stopPropagation()` to prevent event pass-through → select instance
- `onPointerMissed` on Canvas → deselect all (click on empty space)
- Selected instance: TransformControls `enabled={true}` + `object={selectedRef}`
- Unselected: TransformControls `enabled={false}` (stays mounted, no recompilation)
- Delete / Backspace → delete selected

**Move/Rotate tools:**
- tool === 'move' → TransformControls `mode="translate"` + `translationSnap={0.5}` (XZ plane only, Y locked via `showY={false}`)
- tool === 'rotate' → TransformControls `mode="rotate"` + `rotationSnap={Math.PI / 2}` (Y axis only)
- TransformControls `onChange` → `invalidate()` to trigger render in demand mode

**Keyboard shortcuts:**
| Key | Action |
|-----|--------|
| `1` | Select tool |
| `2` | Move tool |
| `3` | Rotate tool |
| `4` | Place tool |
| `R` | Rotate selected +90° |
| `Del` / `Backspace` | Delete selected |
| `ESC` | Cancel placement / deselect |
| `Ctrl+S` / `Cmd+S` | Save |
| `G` | Toggle grid snap |

### 2.8 Save Flow

**Create Your Own (new company):**
1. User clicks Save → prompt for company name (dialog)
2. Generate `company_id` via `crypto.randomUUID()`
3. Create company row: `{ company_id, name, status: 'active', created_at, updated_at, workspace_root: null, default_model_policy_json: null }`
4. Create `office_layouts` row with plot size in `layout_json`
5. Batch create `prefab_instances` rows from Studio state (using coordinate mapping §2.6)
6. `switchCompany(newCompanyId)` → enters Runtime

**Edit existing:**
1. User clicks Save
2. `deleteByCompany(companyId)` → removes all existing prefab instances
3. Batch create new instances from Studio state
4. Update `office_layouts` if plot size changed
5. Navigate back to Runtime view

### 2.9 File Structure

```
packages/ui-office/src/components/studio/
├── StudioCanvas.tsx          # R3F scene (grid, lights, OrbitControls, TransformControls)
├── StudioState.tsx           # StudioProvider context + state + actions
├── StudioToolbar.tsx         # Top toolbar (tool buttons, grid toggle, save, back)
├── StudioPalette.tsx         # Left panel (prefab categories, clickable items)
├── StudioProperties.tsx      # Right panel (selected instance details)
├── StudioGhost.tsx           # Ghost preview during placement (raycast + snap)
├── StudioPlotSelector.tsx    # Bottom bar (plot size buttons)
├── StudioPlacedPrefabs.tsx   # Renders all placed instances + selection highlight
└── StudioPage.tsx            # Full-screen wrapper, composes all above

packages/ui-office/src/components/company/
├── CompanySelectionPage.tsx  # Discord-style company picker
└── CompanyContext.tsx         # CompanyProvider + useCompany hook
```

---

## 3. Plot System

### 3.1 Preset Sizes

| Name | Width × Depth | Capacity | Use Case |
|------|---------------|----------|----------|
| 小型工作室 | 20 × 15 | 1-4人 | 创业车库 |
| 标准办公室 | 40 × 30 | 5-15人 | 默认选择 |
| 大型办公楼 | 60 × 45 | 16-40人 | 多部门 |
| 园区 | 80 × 60 | 40-100人 | 企业总部 |

Template-created companies default to 标准办公室 (40×30).

### 3.2 Visualization

- Grid floor scales to plot size
- Glowing wireframe boundary shows plot edges
- Prefabs cannot be placed outside plot boundary (clamp position)

### 3.3 Storage

Plot size stored in `office_layouts.layout_json` as:
```json
{ "plotSize": { "name": "标准办公室", "width": 40, "depth": 30 } }
```

---

## 4. Scope Boundary

**In scope (this spec):**
- Multi-company: CompanyRepository expansion, CompanyContext, company selection page, wizard "Create Your Own"
- Navigation: add `'company-select'` and `'studio'` to AppView
- Studio: full independent editor system (StudioCanvas, placement, selection, TransformControls, save to DB)
- Plot: preset sizes, boundary visualization, storage
- COMPANY_ID / THREAD_ID removal across all layers

**Out of scope (future):**
- Undo/Redo (command pattern)
- Multi-select / box select / batch operations
- Free-form plot tiling (Minecraft-style)
- Employee placement in Studio (assign to workstation)
- Zone auto-detection from prefab placement
- Studio ↔ Runtime live preview
- Company deletion

---

## 5. Technical Notes (from R3F editor research)

**Verified patterns to follow:**
- `<OrbitControls makeDefault />` + `<TransformControls>` — drei auto-handles conflict
- `<Grid infiniteGrid />` from drei — better than manual GridHelper (fade, sections, infinite)
- `frameloop="demand"` + `invalidate()` — editor scene is static, save CPU/battery
- Click-to-place (not HTML drag-to-canvas) — R3F events work naturally, ghost preview trivial
- Invisible floor `<mesh>` with `visible={false}` for raycast — participates in raycast but doesn't render
- Zustand `getState()` in `useFrame` — no re-render triggered

**Known pitfalls to avoid:**
- Never `setState` in `useFrame` — causes TransformControls flicker (drei #2226)
- Never conditionally render `<TransformControls>` — use `enabled` prop to toggle
- Never create `new Vector3/Matrix4` in `useFrame` — pre-allocate at module scope
- `e.stopPropagation()` in R3F stops event pass-through to objects behind (not just DOM bubble)
- `InstancedMesh` events broken in R3F (#3084) — avoid for selectable objects
- TransformControls `translationSnap` is absolute (snaps to world grid), not relative

**Dependencies confirmed compatible:**
- three.js 0.183.2 + drei 10.x — post-v0.169 TransformControls breaking change, drei handles it
- `<Grid>` component available in drei 9.88+
