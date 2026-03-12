# Runtime Completion — Implementation Plan

**Date:** 2026-03-12
**Design Spec:** `Docs/superpowers/specs/2026-03-12-runtime-completion-design.md`
**Target:** PRD §5 Runtime feature gaps for 1.0

---

## Goal

实现 PRD §5 审计中缺失的 5 个运行时功能：工位拖拽交互、员工版本历史、面谈式入职、成本追踪 + Boss Dashboard、队列可视化。

## Architecture

- **数据层**: Drizzle ORM + SQLite (db-local), Repository pattern (memory + drizzle 双实现)
- **事件层**: shared-types 定义 payload, core EventBus 传播
- **渲染层**: packages/renderer PixiJS 8 + GSAP 3
- **UI 层**: apps/web React 19 + shadcn/ui + Tailwind CSS 4

## Tech Stack (no new deps)

- PixiJS 8 (pointer events API)
- GSAP 3 (animation)
- Drizzle ORM (schema + queries)
- Vitest (testing)
- React 19 + shadcn/ui (UI)

---

## Chunk A: Foundation — DB Migrations, Types, Repositories

**Dependencies:** None
**Parallel-safe with:** Nothing (foundation for B–E)
**Estimated scope:** ~12 files

### Task A1: New event types in shared-types

- [ ] A1.1: Add new event payloads to `packages/shared-types/src/events.ts`

```typescript
// Add to events.ts

export interface EmployeeWorkstationChangedPayload {
  readonly employeeId: string;
  readonly fromWorkstationId: string | null;
  readonly toWorkstationId: string | null;
}

export interface EmployeeVersionCreatedPayload {
  readonly employeeId: string;
  readonly versionNum: number;
  readonly changeType: 'create' | 'update' | 'rollback';
}
```

- [ ] A1.2: Add new event families to `EventFamily` union in `packages/shared-types/src/events.ts`

```typescript
// Add to EventFamily union:
| 'employee.workstation.changed'
| 'employee.version.created'
```

- [ ] A1.3: Re-export new types from `packages/shared-types/src/index.ts`
- [ ] A1.4: Build shared-types: `cd packages/shared-types && pnpm build`

### Task A2: DB migration — employee_versions table

- [ ] A2.1: Create `Docs/03_migrations/aics_migrations_local_v0.1/009_employee_versions.sql`

```sql
-- 009: Employee version history
CREATE TABLE IF NOT EXISTS employee_versions (
  version_id    TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL,
  change_type   TEXT NOT NULL CHECK(change_type IN ('create', 'update', 'rollback')),
  snapshot_json TEXT NOT NULL,
  change_summary TEXT,
  created_by    TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_ver_emp_num ON employee_versions(employee_id, version_num);
CREATE INDEX IF NOT EXISTS idx_emp_ver_emp ON employee_versions(employee_id);
```

- [ ] A2.2: Create `packages/db-local/src/migrations/006_employee_versions.sql` (same content, next seq in package)
- [ ] A2.3: Add Drizzle schema to `packages/db-local/src/schema.ts`

```typescript
export const employeeVersions = sqliteTable(
  'employee_versions',
  {
    version_id: text('version_id').primaryKey(),
    employee_id: text('employee_id')
      .notNull()
      .references(() => employees.employee_id, { onDelete: 'cascade' }),
    version_num: integer('version_num').notNull(),
    change_type: text('change_type').notNull(),
    snapshot_json: text('snapshot_json').notNull(),
    change_summary: text('change_summary'),
    created_by: text('created_by').notNull().default('user'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_emp_ver_emp_num').on(table.employee_id, table.version_num),
    index('idx_emp_ver_emp').on(table.employee_id),
  ],
);
```

### Task A3: DB migration — model_cost_rates table

- [ ] A3.1: Create `Docs/03_migrations/aics_migrations_local_v0.1/010_model_cost_rates.sql`

