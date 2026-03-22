# Offisim Studio 3D Editor + Multi-Company Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-company support and a standalone 3D layout editor (Offisim Studio) to the Offisim runtime.

**Architecture:** Two subsystems — (1) Multi-Company replaces hardcoded `COMPANY_ID` with `CompanyContext`, adds company selection page and `CompanyRepository.create/findAll`; (2) Studio is an independent full-screen 3D editor using Zustand for state, drei `<Grid>`, `<TransformControls>`, `<OrbitControls makeDefault>`, with `frameloop="demand"` for performance. Studio shares only `Prefab3D` rendering components with Runtime.

**Tech Stack:** React 19, Three.js 0.183, @react-three/fiber 9.5, @react-three/drei (Grid, TransformControls, OrbitControls), Zustand (new dep), Drizzle ORM (SQLite)

**Spec:** `Docs/superpowers/specs/2026-03-22-studio-multicompany-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/ui-office/src/components/company/CompanyContext.tsx` | CompanyProvider + useCompany hook |
| `packages/ui-office/src/components/company/CompanySelectionPage.tsx` | Discord-style company picker page |
| `packages/ui-office/src/components/studio/StudioState.tsx` | Zustand store: tools, instances, plot, dirty |
| `packages/ui-office/src/components/studio/StudioCanvas.tsx` | R3F Canvas: grid, lights, orbit, transform |
| `packages/ui-office/src/components/studio/StudioPalette.tsx` | Left panel: prefab categories |
| `packages/ui-office/src/components/studio/StudioGhost.tsx` | Ghost preview during placement |
| `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx` | Render placed instances + selection |
| `packages/ui-office/src/components/studio/StudioProperties.tsx` | Right panel: selected instance details |
| `packages/ui-office/src/components/studio/StudioToolbar.tsx` | Top toolbar: tool buttons, save, back |
| `packages/ui-office/src/components/studio/StudioPlotSelector.tsx` | Bottom bar: plot size buttons |
| `packages/ui-office/src/components/studio/StudioPage.tsx` | Full-screen wrapper, composes all above |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/core/src/runtime/repositories.ts` | Expand `CompanyRepository` interface (+create, findAll, update) |
| `packages/core/src/runtime/memory-repositories.ts` | Implement new CompanyRepository methods |
| `packages/core/src/runtime/drizzle-repositories.ts` | Implement new CompanyRepository methods |
| `packages/ui-office/src/lib/constants.ts` | Remove COMPANY_ID and THREAD_ID |
| `packages/ui-office/src/hooks/useCompanyCreation.ts` | Accept companyId param instead of constant |
| `packages/ui-office/src/hooks/usePrefabInstances.ts` | Use companyId from context |
| `packages/ui-office/src/components/onboarding/CompanyCreationWizard.tsx` | Add "Create Your Own" template option |
| `apps/web/src/runtime/AicsRuntimeProvider.tsx` | Accept companyId prop, pass to NotificationBridge |
| `apps/web/src/App.tsx` | Add AppView states, CompanyProvider wrapper, view routing |
| `packages/ui-office/package.json` | Add zustand dependency |

---

## Task 1: Install Zustand + Expand CompanyRepository

**Files:**
- Modify: `packages/ui-office/package.json`
- Modify: `packages/core/src/runtime/repositories.ts:141-143`
- Modify: `packages/core/src/runtime/memory-repositories.ts`
- Modify: `packages/core/src/runtime/drizzle-repositories.ts`
- Test: `packages/core/src/__tests__/unit/` (existing test files)

- [ ] **Step 1: Install zustand**

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
pnpm --filter @aics/ui-office add zustand
```

- [ ] **Step 2: Expand CompanyRepository interface**

In `packages/core/src/runtime/repositories.ts`, replace the CompanyRepository interface (lines 141-143):

```typescript
export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
  findAll(): Promise<CompanyRow[]>;
  create(company: CompanyRow): Promise<CompanyRow>;
  update(
    companyId: string,
    fields: Partial<Pick<CompanyRow, 'name' | 'status'>>,
  ): Promise<void>;
}
```

- [ ] **Step 3: Implement memory CompanyRepository**

In `packages/core/src/runtime/memory-repositories.ts`, find the existing `companies` object and add the new methods:

```typescript
const companies: RuntimeRepositories['companies'] = {
  // existing findById stays
  async findById(companyId) { /* existing */ },
  async findAll() {
    return [...companyStore.values()];
  },
  async create(company) {
    companyStore.set(company.company_id, company);
    return company;
  },
  async update(companyId, fields) {
    const existing = companyStore.get(companyId);
    if (existing) {
      companyStore.set(companyId, { ...existing, ...fields, updated_at: new Date().toISOString() });
    }
  },
};
```

Note: Find the actual Map variable name — it may be named differently. Search for `findById(companyId)` in the file to locate the implementation.

- [ ] **Step 4: Implement Drizzle CompanyRepository**

In `packages/core/src/runtime/drizzle-repositories.ts`, find the existing `companies` object and add:

```typescript
async findAll() {
  return db.select().from(schema.companies).all() as CompanyRow[];
},
async create(company) {
  db.insert(schema.companies).values(company).run();
  return company;
},
async update(companyId, fields) {
  db.update(schema.companies)
    .set({ ...fields, updated_at: new Date().toISOString() })
    .where(eq(schema.companies.company_id, companyId))
    .run();
},
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @aics/core typecheck
```

Expected: PASS (no type errors)

- [ ] **Step 6: Run existing tests**

```bash
pnpm --filter @aics/core test
```