```sql
-- 010: Model cost rates for LLM usage tracking
CREATE TABLE IF NOT EXISTS model_cost_rates (
  rate_id              TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  model_pattern        TEXT NOT NULL,
  input_cost_per_mtok  REAL NOT NULL,
  output_cost_per_mtok REAL NOT NULL,
  effective_from       TEXT NOT NULL,
  effective_until      TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_rates_provider_model
  ON model_cost_rates(provider, model_pattern, effective_from);
```

- [ ] A3.2: Create `packages/db-local/src/migrations/007_model_cost_rates.sql`
- [ ] A3.3: Add Drizzle schema to `packages/db-local/src/schema.ts`

```typescript
export const modelCostRates = sqliteTable(
  'model_cost_rates',
  {
    rate_id: text('rate_id').primaryKey(),
    provider: text('provider').notNull(),
    model_pattern: text('model_pattern').notNull(),
    input_cost_per_mtok: real('input_cost_per_mtok').notNull(),
    output_cost_per_mtok: real('output_cost_per_mtok').notNull(),
    effective_from: text('effective_from').notNull(),
    effective_until: text('effective_until'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_cost_rates_provider_model').on(
      table.provider,
      table.model_pattern,
      table.effective_from,
    ),
  ],
);
```

### Task A4: Repository types and interfaces

- [ ] A4.1: Add row types and interfaces to `packages/core/src/runtime/repositories.ts`

```typescript
// EmployeeVersionRow, EmployeeVersionRepository
export interface EmployeeVersionRow {
  version_id: string;
  employee_id: string;
  version_num: number;
  change_type: string;
  snapshot_json: string;
  change_summary: string | null;
  created_by: string;
  created_at: string;
}

export type NewEmployeeVersion = Omit<EmployeeVersionRow, 'version_id' | 'created_at'>;

export interface EmployeeVersionRepository {
  create(version: NewEmployeeVersion): Promise<EmployeeVersionRow>;
  findByEmployee(employeeId: string, opts?: { limit?: number }): Promise<EmployeeVersionRow[]>;
  findByVersion(employeeId: string, versionNum: number): Promise<EmployeeVersionRow | null>;
  getLatestVersionNum(employeeId: string): Promise<number>;
}

// ModelCostRateRow, ModelCostRateRepository
export interface ModelCostRateRow {
  rate_id: string;
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
  effective_from: string;
  effective_until: string | null;
  created_at: string;
}

export type NewModelCostRate = Omit<ModelCostRateRow, 'rate_id' | 'created_at'>;

export interface ModelCostRateRepository {
  create(rate: NewModelCostRate): Promise<ModelCostRateRow>;
  findByProviderModel(provider: string, model: string): Promise<ModelCostRateRow | null>;
  findAll(): Promise<ModelCostRateRow[]>;
  upsert(rate: NewModelCostRate): Promise<ModelCostRateRow>;
}
```

- [ ] A4.2: Add `employeeVersions` and `costRates` to `RuntimeRepositories` interface
- [ ] A4.3: Extend `TaskRunRepository` with queue methods:

```typescript
// Add to TaskRunRepository:
findQueue(companyId: string, opts?: { statuses?: string[]; limit?: number }): Promise<TaskRunRow[]>;
countByStatus(companyId: string): Promise<Record<string, number>>;
```

### Task A5: Memory repository implementations

- [ ] A5.1: Create `packages/core/src/runtime/repos/memory-employee-version-repository.ts`
- [ ] A5.2: Create `packages/core/src/runtime/repos/memory-cost-rate-repository.ts`
- [ ] A5.3: Add queue methods to existing `MemoryTaskRunRepository`

### Task A6: Event factory functions

- [ ] A6.1: Add factory functions to `packages/core/src/runtime/events.ts` (or wherever `employeeCreated` etc. live)

```typescript
export function employeeWorkstationChanged(
  companyId: string,
  employeeId: string,
  fromWorkstationId: string | null,
  toWorkstationId: string | null,
): RuntimeEvent<EmployeeWorkstationChangedPayload>;

export function employeeVersionCreated(
  companyId: string,
  employeeId: string,
  versionNum: number,
  changeType: 'create' | 'update' | 'rollback',
): RuntimeEvent<EmployeeVersionCreatedPayload>;
```

### Task A7: Tests for Chunk A

- [ ] A7.1: Test memory-employee-version-repository: `packages/core/src/__tests__/unit/memory-employee-version-repository.test.ts`
  - create version, find by employee, find by version num, latest version num
- [ ] A7.2: Test memory-cost-rate-repository: `packages/core/src/__tests__/unit/memory-cost-rate-repository.test.ts`
  - create rate, findByProviderModel with glob matching, upsert
- [ ] A7.3: Test task run queue methods: extend existing task-run-repository tests
- [ ] A7.4: Verify build: `cd packages/shared-types && pnpm build && cd ../core && pnpm test`

**Validation:**
```bash
cd packages/shared-types && pnpm build
cd packages/core && pnpm test
cd packages/db-local && pnpm build
```

---

## Chunk B: Office Workstation Drag-Drop Interaction

**Dependencies:** Chunk A (event types)
**Parallel-safe with:** C, D, E (after A completes)
**Estimated scope:** ~8 files

### Task B1: Workstation positions in FloorLayer

- [ ] B1.1: Add workstation ID mapping to `packages/renderer/src/layers/floor-layer.ts`

```typescript
// Extend DeskPosition with workstation metadata
export interface DeskPosition {
  x: number;
  y: number;
  workstationId?: string;
}

// Add method:
getWorkstationBounds(): Map<string, { x: number; y: number; width: number; height: number }>;
```

- [ ] B1.2: Add workstation highlight method to FloorLayer for drop target feedback

### Task B2: InteractionController

- [ ] B2.1: Create `packages/renderer/src/interaction/interaction-controller.ts`

```typescript
import type { Container, FederatedPointerEvent } from 'pixi.js';
import gsap from 'gsap';
import type { SceneEntity, SceneEventBus } from '../core/types.js';
import type { MotionTokens } from '../tokens/motion.js';
import type { DeskPosition } from '../layers/floor-layer.js';

export interface DragResult {
  entityId: string;
  targetWorkstationId: string | null;
}

export class InteractionController {
  private dragging: { entityId: string; entity: SceneEntity; startX: number; startY: number } | null = null;
  private ghostContainer: Container | null = null;

  constructor(
    private stage: Container,
    private entities: Map<string, SceneEntity>,
    private workstationBounds: Map<string, { x: number; y: number; width: number; height: number }>,
    private eventBus: SceneEventBus,
    private motion: MotionTokens,
    private onDrop: (result: DragResult) => void,
  ) {}

  enable(): void;    // Attach pointer events to each entity
  disable(): void;   // Detach pointer events
  destroy(): void;   // Full cleanup

  private handlePointerDown(e: FederatedPointerEvent, entityId: string): void;
  private handlePointerMove(e: FederatedPointerEvent): void;
  private handlePointerUp(e: FederatedPointerEvent): void;
  private findWorkstationAt(x: number, y: number): string | null;
  private cancelDrag(): void;
}
```

- [ ] B2.2: Implement drag state machine:
  - `pointerdown` on entity container → store offset, set `eventMode = 'static'` on stage for move capture
  - `pointermove` → update entity position, check workstation bounds for hover highlight
  - `pointerup` → if over valid workstation, emit drop; else snap back with GSAP M2 animation
  - `Escape` key → cancel drag, snap back

- [ ] B2.3: PixiJS 8 specifics:
  - Set `entity.container.eventMode = 'static'` and `cursor = 'grab'`
  - During drag: `cursor = 'grabbing'`
  - Use `stage.on('pointermove', ...)` for global move tracking (PixiJS 8 pattern)

### Task B3: Integrate InteractionController into SceneManager

- [ ] B3.1: Add `InteractionController` to `packages/renderer/src/core/scene-manager.ts`
  - Create after entity placement in `mount()`
  - Wire `onDrop` callback to emit `employee.workstation.changed` via EventBus
  - Destroy in `destroy()`
  - Subscribe to `employee.workstation.changed` for remote-triggered position updates

- [ ] B3.2: Add `moveEntityToWorkstation(entityId, workstationId)` method to SceneManager
  - Animate entity to workstation position using GSAP M1
  - Update internal position tracking