Expected: All 472 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/runtime/repositories.ts packages/core/src/runtime/memory-repositories.ts packages/core/src/runtime/drizzle-repositories.ts packages/ui-office/package.json pnpm-lock.yaml
git commit -m "feat: expand CompanyRepository with create/findAll/update, add zustand"
```

---

## Task 2: CompanyContext + CompanyProvider

**Files:**
- Create: `packages/ui-office/src/components/company/CompanyContext.tsx`
- Test: manual (context is wired in Task 10)

- [ ] **Step 1: Create CompanyContext**

```typescript
// packages/ui-office/src/components/company/CompanyContext.tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CompanyRow, RuntimeRepositories } from '@aics/core';

interface CompanyContextValue {
  activeCompanyId: string | null;
  companies: CompanyRow[];
  switchCompany: (id: string) => void;
  refreshCompanies: () => void;
}

const CompanyCtx = createContext<CompanyContextValue | null>(null);

interface CompanyProviderProps {
  repos: RuntimeRepositories | null;
  children: ReactNode;
}

export function CompanyProvider({ repos, children }: CompanyProviderProps) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  const refreshCompanies = useCallback(async () => {
    if (!repos) return;
    const all = await repos.companies.findAll();
    setCompanies(all);
    // Auto-select first company if none selected
    setActiveCompanyId((prev) => (prev == null && all.length > 0) ? all[0].company_id : prev);
  }, [repos]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const switchCompany = useCallback((id: string) => {
    setActiveCompanyId(id);
  }, []);

  return (
    <CompanyCtx.Provider value={{ activeCompanyId, companies, switchCompany, refreshCompanies }}>
      {children}
    </CompanyCtx.Provider>
  );
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyCtx);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}
```

- [ ] **Step 2: Export from ui-office index**

Add to `packages/ui-office/src/index.ts` (or wherever the package exports components):

```typescript
export { CompanyProvider, useCompany } from './components/company/CompanyContext.js';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui-office/src/components/company/CompanyContext.tsx
git commit -m "feat: add CompanyContext and CompanyProvider"
```

---

## Task 3: Remove COMPANY_ID Hardcode

This is a mechanical migration. Replace all imports of `COMPANY_ID` / `THREAD_ID` with `useCompany().activeCompanyId` or function parameters.

**Files:**
- Modify: `packages/ui-office/src/lib/constants.ts` (remove COMPANY_ID, THREAD_ID)
- Modify: `packages/ui-office/src/hooks/useCompanyCreation.ts`
- Modify: `packages/ui-office/src/hooks/usePrefabInstances.ts`
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx`
- Modify: All other files importing COMPANY_ID (find with grep)

- [ ] **Step 1: Find all COMPANY_ID references**

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
grep -rn "COMPANY_ID\|THREAD_ID" --include="*.ts" --include="*.tsx" packages/ apps/
```

Document every file and line. The migration checklist from the spec lists the layers:
- ui-office hooks → `useCompany().activeCompanyId`
- ui-office components → `useCompany().activeCompanyId`
- apps/web runtime → prop: `companyId`
- apps/web lib → function parameter

- [ ] **Step 2: Update constants.ts**

Remove `COMPANY_ID` and `THREAD_ID` from `packages/ui-office/src/lib/constants.ts`. If other constants remain, keep the file. If empty, delete it and update all imports.

- [ ] **Step 3: Update AicsRuntimeProvider**

In `apps/web/src/runtime/AicsRuntimeProvider.tsx`:
- Add `companyId: string` to Props interface
- Replace `COMPANY_ID` usage at line 47 (NotificationBridge) with `companyId` prop
- Remove the COMPANY_ID import

```typescript
interface Props {
  companyId: string;
  children: ReactNode;
}

export function AicsRuntimeProvider({ companyId, children }: Props) {
  // ... existing code ...
  // Line ~47: new NotificationBridge(eventBusRef.current, companyId);
}
```

- [ ] **Step 4: Update useCompanyCreation**

In `packages/ui-office/src/hooks/useCompanyCreation.ts`:
- Remove COMPANY_ID import
- Accept `companyId` as parameter or get from `useCompany()`
- Replace lines 39 and 65 where COMPANY_ID is used

```typescript
export function useCompanyCreation(): UseCompanyCreationReturn {
  const { activeCompanyId } = useCompany();
  // ... replace COMPANY_ID with activeCompanyId at lines 39, 65
}
```

Note: For the creation case (no company exists yet), the wizard creates a new companyId via `crypto.randomUUID()`. The hook needs to handle both cases.

- [ ] **Step 5: Update usePrefabInstances**

In `packages/ui-office/src/hooks/usePrefabInstances.ts`:
- Use `useCompany().activeCompanyId` instead of imported COMPANY_ID

- [ ] **Step 6: Update all remaining files**

For every file found in Step 1, apply the appropriate pattern from the migration checklist.

- [ ] **Step 7: Typecheck all packages**

```bash
pnpm typecheck
```

Expected: All 28 packages pass.

- [ ] **Step 8: Run tests**

```bash
pnpm --filter @aics/core test
pnpm --filter @aics/ui-office test 2>/dev/null || echo "ui-office has no test script"
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove hardcoded COMPANY_ID, parameterize with CompanyContext"
```

---

## Task 4: Company Selection Page

**Files:**
- Create: `packages/ui-office/src/components/company/CompanySelectionPage.tsx`

- [ ] **Step 1: Create CompanySelectionPage**

Discord-style layout: left icon bar with company avatars, main area shows selected company preview.

```typescript
// packages/ui-office/src/components/company/CompanySelectionPage.tsx
import { useCompany } from './CompanyContext.js';
import type { CompanyRow } from '@aics/core';

interface CompanySelectionPageProps {
  onSelectCompany: (companyId: string) => void;
  onCreateNew: () => void;
}

export function CompanySelectionPage({ onSelectCompany, onCreateNew }: CompanySelectionPageProps) {
  const { companies } = useCompany();

  // Color assignment by index
  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f0f1a' }}>
      {/* Left icon bar */}
      <div style={{
        width: 64, background: '#16162a', borderRight: '1px solid #222',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '16px 0', gap: 12,
      }}>
        {companies.map((c, i) => (
          <button
            key={c.company_id}
            onClick={() => onSelectCompany(c.company_id)}
            style={{
              width: 44, height: 44,
              background: COLORS[i % COLORS.length],
              borderRadius: 12, border: 'none', cursor: 'pointer',
              color: 'white', fontWeight: 700, fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title={c.name}
          >
            {c.name.charAt(0).toUpperCase()}
          </button>
        ))}

        {/* Add button */}
        <button
          onClick={onCreateNew}
          style={{
            width: 44, height: 44,
            background: 'transparent', border: '2px dashed #444',
            borderRadius: 12, cursor: 'pointer',
            color: '#666', fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Create new company"
        >
          +
        </button>
      </div>

      {/* Main area */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
      }}>
        <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 600 }}>OFFISIM</h1>
        <p style={{ color: '#888', fontSize: 14 }}>
          {companies.length === 0
            ? 'No companies yet. Create your first one!'
            : 'Select a company to enter, or create a new one.'}
        </p>
        {companies.length === 0 && (
          <button
            onClick={onCreateNew}
            style={{
              padding: '12px 24px', background: '#6366f1', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
            }}
          >
            Create Your First Company
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from ui-office**

```typescript
export { CompanySelectionPage } from './components/company/CompanySelectionPage.js';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui-office/src/components/company/CompanySelectionPage.tsx
git commit -m "feat: add CompanySelectionPage with Discord-style icon bar"
```

---

## Task 5: Wizard "Create Your Own" Option

**Files:**
- Modify: `packages/ui-office/src/components/onboarding/CompanyCreationWizard.tsx`

- [ ] **Step 1: Add "Create Your Own" to template metadata**

In `CompanyCreationWizard.tsx`, find the `TMPL` mapping (~line 28-89) and add after the last entry:

```typescript
'create-your-own': {
  icon: <Wrench className="w-4 h-4" />,  // or appropriate icon
  iconLg: <Wrench className="w-6 h-6" />,
  accent: 'text-emerald-400',
  accentHex: '#34d399',
  accentBg: 'bg-emerald-500/10',
  tagline: 'Design your office from scratch',
  bestFor: ['Custom layout', 'Full creative control'],
  complexity: 0,
  capabilities: ['3D Studio Editor', 'Custom plot size', 'Free placement'],
  gradient: 'from-emerald-600 to-teal-500',
},
```

- [ ] **Step 2: Add the template to listTemplates or handle it specially**

The wizard's template list comes from `listTemplates()` in core. Rather than modifying core, add a synthetic "Create Your Own" entry in the wizard component itself — append it to the templates array before rendering.

In the wizard's template selection rendering section (~line 347), when the user selects "create-your-own", instead of calling `create()`, emit a callback like `onCreateYourOwn?.()` that the parent (App.tsx) handles by switching to Studio view.

- [ ] **Step 3: Add onCreateYourOwn callback to wizard props**

```typescript
interface CompanyCreationWizardProps {
  // ... existing props
  onCreateYourOwn?: () => void;
}
```

When the "Create Your Own" template is selected and the user clicks the action button, call `onCreateYourOwn()` instead of `create()`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui-office/src/components/onboarding/CompanyCreationWizard.tsx
git commit -m "feat: add 'Create Your Own' option to CompanyCreationWizard"
```

---

## Task 6: Studio Zustand Store

**Files:**
- Create: `packages/ui-office/src/components/studio/StudioState.tsx`

- [ ] **Step 1: Create the store**

```typescript
// packages/ui-office/src/components/studio/StudioState.tsx
import { create } from 'zustand';
import type { PrefabDefinition } from '@aics/shared-types';

export type StudioTool = 'select' | 'move' | 'rotate' | 'place';

export interface PlacedInstance {
  id: string;
  prefabId: string;
  position: [number, number, number]; // Three.js [x, 0, z]
  rotation: 0 | 90 | 180 | 270;
  zoneId: string;
}

export interface PlotSize {
  name: string;
  width: number;  // 3D X axis
  depth: number;  // 3D Z axis
}

export const PLOT_SIZES: PlotSize[] = [
  { name: '小型工作室', width: 20, depth: 15 },
  { name: '标准办公室', width: 40, depth: 30 },
  { name: '大型办公楼', width: 60, depth: 45 },
  { name: '园区', width: 80, depth: 60 },
];

export interface StudioStore {
  // State
  tool: StudioTool;
  plotSize: PlotSize;
  placingPrefab: PrefabDefinition | null;
  selectedInstanceId: string | null;
  instances: PlacedInstance[];
  dirty: boolean;
  gridSnap: boolean;

  // Actions
  setTool: (tool: StudioTool) => void;
  setPlotSize: (size: PlotSize) => void;
  startPlacement: (def: PrefabDefinition) => void;
  cancelPlacement: () => void;
  placeInstance: (position: [number, number, number], zoneId: string) => void;
  selectInstance: (id: string | null) => void;
  deleteSelected: () => void;
  updatePosition: (id: string, position: [number, number, number]) => void;
  updateRotation: (id: string, rotation: 0 | 90 | 180 | 270) => void;
  rotateSelected: () => void;
  toggleGridSnap: () => void;
  setInstances: (instances: PlacedInstance[]) => void;
  markClean: () => void;
}

let _nextId = 0;
function generateId(): string {
  return `studio-${Date.now()}-${_nextId++}`;
}

export const useStudioStore = create<StudioStore>((set, get) => ({
  tool: 'select',
  plotSize: PLOT_SIZES[1], // 标准办公室
  placingPrefab: null,
  selectedInstanceId: null,
  instances: [],
  dirty: false,
  gridSnap: true,

  setTool: (tool) => set({ tool, placingPrefab: tool !== 'place' ? null : get().placingPrefab }),
  setPlotSize: (plotSize) => set({ plotSize, dirty: true }),

  startPlacement: (def) => set({ tool: 'place', placingPrefab: def, selectedInstanceId: null }),
  cancelPlacement: () => set({ tool: 'select', placingPrefab: null }),

  placeInstance: (position, zoneId) => {
    const { placingPrefab, instances } = get();
    if (!placingPrefab) return;
    const instance: PlacedInstance = {
      id: generateId(),
      prefabId: placingPrefab.prefabId,
      position,
      rotation: 0,
      zoneId,
    };
    set({ instances: [...instances, instance], dirty: true });
    // Stay in placement mode for quick multi-place
  },

  selectInstance: (id) => set({ selectedInstanceId: id }),
  deleteSelected: () => {
    const { selectedInstanceId, instances } = get();
    if (!selectedInstanceId) return;
    set({
      instances: instances.filter((i) => i.id !== selectedInstanceId),
      selectedInstanceId: null,
      dirty: true,
    });
  },

  updatePosition: (id, position) => set((s) => ({
    instances: s.instances.map((i) => (i.id === id ? { ...i, position } : i)),
    dirty: true,
  })),

  updateRotation: (id, rotation) => set((s) => ({
    instances: s.instances.map((i) => (i.id === id ? { ...i, rotation } : i)),
    dirty: true,
  })),

  rotateSelected: () => {
    const { selectedInstanceId, instances } = get();
    if (!selectedInstanceId) return;
    const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
    set({
      instances: instances.map((i) => {
        if (i.id !== selectedInstanceId) return i;
        const idx = ROTATIONS.indexOf(i.rotation);
        return { ...i, rotation: ROTATIONS[(idx + 1) % 4] };
      }),
      dirty: true,
    });
  },

  toggleGridSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),
  setInstances: (instances) => set({ instances, dirty: false }),
  markClean: () => set({ dirty: false }),
}));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioState.tsx
git commit -m "feat: add Studio Zustand store with placement, selection, tool state"
```

---

## Task 7: StudioCanvas (3D Scene)

**Files:**
- Create: `packages/ui-office/src/components/studio/StudioCanvas.tsx`

- [ ] **Step 1: Create StudioCanvas**

```typescript
// packages/ui-office/src/components/studio/StudioCanvas.tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, TransformControls } from '@react-three/drei';
import { useRef, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { useStudioStore } from './StudioState.js';
import { useThree } from '@react-three/fiber';

// Pre-allocated objects for raycast (never create in useFrame)
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _intersectPoint = new THREE.Vector3();

/** Plot boundary wireframe box */
function PlotBoundary() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const geo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(plotSize.width, 0.02, plotSize.depth)),
    [plotSize.width, plotSize.depth],
  );
  return (
    <lineSegments position={[0, 0.01, 0]} geometry={geo}>
      <lineBasicMaterial color="#6366f1" transparent opacity={0.6} />
    </lineSegments>
  );
}

/** The 3D scene contents (inside Canvas) */
function StudioScene() {
  const plotSize = useStudioStore((s) => s.plotSize);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow={false} />

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={5}
        maxDistance={Math.max(plotSize.width, plotSize.depth) * 2}
      />

      {/* Grid */}
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2}
        cellColor="#333"
        sectionColor="#555"
        fadeDistance={Math.max(plotSize.width, plotSize.depth) * 1.5}
        fadeStrength={1.5}
        position={[0, -0.01, 0]}
      />

      {/* Plot boundary */}
      <PlotBoundary />
    </>
  );
}