### Task B4: DOM accessibility fallback

- [ ] B4.1: Add "Assign Workstation" dropdown to EmployeeEditorDialog
  - In Profile tab, add a `<Select>` for workstation assignment
  - Options: available workstations from DB
  - On change: call `repos.employees.update(id, { workstation_id })` + emit event

### Task B5: Workstation assignment service (core)

- [ ] B5.1: Create `packages/core/src/runtime/workstation-assignment-service.ts`

```typescript
export class WorkstationAssignmentService {
  constructor(private repos: RuntimeRepositories, private eventBus: EventBus) {}

  async assignToWorkstation(employeeId: string, workstationId: string | null): Promise<void> {
    const employee = await this.repos.employees.findById(employeeId);
    if (!employee) throw new Error(`Employee ${employeeId} not found`);

    const oldWorkstationId = employee.workstation_id;
    await this.repos.employees.update(employeeId, { workstation_id: workstationId });

    this.eventBus.emit(employeeWorkstationChanged(
      employee.company_id, employeeId, oldWorkstationId, workstationId,
    ));
  }
}
```

### Task B6: Tests for Chunk B

- [ ] B6.1: `packages/renderer/src/__tests__/unit/interaction-controller.test.ts`
  - Test drag start/move/end lifecycle with mock containers
  - Test workstation hit detection
  - Test cancel via escape
  - Test snap-back animation trigger
- [ ] B6.2: `packages/core/src/__tests__/unit/workstation-assignment-service.test.ts`
  - Test assign, unassign, event emission
- [ ] B6.3: Verify renderer build: `cd packages/renderer && pnpm test && pnpm build`

**Validation:**
```bash
cd packages/renderer && pnpm test
cd packages/core && pnpm test
```

---

## Chunk C: Employee Version History

**Dependencies:** Chunk A (employee_versions table, repository)
**Parallel-safe with:** B, D, E (after A completes)
**Estimated scope:** ~10 files

### Task C1: EmployeeVersionService

- [ ] C1.1: Create `packages/core/src/runtime/employee-version-service.ts`

```typescript
export class EmployeeVersionService {
  constructor(
    private versionRepo: EmployeeVersionRepository,
    private employeeRepo: EmployeeRepository,
    private eventBus: EventBus,
  ) {}

  /** Snapshot current employee state as a new version */
  async createVersion(
    employeeId: string,
    changeType: 'create' | 'update' | 'rollback',
    createdBy?: string,
  ): Promise<EmployeeVersionRow>;

  /** Get version history for an employee */
  async getHistory(employeeId: string, limit?: number): Promise<EmployeeVersionRow[]>;

  /** Rollback employee to a specific version */
  async rollbackToVersion(employeeId: string, versionNum: number): Promise<void>;

  /** Compare two versions and return structured diff */
  diffVersions(snapshotA: string, snapshotB: string): VersionDiff[];
}

export interface VersionDiff {
  field: string;
  from: unknown;
  to: unknown;
}
```

- [ ] C1.2: Implement `diffVersions` — flat JSON path comparison, max 2 levels deep:

```typescript
diffVersions(a: string, b: string): VersionDiff[] {
  const objA = JSON.parse(a);
  const objB = JSON.parse(b);
  const diffs: VersionDiff[] = [];

  const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  for (const key of allKeys) {
    const valA = typeof objA[key] === 'object' ? JSON.stringify(objA[key]) : objA[key];
    const valB = typeof objB[key] === 'object' ? JSON.stringify(objB[key]) : objB[key];
    if (valA !== valB) {
      diffs.push({ field: key, from: objA[key], to: objB[key] });
    }
  }
  return diffs;
}
```

### Task C2: Wire version creation into useEmployeeEditor

- [ ] C2.1: Modify `apps/web/src/hooks/useEmployeeEditor.ts`
  - After successful `save()` for create: call `versionService.createVersion(id, 'create')`
  - After successful `save()` for update: call `versionService.createVersion(id, 'update')`
  - Pass `EmployeeVersionService` via runtime context