interface StudioCanvasProps {
  children?: React.ReactNode;
}

export function StudioCanvas({ children }: StudioCanvasProps) {
  const onPointerMissed = useCallback(() => {
    useStudioStore.getState().selectInstance(null);
  }, []);

  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [20, 20, 20], fov: 50, near: 0.1, far: 500 }}
      onPointerMissed={onPointerMissed}
      style={{ background: '#111' }}
    >
      <StudioScene />
      {children}
    </Canvas>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioCanvas.tsx
git commit -m "feat: add StudioCanvas with grid, orbit, plot boundary"
```

---

## Task 8: StudioPalette + StudioGhost (Placement Flow)

**Files:**
- Create: `packages/ui-office/src/components/studio/StudioPalette.tsx`
- Create: `packages/ui-office/src/components/studio/StudioGhost.tsx`

- [ ] **Step 1: Create StudioPalette**

Left sidebar, categorized prefab list. Click to start placement.

```typescript
// packages/ui-office/src/components/studio/StudioPalette.tsx
import { useState, useMemo } from 'react';
import { getAllBuiltinPrefabs } from '@aics/renderer';
import type { PrefabDefinition } from '@aics/shared-types';
import { useStudioStore } from './StudioState.js';

const CATEGORY_LABELS: Record<string, string> = {
  workspace: '🖥 Workspace',
  compute: '🖧 Compute',
  knowledge: '📚 Knowledge',
  collaboration: '🤝 Collaboration',
  infrastructure: '⚡ Infrastructure',
  decorative: '🌿 Decorative',
};