### Task C3: Version History UI — useEmployeeVersions hook

- [ ] C3.1: Create `apps/web/src/hooks/useEmployeeVersions.ts`

```typescript
export function useEmployeeVersions(employeeId: string | null) {
  const { versionService } = useAicsRuntime();
  const [versions, setVersions] = useState<EmployeeVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<VersionDiff[] | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Load versions when employeeId changes
  // Compare selected version with current
  // Rollback function with confirmation state

  return { versions, loading, diffResult, selectedVersion, selectVersion, rollback, isRollingBack };
}
```

### Task C4: Version History UI — HistoryTab component

- [ ] C4.1: Create `apps/web/src/components/employees/VersionHistoryTab.tsx`

```typescript
interface VersionHistoryTabProps {
  employeeId: string;
}

export function VersionHistoryTab({ employeeId }: VersionHistoryTabProps) {
  const { versions, loading, diffResult, selectedVersion, selectVersion, rollback, isRollingBack } =
    useEmployeeVersions(employeeId);

  // Timeline list: version_num + created_at + change_type badge + summary
  // Selected version: show diff table (field | old | new)
  // Rollback button with confirmation dialog
  // Empty state for single version
}
```

- [ ] C4.2: Version diff display component `VersionDiffTable.tsx`
  - Table with columns: Field, Previous, Current
  - Color-coded: red for removed, green for added, yellow for changed
  - JSON fields (persona, config) expanded to show sub-field diffs

### Task C5: Integrate History tab into EmployeeEditorDialog

- [ ] C5.1: Add 4th tab "History" to `apps/web/src/components/employees/EmployeeEditorDialog.tsx`
  - Only visible in edit mode (not create)
  - Lazy-load version data when tab is activated

### Task C6: Tests for Chunk C

- [ ] C6.1: `packages/core/src/__tests__/unit/employee-version-service.test.ts`
  - createVersion with correct snapshot, version numbering, event emission
  - getHistory ordering
  - rollbackToVersion applies snapshot + creates new version
  - diffVersions with various field changes
- [ ] C6.2: Component test for VersionHistoryTab (React Testing Library)
- [ ] C6.3: Verify: `cd packages/core && pnpm test && cd ../../apps/web && pnpm build`

**Validation:**
```bash
cd packages/core && pnpm test
cd apps/web && pnpm build
```

---

## Chunk D: Cost Tracking + Boss Dashboard + Queue Visibility

**Dependencies:** Chunk A (cost_rates table, repository, queue methods)
**Parallel-safe with:** B, C, E (after A completes)
**Estimated scope:** ~14 files

### Task D1: CostCalculationService

- [ ] D1.1: Create `packages/core/src/runtime/cost-calculation-service.ts`

```typescript
export class CostCalculationService {
  constructor(
    private costRateRepo: ModelCostRateRepository,
    private llmCallRepo: LlmCallRepository,
  ) {}

  /** Match model string against glob patterns */
  private matchModel(model: string, pattern: string): boolean {
    // Simple glob: '*' matches any sequence
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return regex.test(model);
  }

  /** Find the best matching cost rate for a provider + model */
  async findRate(provider: string, model: string): Promise<ModelCostRateRow | null>;

  /** Calculate cost for a single LLM call */
  async calculateCallCost(call: LlmCallRow): Promise<{
    inputCost: number;
    outputCost: number;
    totalCost: number;
    rateFound: boolean;
  }>;

  /** Aggregate costs with grouping */
  async aggregateCosts(companyId: string, opts: {
    from?: string;
    to?: string;
    groupBy?: 'model' | 'employee' | 'day';
  }): Promise<CostAggregate[]>;
}

export interface CostAggregate {
  groupKey: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  callCount: number;
}
```

### Task D2: Default cost rates seed data

- [ ] D2.1: Create `packages/core/src/runtime/default-cost-rates.ts`

```typescript
export const DEFAULT_COST_RATES: Array<{
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
}> = [
  // OpenAI
  { provider: 'openai', model_pattern: 'gpt-4o*', input_cost_per_mtok: 2.5, output_cost_per_mtok: 10 },
  { provider: 'openai', model_pattern: 'gpt-4o-mini*', input_cost_per_mtok: 0.15, output_cost_per_mtok: 0.6 },
  { provider: 'openai', model_pattern: 'gpt-4-turbo*', input_cost_per_mtok: 10, output_cost_per_mtok: 30 },
  // Anthropic
  { provider: 'anthropic', model_pattern: 'claude-3-opus*', input_cost_per_mtok: 15, output_cost_per_mtok: 75 },
  { provider: 'anthropic', model_pattern: 'claude-3.5-sonnet*', input_cost_per_mtok: 3, output_cost_per_mtok: 15 },
  { provider: 'anthropic', model_pattern: 'claude-3-haiku*', input_cost_per_mtok: 0.25, output_cost_per_mtok: 1.25 },
  // Google
  { provider: 'openai-compat', model_pattern: 'gemini-2.5-flash*', input_cost_per_mtok: 0.15, output_cost_per_mtok: 0.6 },
  { provider: 'openai-compat', model_pattern: 'gemini-2.5-pro*', input_cost_per_mtok: 1.25, output_cost_per_mtok: 10 },
];
```

### Task D3: useCostDashboard hook

- [ ] D3.1: Create `apps/web/src/hooks/useCostDashboard.ts`

```typescript
export function useCostDashboard() {
  const { costService } = useAicsRuntime();
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [byModel, setByModel] = useState<CostAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  // Refresh on mount and on llm.call.completed events
  // Calculate today's costs, total costs, group by model

  return { summary, byModel, loading, refresh };
}

interface CostSummary {
  totalCost: number;
  todayCost: number;
  totalCalls: number;
  todayCalls: number;
}
```

### Task D4: useTaskQueue hook

- [ ] D4.1: Create `apps/web/src/hooks/useTaskQueue.ts`

```typescript
export function useTaskQueue() {
  const { repos, eventBus } = useAicsRuntime();
  const [activeTasks, setActiveTasks] = useState<TaskRunRow[]>([]);
  const [pendingTasks, setPendingTasks] = useState<TaskRunRow[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<TaskRunRow[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  // Load on mount, subscribe to task.state.changed for live updates
  // Batch updates with rAF (match existing pattern from EventBus batching)

  return { activeTasks, pendingTasks, recentCompleted, statusCounts, loading };
}
```

### Task D5: BossDashboard component

- [ ] D5.1: Create `apps/web/src/components/dashboard/BossDashboard.tsx`

```
BossDashboard (grid layout, 2 columns on desktop)
├── CostOverviewCard — total cost, today, call count (KPI cards)
├── CostByModelCard — horizontal bar chart (CSS-based)
├── CompanyStatusCard — employee state counts (idle/active/blocked badges)
├── TaskQueueCard — active + pending tasks with status badges
└── RecentActivityCard — last 10 runtime events
```

- [ ] D5.2: Create `apps/web/src/components/dashboard/CostOverviewCard.tsx`
  - 3 KPI sub-cards: Total Cost, Today's Cost, Total Calls
  - Use existing `Card` component from shadcn/ui
  - Dollar amounts formatted with 4 decimal places

- [ ] D5.3: Create `apps/web/src/components/dashboard/CostByModelCard.tsx`
  - Horizontal bar chart using CSS `div` widths (percentage of max)
  - Model name + cost amount labels
  - Color-coded by provider (openai = green, anthropic = orange, etc.)

- [ ] D5.4: Create `apps/web/src/components/dashboard/CompanyStatusCard.tsx`
  - Employee state summary: count per state using existing `Badge` variants
  - Reuse STATE_VARIANTS mapping from AgentCard

- [ ] D5.5: Create `apps/web/src/components/dashboard/TaskQueueCard.tsx`
  - Tabs: Active | Pending | Completed
  - Each item: task_type badge + employee name + started_at duration + status
  - Empty state for each section

- [ ] D5.6: Create `apps/web/src/components/dashboard/RecentActivityCard.tsx`
  - List of recent runtime events (from EventBus stream)
  - event_type + entity name + timestamp
  - Max 10 items, auto-scroll