export function StudioPalette() {
  const startPlacement = useStudioStore((s) => s.startPlacement);
  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const allPrefabs = getAllBuiltinPrefabs();
    const groups: Record<string, PrefabDefinition[]> = {};
    for (const def of allPrefabs) {
      const cat = def.category || 'decorative';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(def);
    }
    return groups;
  }, []);

  const toggle = (cat: string) =>
    setCollapsed((p) => ({ ...p, [cat]: !p[cat] }));

  return (
    <div style={{
      position: 'absolute', left: 0, top: 48, bottom: 48,
      width: 220, background: 'rgba(15,15,26,0.95)',
      borderRight: '1px solid #333', overflowY: 'auto',
      zIndex: 10, fontFamily: 'system-ui',
    }}>
      <div style={{ padding: '12px 16px', color: '#888', fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>
        PREFABS
      </div>
      {Object.entries(grouped).map(([cat, defs]) => (
        <div key={cat}>
          <button
            onClick={() => toggle(cat)}
            style={{
              width: '100%', padding: '8px 16px', background: 'none',
              border: 'none', color: '#ccc', fontSize: 12, cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <span>{CATEGORY_LABELS[cat] || cat}</span>
            <span style={{ color: '#666' }}>{collapsed[cat] ? '▸' : '▾'} {defs.length}</span>
          </button>
          {!collapsed[cat] && defs.map((def) => (
            <button
              key={def.prefabId}
              onClick={() => startPlacement(def)}
              style={{
                width: '100%', padding: '6px 16px 6px 28px', background:
                  placingPrefab?.prefabId === def.prefabId ? 'rgba(99,102,241,0.2)' : 'none',
                border: 'none', color: '#ddd', fontSize: 12, cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {def.name}
              <span style={{ color: '#666', marginLeft: 8, fontSize: 10 }}>
                {def.gridSize[0]}×{def.gridSize[1]}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create StudioGhost**

Ghost preview that follows the mouse cursor during placement, using raycast to invisible floor.

```typescript
// packages/ui-office/src/components/studio/StudioGhost.tsx
import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStudioStore } from './StudioState.js';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

export function StudioGhost() {
  const groupRef = useRef<THREE.Group>(null!);
  const { invalidate } = useThree();

  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const plotSize = useStudioStore((s) => s.plotSize);
  const placeInstance = useStudioStore((s) => s.placeInstance);
  const cancelPlacement = useStudioStore((s) => s.cancelPlacement);
  const gridSnap = useStudioStore((s) => s.gridSnap);

  const SNAP = 0.5;
  const halfW = plotSize.width / 2;
  const halfD = plotSize.depth / 2;

  if (!placingPrefab) return null;

  return (
    <>
      {/* Invisible floor for raycast */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));
          if (groupRef.current) {
            groupRef.current.position.set(x, 0, z);
            groupRef.current.visible = true;
          }
          invalidate();
        }}
        onClick={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));
          placeInstance([x, 0, z], 'editor');
          invalidate();
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          cancelPlacement();
          invalidate();
        }}
      >
        <planeGeometry args={[plotSize.width * 2, plotSize.depth * 2]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Ghost mesh */}
      <group ref={groupRef} visible={false}>
        <Prefab3D definition={placingPrefab} />
        {/* Semi-transparent overlay is handled by useFrame material traverse */}
      </group>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioPalette.tsx packages/ui-office/src/components/studio/StudioGhost.tsx
git commit -m "feat: add StudioPalette and StudioGhost for prefab placement"
```

---

## Task 9: StudioPlacedPrefabs + Selection + TransformControls

**Files:**
- Create: `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx`

- [ ] **Step 1: Create StudioPlacedPrefabs**

Renders all placed instances. Click to select. TransformControls always mounted, enabled only for selected.

```typescript
// packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx
import { useRef, useCallback, useEffect, memo } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { getBuiltinPrefab } from '@aics/renderer';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';
import { useStudioStore, type PlacedInstance } from './StudioState.js';

/** Single placed prefab — memoized to avoid TransformControls flicker */
const PlacedPrefabItem = memo(function PlacedPrefabItem({
  instance,
  isSelected,
  isEditing,
  onSelect,
}: {
  instance: PlacedInstance;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (id: string) => void;
}) {
  const definition = getBuiltinPrefab(instance.prefabId);
  if (!definition) return null;

  return (
    <group
      position={instance.position}
      rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(instance.id);
      }}
      onPointerOver={() => { document.body.style.cursor = isEditing ? 'pointer' : 'default'; }}
      onPointerOut={() => { document.body.style.cursor = 'default'; }}
    >
      <Prefab3D definition={definition} />
      {/* Selection highlight ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[
            Math.max(definition.gridSize[0], definition.gridSize[1]) * 0.3,
            Math.max(definition.gridSize[0], definition.gridSize[1]) * 0.35,
            32,
          ]} />
          <meshBasicMaterial color="#6366f1" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
});

export function StudioPlacedPrefabs() {
  const instances = useStudioStore((s) => s.instances);
  const selectedInstanceId = useStudioStore((s) => s.selectedInstanceId);
  const tool = useStudioStore((s) => s.tool);
  const updatePosition = useStudioStore((s) => s.updatePosition);
  const updateRotation = useStudioStore((s) => s.updateRotation);
  const { invalidate } = useThree();

  const transformRef = useRef<any>(null);
  const selectedGroupRef = useRef<THREE.Group>(null);

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);
  const isEditing = tool === 'select' || tool === 'move' || tool === 'rotate';

  const onSelect = useCallback((id: string) => {
    if (!isEditing) return;
    useStudioStore.getState().selectInstance(id);
    invalidate();
  }, [isEditing, invalidate]);

  // Sync TransformControls with selection
  useEffect(() => {
    if (!transformRef.current || !selectedGroupRef.current) return;
    if (selectedInstance) {
      transformRef.current.attach(selectedGroupRef.current);
    } else {
      transformRef.current.detach();
    }
    invalidate();
  }, [selectedInstance, invalidate]);

  // TransformControls onChange — update store
  const onTransformChange = useCallback(() => {
    if (!selectedInstance || !selectedGroupRef.current) return;
    const pos = selectedGroupRef.current.position;
    updatePosition(selectedInstance.id, [pos.x, pos.y, pos.z]);
    invalidate();
  }, [selectedInstance, updatePosition, invalidate]);

  const tcMode = tool === 'rotate' ? 'rotate' : 'translate';

  return (
    <>
      {/* TransformControls — always mounted, enabled prop toggles */}
      <TransformControls
        ref={transformRef}
        mode={tcMode}
        enabled={!!selectedInstance && (tool === 'move' || tool === 'rotate')}
        translationSnap={0.5}
        rotationSnap={Math.PI / 2}
        showY={false}
        onChange={onTransformChange}
      />

      {/* Render all placed prefabs */}
      {instances.map((inst) => {
        if (inst.id === selectedInstanceId) {
          // Selected item rendered in a separate group for TransformControls attachment
          return (
            <group key={inst.id} ref={selectedGroupRef} position={inst.position}>
              <PlacedPrefabItem
                instance={{ ...inst, position: [0, 0, 0] }}
                isSelected={true}
                isEditing={isEditing}
                onSelect={onSelect}
              />
            </group>
          );
        }
        return (
          <PlacedPrefabItem
            key={inst.id}
            instance={inst}
            isSelected={false}
            isEditing={isEditing}
            onSelect={onSelect}
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx
git commit -m "feat: add StudioPlacedPrefabs with selection and TransformControls"
```

---

## Task 10: StudioToolbar + StudioProperties + StudioPlotSelector

**Files:**
- Create: `packages/ui-office/src/components/studio/StudioToolbar.tsx`
- Create: `packages/ui-office/src/components/studio/StudioProperties.tsx`
- Create: `packages/ui-office/src/components/studio/StudioPlotSelector.tsx`

- [ ] **Step 1: Create StudioToolbar**

Top bar with tool buttons, grid toggle, save, back.

```typescript
// packages/ui-office/src/components/studio/StudioToolbar.tsx
import { useStudioStore, type StudioTool } from './StudioState.js';

const TOOLS: { key: StudioTool; label: string; shortcut: string }[] = [
  { key: 'select', label: 'Select', shortcut: '1' },
  { key: 'move', label: 'Move', shortcut: '2' },
  { key: 'rotate', label: 'Rotate', shortcut: '3' },
  { key: 'place', label: 'Place', shortcut: '4' },
];

interface StudioToolbarProps {
  onSave: () => void;
  onBack: () => void;
  saving?: boolean;
}

export function StudioToolbar({ onSave, onBack, saving }: StudioToolbarProps) {
  const tool = useStudioStore((s) => s.tool);
  const setTool = useStudioStore((s) => s.setTool);
  const gridSnap = useStudioStore((s) => s.gridSnap);
  const toggleGridSnap = useStudioStore((s) => s.toggleGridSnap);
  const dirty = useStudioStore((s) => s.dirty);
  const instanceCount = useStudioStore((s) => s.instances.length);

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 48,
      background: 'rgba(15,15,26,0.95)', borderBottom: '1px solid #333',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
      zIndex: 10, fontFamily: 'system-ui',
    }}>
      {/* Back */}
      <button onClick={onBack} style={btnStyle(false)}>← Back</button>

      <div style={{ width: 1, height: 24, background: '#333', margin: '0 8px' }} />

      {/* Tool buttons */}
      {TOOLS.map((t) => (
        <button key={t.key} onClick={() => setTool(t.key)} style={btnStyle(tool === t.key)}>
          {t.label} <span style={{ color: '#666', fontSize: 10, marginLeft: 4 }}>{t.shortcut}</span>
        </button>
      ))}

      <div style={{ width: 1, height: 24, background: '#333', margin: '0 8px' }} />

      {/* Grid snap toggle */}
      <button onClick={toggleGridSnap} style={btnStyle(gridSnap)}>
        Grid {gridSnap ? 'ON' : 'OFF'}
      </button>

      <div style={{ flex: 1 }} />

      {/* Count */}
      <span style={{ color: '#666', fontSize: 12, fontFamily: 'monospace' }}>{instanceCount} items</span>

      {/* Save */}
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        style={{
          ...btnStyle(false),
          background: dirty ? '#6366f1' : '#333',
          color: dirty ? 'white' : '#666',
        }}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
    color: active ? '#a5b4fc' : '#ccc', fontSize: 12, fontWeight: 500,
  };
}
```

- [ ] **Step 2: Create StudioProperties**

Right panel for selected instance details.

```typescript
// packages/ui-office/src/components/studio/StudioProperties.tsx
import { getBuiltinPrefab } from '@aics/renderer';
import { useStudioStore } from './StudioState.js';

export function StudioProperties() {
  const selectedId = useStudioStore((s) => s.selectedInstanceId);
  const instances = useStudioStore((s) => s.instances);
  const deleteSelected = useStudioStore((s) => s.deleteSelected);
  const rotateSelected = useStudioStore((s) => s.rotateSelected);

  const instance = instances.find((i) => i.id === selectedId);
  if (!instance) return null;

  const def = getBuiltinPrefab(instance.prefabId);
  if (!def) return null;

  return (
    <div style={{
      position: 'absolute', right: 0, top: 48, bottom: 48,
      width: 240, background: 'rgba(15,15,26,0.95)',
      borderLeft: '1px solid #333', padding: 16,
      zIndex: 10, fontFamily: 'system-ui', color: '#ccc',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'white', marginBottom: 4 }}>{def.name}</div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 16 }}>{def.category}</div>

      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>POSITION</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, fontSize: 12, fontFamily: 'monospace' }}>
        <span style={{ color: '#f87171' }}>X {instance.position[0].toFixed(1)}</span>
        <span style={{ color: '#60a5fa' }}>Z {instance.position[2].toFixed(1)}</span>
      </div>

      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>ROTATION</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{instance.rotation}°</span>
        <button onClick={rotateSelected} style={{
          padding: '4px 8px', background: 'rgba(255,255,255,0.1)',
          border: 'none', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 11,
        }}>
          +90°
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>GRID SIZE</div>
      <div style={{ fontSize: 12, marginBottom: 16 }}>{def.gridSize[0]} × {def.gridSize[1]}</div>

      <button onClick={deleteSelected} style={{
        width: '100%', padding: '8px 0', background: 'rgba(239,68,68,0.15)',
        border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
        color: '#ef4444', cursor: 'pointer', fontSize: 12,
      }}>
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create StudioPlotSelector**

Bottom bar for plot size selection.

```typescript
// packages/ui-office/src/components/studio/StudioPlotSelector.tsx
import { useStudioStore, PLOT_SIZES } from './StudioState.js';

export function StudioPlotSelector() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const setPlotSize = useStudioStore((s) => s.setPlotSize);

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: 48,
      background: 'rgba(15,15,26,0.95)', borderTop: '1px solid #333',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      zIndex: 10, fontFamily: 'system-ui',
    }}>
      <span style={{ color: '#888', fontSize: 11, marginRight: 8 }}>PLOT SIZE</span>
      {PLOT_SIZES.map((p) => (
        <button
          key={p.name}
          onClick={() => setPlotSize(p)}
          style={{
            padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: plotSize.name === p.name ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
            color: plotSize.name === p.name ? '#a5b4fc' : '#aaa', fontSize: 11,
          }}
        >
          {p.name} ({p.width}×{p.depth})
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioToolbar.tsx packages/ui-office/src/components/studio/StudioProperties.tsx packages/ui-office/src/components/studio/StudioPlotSelector.tsx
git commit -m "feat: add StudioToolbar, StudioProperties, StudioPlotSelector"
```

---

## Task 11: StudioPage (Full-Screen Wrapper + Keyboard Shortcuts)

**Files:**
- Create: `packages/ui-office/src/components/studio/StudioPage.tsx`

- [ ] **Step 1: Create StudioPage**

Composes all Studio components. Handles keyboard shortcuts. Manages save flow.

```typescript
// packages/ui-office/src/components/studio/StudioPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { useStudioStore, type PlacedInstance } from './StudioState.js';
import { StudioCanvas } from './StudioCanvas.js';
import { StudioToolbar } from './StudioToolbar.js';
import { StudioPalette } from './StudioPalette.js';
import { StudioProperties } from './StudioProperties.js';
import { StudioGhost } from './StudioGhost.js';
import { StudioPlacedPrefabs } from './StudioPlacedPrefabs.js';
import { StudioPlotSelector } from './StudioPlotSelector.js';
import type { RuntimeRepositories } from '@aics/core';
import type { PrefabInstanceRow } from '@aics/shared-types';

export interface StudioPageProps {
  mode: 'create' | 'edit';
  companyId?: string;        // required for edit mode
  repos: RuntimeRepositories | null;
  onBack: () => void;
  onCompanyCreated?: (companyId: string) => void;
}

export function StudioPage({ mode, companyId, repos, onBack, onCompanyCreated }: StudioPageProps) {
  const [saving, setSaving] = useState(false);

  // Load existing instances for edit mode
  useEffect(() => {
    if (mode === 'edit' && companyId && repos) {
      repos.prefabInstances.findByCompany(companyId).then((rows) => {
        const instances: PlacedInstance[] = rows.map((r) => ({
          id: r.instance_id,
          prefabId: r.prefab_id,
          position: [r.position_x, 0, r.position_y] as [number, number, number],
          rotation: (r.rotation as 0 | 90 | 180 | 270) || 0,
          zoneId: r.zone_id,
        }));
        useStudioStore.getState().setInstances(instances);
      });
    } else {
      useStudioStore.getState().setInstances([]);
    }
  }, [mode, companyId, repos]);

  // Save flow
  const handleSave = useCallback(async () => {
    if (!repos) return;
    setSaving(true);
    try {
      const state = useStudioStore.getState();
      let targetCompanyId = companyId;

      if (mode === 'create') {
        // Prompt for company name
        const name = window.prompt('Company name:', 'My Company');
        if (!name) { setSaving(false); return; }

        targetCompanyId = crypto.randomUUID();
        const now = new Date().toISOString();
        await repos.companies.create({
          company_id: targetCompanyId,
          name,
          status: 'active',
          workspace_root: null,
          default_model_policy_json: null,
          created_at: now,
          updated_at: now,
        });

        // Create office layout with plot size
        await repos.officeLayouts.create({
          layout_id: crypto.randomUUID(),
          company_id: targetCompanyId,
          layout_json: JSON.stringify({ plotSize: state.plotSize }),
          is_active: 1,
          created_at: now,
          updated_at: now,
        });
      } else if (targetCompanyId) {
        // Edit mode: delete existing instances
        await repos.prefabInstances.deleteByCompany(targetCompanyId);
      }

      // Batch create instances
      if (targetCompanyId) {
        const now = new Date().toISOString();
        for (const inst of state.instances) {
          const row: PrefabInstanceRow = {
            instance_id: inst.id.startsWith('studio-') ? crypto.randomUUID() : inst.id,
            company_id: targetCompanyId,
            prefab_id: inst.prefabId,
            zone_id: inst.zoneId,
            position_x: parseFloat(inst.position[0].toFixed(4)),
            position_y: parseFloat(inst.position[2].toFixed(4)), // Three.js Z → DB Y
            rotation: inst.rotation,
            bindings_json: null,
            config_json: null,
            enabled: 1,
            created_at: now,
            updated_at: now,
          };
          await repos.prefabInstances.create(row);
        }
      }

      useStudioStore.getState().markClean();

      if (mode === 'create' && targetCompanyId && onCompanyCreated) {
        onCompanyCreated(targetCompanyId);
      } else {
        onBack();
      }
    } finally {
      setSaving(false);
    }
  }, [repos, companyId, mode, onBack, onCompanyCreated]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const store = useStudioStore.getState();
      switch (e.key) {
        case '1': store.setTool('select'); break;
        case '2': store.setTool('move'); break;
        case '3': store.setTool('rotate'); break;
        case '4': store.setTool('place'); break;
        case 'r': case 'R': store.rotateSelected(); break;
        case 'Delete': case 'Backspace': store.deleteSelected(); break;
        case 'Escape':
          if (store.placingPrefab) store.cancelPlacement();
          else store.selectInstance(null);
          break;
        case 'g': case 'G': store.toggleGridSnap(); break;
        case 's':
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); handleSave(); }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // IMPORTANT: Because Canvas uses frameloop="demand", keyboard-triggered state
  // changes won't re-render the 3D scene. Add an InvalidateBridge component inside
  // StudioCanvas that subscribes to Zustand and calls invalidate() on any change:
  //
  // function InvalidateBridge() {
  //   const { invalidate } = useThree();
  //   useEffect(() => useStudioStore.subscribe(() => invalidate()), [invalidate]);
  //   return null;
  // }
  // Render <InvalidateBridge /> inside <StudioCanvas>.

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111' }}>
      <StudioToolbar onSave={handleSave} onBack={onBack} saving={saving} />
      <StudioPalette />
      <StudioProperties />
      <StudioPlotSelector />
      <div style={{ position: 'absolute', top: 48, left: 220, right: 0, bottom: 48 }}>
        <StudioCanvas>
          <StudioPlacedPrefabs />
          <StudioGhost />
        </StudioCanvas>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aics/ui-office typecheck
```

Note: The `repos.officeLayouts.create()` call may need interface verification. Check that `OfficeLayoutRepository` has a `create` method. If not, add it following the same pattern as Task 1.

- [ ] **Step 3: Commit**

```bash
git add packages/ui-office/src/components/studio/StudioPage.tsx
git commit -m "feat: add StudioPage with save flow, keyboard shortcuts, full layout"
```

---

## Task 12: Wire Up App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Expand AppView type**

At line 55, change:
```typescript
type AppView = 'office' | 'employee-creator' | 'office-editor' | 'company-select' | 'studio';
```

- [ ] **Step 2: Add CompanyProvider wrapper**

Wrap the entire app with `CompanyProvider`. The provider needs `repos` which comes from `AicsRuntimeProvider`. Two options:
1. Lift repos up — create repos before the provider tree
2. Nest CompanyProvider inside AicsRuntimeProvider

Choose option 2 (simpler, keeps existing structure):

```tsx
<AicsRuntimeProvider companyId={activeCompanyId ?? ''}>
  {/* Inside, use a CompanyProviderInner that gets repos from useAicsRuntime() */}
</AicsRuntimeProvider>
```

Or: create a thin wrapper component that bridges the two contexts.

The key integration point: `AicsRuntimeProvider` gets `key={activeCompanyId}` to trigger unmount/remount on company switch:

```tsx
{activeCompanyId && (
  <AicsRuntimeProvider key={activeCompanyId} companyId={activeCompanyId}>
    {/* existing app content for the selected company */}
  </AicsRuntimeProvider>
)}
```

- [ ] **Step 3: Add view routing for company-select and studio**

In the rendering section, add handlers:
- If `view === 'company-select'` → render `<CompanySelectionPage>`
- If `view === 'studio'` → render `<StudioPage>`
- Default → existing office view

- [ ] **Step 4: Wire wizard "Create Your Own" callback**

In the CompanyCreationWizard usage, add:
```tsx
<CompanyCreationWizard
  onCreateYourOwn={() => setView('studio')}
  // ... existing props
/>
```

- [ ] **Step 5: Add "Edit Layout" button in Runtime**

Add a button somewhere in the Runtime UI (e.g., header or EditorToolbar) that calls `setView('studio')` to enter Studio edit mode for the current company.

- [ ] **Step 6: Typecheck + build**

```bash
pnpm typecheck
pnpm --filter @aics/web build
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: wire multi-company and studio into App.tsx view routing"
```

---

## Task 13: Smoke Test

- [ ] **Step 1: Build all packages**

```bash
pnpm --filter @aics/ui-office build
pnpm --filter @aics/core build
```

- [ ] **Step 2: Start Tauri dev**

```bash
pnpm --filter @aics/desktop dev
```

- [ ] **Step 3: Manual test checklist**

1. App launches → should show CompanyCreationWizard (no companies)
2. Select "Agency Lite" → creates company → enters Runtime (existing flow works)
3. Navigate to company-select → see company in icon bar
4. Click [+] → wizard opens → select "Create Your Own" → Studio opens
5. In Studio: click prefab in palette → ghost follows mouse → click to place
6. Place multiple prefabs → select one → TransformControls appear → drag to move
7. Change plot size → boundary updates
8. Save → company created → redirects to Runtime
9. Company selection page shows both companies
10. Switch between companies → data reloads correctly

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @aics/core test
```

Expected: All tests pass. Studio has no unit tests yet (UI-only, manual testing).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: smoke test adjustments"
```

---

## Summary

| Task | What | Estimated Steps |
|------|------|----------------|
| 1 | Zustand + CompanyRepository expansion | 7 |
| 2 | CompanyContext + CompanyProvider | 4 |
| 3 | Remove COMPANY_ID hardcode | 9 |
| 4 | CompanySelectionPage | 4 |
| 5 | Wizard "Create Your Own" | 5 |
| 6 | Studio Zustand store | 3 |
| 7 | StudioCanvas (3D scene) | 3 |
| 8 | StudioPalette + StudioGhost | 4 |
| 9 | StudioPlacedPrefabs + TransformControls | 3 |
| 10 | StudioToolbar + Properties + PlotSelector | 5 |
| 11 | StudioPage (wrapper + shortcuts + save) | 3 |
| 12 | Wire up App.tsx | 7 |
| 13 | Smoke test | 5 |
| **Total** | | **62 steps** |

**Dependencies:**
- Tasks 1-3: sequential (multi-company foundation)
- Tasks 4-5: depend on Tasks 2-3, can parallel with each other
- Tasks 6-10: truly independent, can parallel with Tasks 1-5
- Task 11 (StudioPage): depends on Task 1 (CompanyRepository.create) + Tasks 6-10
- Task 12 (App.tsx wiring): depends on Tasks 1-5 + Task 11
- Task 13 (smoke test): depends on all