### Task D6: Wire BossDashboard into App layout

- [ ] D6.1: Add Dashboard tab/route to `apps/web/src/App.tsx` or layout
  - Dashboard as a toggle-able panel or separate route
  - Consider: side panel tab alongside existing Agent Panel
  - Or: top navigation tab if layout supports it

### Task D7: Seed cost rates on runtime init

- [ ] D7.1: In runtime initialization (where company seed happens), seed `DEFAULT_COST_RATES` into `model_cost_rates` table if empty
  - Use `costRateRepo.findAll()` to check; if empty, insert defaults
  - Idempotent — skip if rates already exist

### Task D8: Tests for Chunk D

- [ ] D8.1: `packages/core/src/__tests__/unit/cost-calculation-service.test.ts`
  - Model pattern matching (exact, wildcard, no match)
  - Single call cost calculation (input + output tokens × rate)
  - Aggregation by model, by day
  - Rate not found → cost = 0
- [ ] D8.2: `packages/core/src/__tests__/unit/default-cost-rates.test.ts`
  - Verify all default rates have valid structure
- [ ] D8.3: Component tests for KPI cards (React Testing Library, optional for 1.0)
- [ ] D8.4: Verify: `cd packages/core && pnpm test && cd ../../apps/web && pnpm build`

**Validation:**
```bash
cd packages/core && pnpm test
cd apps/web && pnpm build
```

---

## Chunk E: Interview-Style Onboarding Wizard

**Dependencies:** Chunk A (event types), Chunk C (version service for initial version)
**Parallel-safe with:** B, D (after A and C complete)
**Estimated scope:** ~10 files

### Task E1: Wizard state machine

- [ ] E1.1: Create `apps/web/src/hooks/useInterviewWizard.ts`

```typescript
const WIZARD_STEPS = ['role', 'name', 'expertise', 'style', 'instructions', 'model', 'preview'] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

interface WizardState {
  currentStep: number;
  formData: EmployeeFormData;
  completedSteps: Set<number>;
}

type WizardAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; step: number }
  | { type: 'updateField'; key: keyof EmployeeFormData; value: EmployeeFormData[keyof EmployeeFormData] }
  | { type: 'reset' };

export function useInterviewWizard() {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const { repos, eventBus, versionService } = useAicsRuntime();

  const canProceed: boolean;  // validation for current step
  const isLastStep: boolean;
  const progress: number;     // 0-1

  async function submit(): Promise<void>;  // create employee + version
  function next(): void;
  function back(): void;
  function skip(): void;  // skip optional step (model)
  function updateField<K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]): void;

  return { state, canProceed, isLastStep, progress, submit, next, back, skip, updateField };
}
```

### Task E2: InterviewWizard dialog

- [ ] E2.1: Create `apps/web/src/components/employees/InterviewWizard.tsx`

```typescript
interface InterviewWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

// Fullscreen dialog with progress bar
// Left side: HR avatar + question text
// Right side: input area for current step
// Bottom: Back / Skip / Next buttons
```

### Task E3: Step components

- [ ] E3.1: Create `apps/web/src/components/employees/interview-steps/RoleStep.tsx`
  - Card grid with role options (reuse ROLE_OPTIONS from EmployeeEditorDialog)
  - Each card: role icon (Lucide) + label + short description
  - Selected state with ring highlight

- [ ] E3.2: Create `apps/web/src/components/employees/interview-steps/NameStep.tsx`
  - Input field with HR prompt text
  - "Random Name" button for fun
  - Validation: non-empty

- [ ] E3.3: Create `apps/web/src/components/employees/interview-steps/ExpertiseStep.tsx`
  - Textarea with suggested tags below (clickable to add)
  - Suggestions vary by selected role

- [ ] E3.4: Create `apps/web/src/components/employees/interview-steps/StyleStep.tsx`
  - Preset style cards (e.g., "Detail-oriented", "Fast & iterative", "Collaborative") + custom textarea
  - Multiple selection allowed

- [ ] E3.5: Create `apps/web/src/components/employees/interview-steps/InstructionsStep.tsx`
  - Textarea with placeholder examples
  - Optional — can be left empty

- [ ] E3.6: Create `apps/web/src/components/employees/interview-steps/ModelStep.tsx`
  - Model preference input (optional, skip-able)
  - Temperature slider
  - Max tokens input
  - "Use defaults" prominent option

- [ ] E3.7: Create `apps/web/src/components/employees/interview-steps/PreviewStep.tsx`
  - Full employee config summary
  - Each section editable inline (click to edit)
  - "Create Employee" primary CTA

### Task E4: HR avatar and conversational framing

- [ ] E4.1: Create `apps/web/src/components/employees/interview-steps/HRPrompt.tsx`
  - HR avatar (circle with "HR" initial, reuses EmployeeEntity visual language)
  - Question text in a speech bubble styled container
  - Each step has a unique question string

### Task E5: Wire wizard into AgentPanel

- [ ] E5.1: Modify `apps/web/src/components/agents/AgentPanel.tsx`
  - Replace single "+" button with dropdown menu:
    - "Quick Create" → existing EmployeeEditorDialog (create mode)
    - "Interview Onboarding" → InterviewWizard
  - Use shadcn/ui `DropdownMenu` component

### Task E6: Tests for Chunk E

- [ ] E6.1: `apps/web/src/__tests__/unit/interview-wizard-reducer.test.ts`
  - Test reducer: next, back, goto, updateField, reset
  - Test validation per step
  - Test progress calculation
- [ ] E6.2: Component test for PreviewStep (data display correctness)
- [ ] E6.3: Verify: `cd apps/web && pnpm build`

**Validation:**
```bash
cd apps/web && pnpm build
```

---

## Execution Order

```
Week 1:  [A] Foundation ────────────────────────────>
Week 2:  [B] Drag-Drop ──────> [C] Versioning ─────>
         [D] Dashboard ───────────────────────────>
Week 3:  [E] Interview ──────>
         Final integration + smoke test
```

A 必须先完成。B/C/D 可以并行开发（不同开发者或不同 session）。E 依赖 C 的 version service。

## Total File Count Estimate

| Chunk | New Files | Modified Files | Tests |
|---|---|---|---|
| A | 6 | 5 | 4 |
| B | 3 | 3 | 2 |
| C | 4 | 2 | 2 |
| D | 9 | 3 | 3 |
| E | 10 | 1 | 2 |
| **Total** | **32** | **14** | **13** |

## Validation Checklist (全部完成后)

```bash
# Type check
cd packages/shared-types && pnpm build
cd packages/core && pnpm build
cd packages/renderer && pnpm build
cd packages/db-local && pnpm build

# Tests
cd packages/core && pnpm test
cd packages/renderer && pnpm test
cd apps/web && pnpm test

# Build
cd apps/web && pnpm build

# Lint (if configured)
pnpm -r lint
```

## Handoff Notes

完成后应产出：
1. 所有 5 个 PRD §5 缺失功能的可用实现
2. 2 个新 DB migration (009, 010)
3. 2 个新 Repository 接口 + memory 实现
4. 1 个新 PixiJS InteractionController
5. 1 个新 CostCalculationService
6. 1 个新 EmployeeVersionService
7. BossDashboard 完整 UI
8. InterviewWizard 完整 UI
9. ~13 个新测试文件

## Starter Prompt for Next Session

```
我需要你实现 Runtime Completion 计划的 Chunk A (Foundation)。

请先阅读：
1. Docs/superpowers/specs/2026-03-12-runtime-completion-design.md
2. Docs/superpowers/plans/2026-03-12-runtime-completion.md

然后按照 Chunk A 的 Task A1-A7 顺序实现：
- A1: shared-types 新增事件类型
- A2: employee_versions 表 migration + schema
- A3: model_cost_rates 表 migration + schema
- A4: Repository 接口扩展
- A5: Memory repository 实现
- A6: 事件工厂函数
- A7: 单元测试

完成后运行验证：shared-types build + core test + db-local build
```
