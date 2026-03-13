# PRD 1.0 Completion — 6 Remaining Features

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the 6 remaining PRD v1.6 features to achieve full 1.0 specification compliance.

**Architecture:** Each feature follows the existing layered pattern: DB migration → Drizzle schema → Repository (interface + memory impl) → Service → Events → React hook → UI component → Tests. New repos are added to `RuntimeRepositories` interface and `createMemoryRepositories()`.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, SQLite, React 19, PixiJS 8, Radix UI primitives

**Dependency Order:**
```
Task 1 (SOP) ──→ Task 5 (Templates) ──→ Task 6 (First-Time UX)
Task 2 (Office Editor) ── independent
Task 3 (Rack/Slot)     ── independent
Task 4 (Library)        ── independent
```

---

## Chunk 1: SOP DAG System (Task 1)

### Task 1A: SOP Types + Schema

**Files:**
- Create: `packages/shared-types/src/sop.ts`
- Modify: `packages/shared-types/src/index.ts` (re-export)
- Create: `packages/core/src/__tests__/sop-types.test.ts`

- [ ] **Step 1: Define SOP types**

```typescript
// packages/shared-types/src/sop.ts
export interface SopStep {
  readonly step_id: string;
  readonly label: string;
  readonly role_slug: string;
  readonly instruction: string;
  readonly dependencies: readonly string[]; // step_ids that must complete first
  readonly output_key: string;              // key for collecting output
}

export interface SopDefinition {
  readonly sop_id: string;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly SopStep[];
  readonly input_schema?: Record<string, string>;   // expected input keys
  readonly output_schema?: Record<string, string>;   // expected output keys
  readonly created_at: string;
}

export interface SopTemplateRow {
  readonly sop_template_id: string;
  readonly company_id: string;
  readonly name: string;
  readonly description: string;
  readonly definition_json: string;   // JSON.stringify(SopDefinition)
  readonly source_thread_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export type NewSopTemplate = Omit<SopTemplateRow, 'created_at' | 'updated_at'>;
```

- [ ] **Step 2: Export from shared-types index**
- [ ] **Step 3: Write validation tests**

Test: `pnpm --filter @aics/shared-types exec vitest run` — PASS

- [ ] **Step 4: Commit** — `feat(shared-types): add SOP definition types`

### Task 1B: SOP Repository

**Files:**
- Modify: `packages/core/src/runtime/repositories.ts` (add SopTemplateRepository interface + row types)
- Modify: `packages/core/src/runtime/memory-repositories.ts` (add memory impl)
- Create: `packages/core/src/__tests__/sop-repository.test.ts`

- [ ] **Step 1: Add SopTemplateRepository interface to repositories.ts**

```typescript
export interface SopTemplateRepository {
  create(template: NewSopTemplate): Promise<SopTemplateRow>;
  findById(sopTemplateId: string): Promise<SopTemplateRow | null>;
  findByCompany(companyId: string): Promise<SopTemplateRow[]>;
  delete(sopTemplateId: string): Promise<void>;
}
```

Add `sopTemplates: SopTemplateRepository` to `RuntimeRepositories`.

- [ ] **Step 2: Add MemorySopTemplateRepository class to memory-repositories.ts**
- [ ] **Step 3: Write repository tests (CRUD + findByCompany)**

Test: `pnpm --filter @aics/core exec vitest run src/__tests__/sop-repository.test.ts` — PASS

- [ ] **Step 4: Commit** — `feat(core): add SopTemplateRepository with memory impl`

### Task 1C: SOP Service

**Files:**
- Create: `packages/core/src/services/sop-service.ts`
- Create: `packages/core/src/__tests__/sop-service.test.ts`
- Modify: `packages/core/src/index.ts` (export)

- [ ] **Step 1: Create SopService**

```typescript
export class SopService {
  constructor(
    private readonly sopTemplateRepo: SopTemplateRepository,
    private readonly eventBus: EventBus,
  ) {}

  /** Validate SOP definition structure */
  validateDefinition(def: SopDefinition): { valid: boolean; errors: string[] }

  /** Save a successful task path as SOP template */
  async saveAsTemplate(companyId: string, name: string, description: string, definition: SopDefinition, sourceThreadId?: string): Promise<string>

  /** Get execution order (topological sort of DAG) */
  getExecutionOrder(def: SopDefinition): SopStep[][]  // returns batches of parallel steps

  /** List templates for a company */
  async listTemplates(companyId: string): Promise<SopTemplateRow[]>

  /** Delete a template */
  async deleteTemplate(sopTemplateId: string): Promise<void>
}
```

- [ ] **Step 2: Write tests — validation (cycle detection, missing deps, empty steps), topological sort, save/list/delete**

Test: `pnpm --filter @aics/core exec vitest run src/__tests__/sop-service.test.ts` — PASS

- [ ] **Step 3: Commit** — `feat(core): add SopService with DAG validation and topological sort`

### Task 1D: SOP Migration + Drizzle Table

**Files:**
- Create: `Docs/03_migrations/aics_migrations_local_v0.1/011_sop_templates.sql`
- Modify: `packages/db-local/src/schema.ts` (add sopTemplates table)

- [ ] **Step 1: Create migration 011**

```sql
CREATE TABLE IF NOT EXISTS sop_templates (
  sop_template_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  source_thread_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sop_templates_company ON sop_templates(company_id);
```

- [ ] **Step 2: Add Drizzle table to schema.ts**
- [ ] **Step 3: Commit** — `feat(db-local): add sop_templates table (migration 011)`

---

## Chunk 2: Office Layout System (Task 2)

### Task 2A: Office Layout Data Model

**Files:**
- Create: `Docs/03_migrations/aics_migrations_local_v0.1/012_office_layouts.sql`
- Modify: `packages/db-local/src/schema.ts` (add officeLayouts table)
- Modify: `packages/core/src/runtime/repositories.ts` (add OfficeLayoutRepository)
- Modify: `packages/core/src/runtime/memory-repositories.ts` (add memory impl)
- Create: `packages/core/src/__tests__/office-layout-repository.test.ts`

- [ ] **Step 1: Define OfficeLayoutRow and repository interface**

```typescript
// In repositories.ts
export interface OfficeLayoutRow {
  layout_id: string;
  company_id: string;
  name: string;
  layout_json: string;  // JSON: { workstations: WorkstationConfig[], roomType: string, gridCols: number, gridRows: number }
  is_active: number;     // 0 or 1
  created_at: string;
  updated_at: string;
}

export type NewOfficeLayout = Omit<OfficeLayoutRow, 'created_at' | 'updated_at'>;

export interface OfficeLayoutRepository {
  create(layout: NewOfficeLayout): Promise<OfficeLayoutRow>;
  findById(layoutId: string): Promise<OfficeLayoutRow | null>;
  findByCompany(companyId: string): Promise<OfficeLayoutRow[]>;
  findActive(companyId: string): Promise<OfficeLayoutRow | null>;
  setActive(companyId: string, layoutId: string): Promise<void>;
  update(layoutId: string, patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>): Promise<void>;
  delete(layoutId: string): Promise<void>;
}
```

- [ ] **Step 2: Create migration 012**
- [ ] **Step 3: Add Drizzle table + memory impl**
- [ ] **Step 4: Write repository tests**

Test: `pnpm --filter @aics/core exec vitest run src/__tests__/office-layout-repository.test.ts` — PASS

- [ ] **Step 5: Commit** — `feat(core,db-local): add OfficeLayoutRepository + migration 012`

### Task 2B: Layout Configuration Types

**Files:**
- Create: `packages/renderer/src/types/layout-config.ts`
- Modify: `packages/renderer/src/tokens/layout.ts` (export default layout as LayoutConfig)
- Modify: `packages/renderer/src/layers/floor-layer.ts` (accept LayoutConfig)
- Create: `packages/renderer/src/__tests__/layout-config.test.ts`

- [ ] **Step 1: Define LayoutConfig type**

```typescript
// packages/renderer/src/types/layout-config.ts
export interface WorkstationConfig {
  workstationId: string;
  label: string;
  x: number;
  y: number;
  roomType: 'office' | 'meeting' | 'server_room' | 'library';
}

export interface LayoutConfig {
  gridCols: number;
  gridRows: number;
  workstations: WorkstationConfig[];
}

export const LAYOUT_PRESETS: Record<string, LayoutConfig> = {
  '2x2': { gridCols: 2, gridRows: 2, workstations: [ /* 4 stations */ ] },
  '2x3': { gridCols: 2, gridRows: 3, workstations: [ /* 6 stations */ ] },
  '3x3': { gridCols: 3, gridRows: 3, workstations: [ /* 9 stations */ ] },
};
```

- [ ] **Step 2: Refactor FloorLayer to accept LayoutConfig instead of hardcoded positions**
- [ ] **Step 3: Write tests for layout presets and FloorLayer with custom config**
- [ ] **Step 4: Commit** — `refactor(renderer): FloorLayer accepts LayoutConfig, add presets`

### Task 2C: Office Editor UI

**Files:**
- Create: `apps/web/src/hooks/useOfficeLayout.ts`
- Create: `apps/web/src/components/office/OfficeEditor.tsx`
- Modify: `apps/web/src/components/layout/RightSidebar.tsx` (add Office tab)

- [ ] **Step 1: Create useOfficeLayout hook**

```typescript
export function useOfficeLayout() {
  // loads active layout, provides save/create/setActive
  // uses OfficeLayoutRepository from useAicsRuntime()
}
```

- [ ] **Step 2: Create OfficeEditor component**

Panel with:
- Layout preset selector (2x2 / 2x3 / 3x3 dropdown)
- Workstation list with editable labels
- Room type selector per workstation
- Save / Reset buttons
- Compact layout — fits in sidebar width

- [ ] **Step 3: Add "Office" tab to RightSidebar**
- [ ] **Step 4: Commit** — `feat(web): add OfficeEditor with layout presets and workstation config`

---

## Chunk 3: Rack/Slot MCP Permissions (Task 3)

### Task 3A: Rack/Slot Repositories

**Files:**
- Modify: `packages/core/src/runtime/repositories.ts` (add RackRow, SlotRow, interfaces)
- Modify: `packages/core/src/runtime/memory-repositories.ts` (add memory impls)
- Create: `packages/core/src/__tests__/rack-slot-repository.test.ts`

- [ ] **Step 1: Add row types and repository interfaces**

```typescript
export interface RackRow {
  rack_id: string;
  company_id: string;
  provider_type: string;  // 'mcp_server' | 'capability_provider'
  label: string;
  binding_profile_json: string | null;
  status: string;  // 'unbound' | 'bound' | 'error' | 'disabled'
  created_at: string;
  updated_at: string;
}
export type NewRack = Omit<RackRow, 'created_at' | 'updated_at'>;

export interface SlotRow {
  slot_id: string;
  rack_id: string;
  capability_name: string;
  exposure_scope: string;  // 'private' | 'team' | 'company'
  status: string;  // 'available' | 'reserved' | 'disabled'
  created_at: string;
  updated_at: string;
}
export type NewSlot = Omit<SlotRow, 'created_at' | 'updated_at'>;

export interface RackRepository {
  create(rack: NewRack): Promise<RackRow>;
  findById(rackId: string): Promise<RackRow | null>;
  findByCompany(companyId: string): Promise<RackRow[]>;
  updateStatus(rackId: string, status: string): Promise<void>;
  delete(rackId: string): Promise<void>;
}

export interface SlotRepository {
  create(slot: NewSlot): Promise<SlotRow>;
  findByRack(rackId: string): Promise<SlotRow[]>;
  findByWorkstation(workstationId: string): Promise<SlotRow[]>;
  updateStatus(slotId: string, status: string): Promise<void>;
  delete(slotId: string): Promise<void>;
}
```

Add `racks: RackRepository` and `slots: SlotRepository` to `RuntimeRepositories`.

- [ ] **Step 2: Implement MemoryRackRepository and MemorySlotRepository**
- [ ] **Step 3: Write repository tests (CRUD, findByCompany, findByRack)**

Test: `pnpm --filter @aics/core exec vitest run src/__tests__/rack-slot-repository.test.ts` — PASS

- [ ] **Step 4: Commit** — `feat(core): add RackRepository + SlotRepository with memory impls`

### Task 3B: Rack/Slot Service

**Files:**
- Create: `packages/core/src/services/rack-slot-service.ts`
- Create: `packages/core/src/__tests__/rack-slot-service.test.ts`
- Modify: `packages/shared-types/src/events.ts` (add rack/slot events)

- [ ] **Step 1: Add rack/slot event payloads to shared-types**

```typescript
export interface RackBoundPayload {
  readonly rackId: string;
  readonly providerType: string;
  readonly label: string;
}

export interface SlotAssignedPayload {
  readonly slotId: string;
  readonly rackId: string;
  readonly capabilityName: string;
}
```

- [ ] **Step 2: Create RackSlotService**

```typescript
export class RackSlotService {
  constructor(
    private readonly rackRepo: RackRepository,
    private readonly slotRepo: SlotRepository,
    private readonly eventBus: EventBus,
  ) {}

  async createRack(companyId: string, label: string, providerType: string): Promise<string>
  async bindRack(rackId: string, bindingProfile: Record<string, unknown>): Promise<void>
  async unbindRack(rackId: string): Promise<void>
  async addSlot(rackId: string, capabilityName: string, scope: string): Promise<string>
  async removeSlot(slotId: string): Promise<void>
  async getAvailableCapabilities(companyId: string): Promise<SlotRow[]>
  async listRacks(companyId: string): Promise<Array<RackRow & { slots: SlotRow[] }>>
}
```

- [ ] **Step 3: Write service tests**
- [ ] **Step 4: Commit** — `feat(core): add RackSlotService for MCP permission management`

### Task 3C: Server Room UI

**Files:**
- Create: `apps/web/src/hooks/useRackSlot.ts`
- Create: `apps/web/src/components/server-room/ServerRoom.tsx`
- Modify: `apps/web/src/components/layout/RightSidebar.tsx` (add Server Room tab)

- [ ] **Step 1: Create useRackSlot hook**
- [ ] **Step 2: Create ServerRoom component**

UI: Rack cards with status indicator, expandable slot list per rack, add/remove buttons, bind/unbind toggle.

- [ ] **Step 3: Add "Server Room" tab to RightSidebar**
- [ ] **Step 4: Commit** — `feat(web): add ServerRoom tab with rack/slot management UI`

---

## Chunk 4: Library Document System (Task 4)

### Task 4A: Library Data Model

**Files:**
- Create: `Docs/03_migrations/aics_migrations_local_v0.1/013_library_documents.sql`
- Modify: `packages/db-local/src/schema.ts` (add libraryDocuments table)
- Modify: `packages/core/src/runtime/repositories.ts` (add LibraryDocumentRepository)
- Modify: `packages/core/src/runtime/memory-repositories.ts` (add memory impl)
- Create: `packages/core/src/__tests__/library-repository.test.ts`

- [ ] **Step 1: Define LibraryDocumentRow and repository**

```typescript
export interface LibraryDocumentRow {
  doc_id: string;
  company_id: string;
  title: string;
  content_text: string;
  source_type: string;   // 'file' | 'url' | 'paste'
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  updated_at: string;
}
export type NewLibraryDocument = Omit<LibraryDocumentRow, 'created_at' | 'updated_at'>;

export interface LibraryDocumentRepository {
  create(doc: NewLibraryDocument): Promise<LibraryDocumentRow>;
  findById(docId: string): Promise<LibraryDocumentRow | null>;
  findByCompany(companyId: string): Promise<LibraryDocumentRow[]>;
  search(companyId: string, query: string, opts?: { limit?: number }): Promise<LibraryDocumentRow[]>;
  delete(docId: string): Promise<void>;
}
```

- [ ] **Step 2: Create migration 013**
- [ ] **Step 3: Add Drizzle table + memory impl (keyword search = case-insensitive substring match on title + content)**
- [ ] **Step 4: Write repository tests**
- [ ] **Step 5: Commit** — `feat(core,db-local): add LibraryDocumentRepository + migration 013`

### Task 4B: Library Service

**Files:**
- Create: `packages/core/src/services/library-service.ts`
- Create: `packages/core/src/__tests__/library-service.test.ts`

- [ ] **Step 1: Create LibraryService**

```typescript
export class LibraryService {
  constructor(
    private readonly libraryRepo: LibraryDocumentRepository,
    private readonly eventBus: EventBus,
  ) {}

  /** Upload a text file — extracts content, stores in DB */
  async uploadDocument(companyId: string, title: string, content: string, sourceType: string, mimeType?: string, fileSize?: number): Promise<string>

  /** Search documents by keyword */
  async search(companyId: string, query: string, limit?: number): Promise<LibraryDocumentRow[]>

  /** Get document by ID */
  async getDocument(docId: string): Promise<LibraryDocumentRow | null>

  /** List all documents for a company */
  async listDocuments(companyId: string): Promise<LibraryDocumentRow[]>

  /** Delete a document */
  async deleteDocument(docId: string): Promise<void>

  /** Get relevant snippets for a query (used by employee-node) */
  async getRelevantSnippets(companyId: string, query: string, maxChars?: number): Promise<string>
}
```

- [ ] **Step 2: Write tests (upload, search, snippets, delete)**
- [ ] **Step 3: Commit** — `feat(core): add LibraryService with keyword search and snippet extraction`

### Task 4C: Library UI

**Files:**
- Create: `apps/web/src/hooks/useLibrary.ts`
- Create: `apps/web/src/components/library/Library.tsx`
- Modify: `apps/web/src/components/layout/RightSidebar.tsx` (add Library tab)

- [ ] **Step 1: Create useLibrary hook (list, upload, search, delete)**
- [ ] **Step 2: Create Library component**

UI: Upload button (file picker for .txt/.md), document list with title + size + date, search input, click-to-preview content, delete button.

- [ ] **Step 3: Add "Library" tab to RightSidebar**
- [ ] **Step 4: Commit** — `feat(web): add Library tab with document upload and search`

---

## Chunk 5: Default Templates + First-Time Experience (Tasks 5 & 6)

### Task 5A: Company Template Data

**Files:**
- Create: `packages/core/src/templates/content-studio.ts`
- Create: `packages/core/src/templates/product-team.ts`
- Create: `packages/core/src/templates/agency-lite.ts`
- Create: `packages/core/src/templates/index.ts`
- Create: `packages/core/src/__tests__/company-templates.test.ts`

- [ ] **Step 1: Define template data structure**

```typescript
// packages/core/src/templates/index.ts
import type { SopDefinition } from '@aics/shared-types';

export interface CompanyTemplateEmployee {
  name: string;
  role_slug: string;
  persona_json: string;   // stringified { personality, expertise, style }
  config_json: string;     // stringified { model, temperature, ... }
}

export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;            // emoji
  employees: CompanyTemplateEmployee[];
  sops: SopDefinition[];
  layoutPreset: string;    // '2x2' | '2x3' | '3x3'
}

export function listTemplates(): CompanyTemplate[]
export function getTemplate(id: string): CompanyTemplate | undefined
```

- [ ] **Step 2: Create 3 template files with realistic employee configs and SOP definitions**

Each template has:
- Content Studio: Writer (creative writing), Researcher (analysis), Designer (visual design) + "Content Creation" SOP + "Social Media" SOP
- Product Team: PM, Researcher, Designer, QA + "Product Research" SOP + "Design Review" SOP
- Agency Lite: Account Manager, Creator, Deliverer + "Client Delivery" SOP

- [ ] **Step 3: Write tests — listTemplates returns 3, each has valid employees and SOPs**
- [ ] **Step 4: Commit** — `feat(core): add 3 default company templates`

### Task 5B: CompanyTemplateService

**Files:**
- Create: `packages/core/src/services/company-template-service.ts`
- Create: `packages/core/src/__tests__/company-template-service.test.ts`

- [ ] **Step 1: Create CompanyTemplateService**

```typescript
export class CompanyTemplateService {
  constructor(
    private readonly companyRepo: CompanyRepository,
    private readonly employeeRepo: EmployeeRepository,
    private readonly sopTemplateRepo: SopTemplateRepository,
    private readonly officeLayoutRepo: OfficeLayoutRepository,
    private readonly eventBus: EventBus,
  ) {}

  /** List available templates */
  listTemplates(): CompanyTemplate[]

  /** Materialize a template into a real company with employees, SOPs, layout */
  async materializeTemplate(
    templateId: string,
    companyName: string,
    companyId?: string,
  ): Promise<{ companyId: string; employeeIds: string[]; sopTemplateIds: string[] }>
}
```

- [ ] **Step 2: Write tests — materialize creates company + N employees + M SOPs + layout**
- [ ] **Step 3: Commit** — `feat(core): add CompanyTemplateService for template materialization`

### Task 6A: First-Time Detection + Wizard Hook

**Files:**
- Create: `apps/web/src/hooks/useCompanyCreation.ts`
- Create: `apps/web/src/__tests__/useCompanyCreation.test.ts`

- [ ] **Step 1: Create useCompanyCreation hook**

```typescript
export function useCompanyCreation() {
  // Checks if companies table is empty → isFirstRun = true
  // State machine: 'checking' | 'first-run' | 'creating' | 'ready'
  // Provides: selectTemplate(id), setCompanyName(name), create()
  // On create: calls CompanyTemplateService.materializeTemplate()
  // On success: triggers reinitRuntime() to reload
}
```

- [ ] **Step 2: Write tests**
- [ ] **Step 3: Commit** — `feat(web): add useCompanyCreation hook for first-time detection`

### Task 6B: Company Creation Wizard UI

**Files:**
- Create: `apps/web/src/components/onboarding/CompanyCreationWizard.tsx`
- Create: `apps/web/src/components/onboarding/TemplateCard.tsx`
- Modify: `apps/web/src/App.tsx` (show wizard when isFirstRun)
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx` (remove hardcoded seedCompany, add company creation support)

- [ ] **Step 1: Create TemplateCard component**

Displays: icon + name + description + employee count + "Select" button

- [ ] **Step 2: Create CompanyCreationWizard**

Full-screen dialog with 3 steps:
1. Choose template (3 cards side by side)
2. Name your company (text input)
3. HR welcome message + team preview → "Start" button

- [ ] **Step 3: Integrate into App.tsx — show wizard before main UI when isFirstRun**
- [ ] **Step 4: Update AicsRuntimeProvider — support creating company from template instead of hardcoded seed**
- [ ] **Step 5: Commit** — `feat(web): add CompanyCreationWizard with template selection and HR welcome`

---

## Chunk 6: Integration + RuntimeRepositories Wiring

### Task 7: Wire Everything Together

**Files:**
- Modify: `packages/core/src/runtime/repositories.ts` (ensure all new repos in RuntimeRepositories)
- Modify: `packages/core/src/runtime/memory-repositories.ts` (ensure all new memory impls)
- Modify: `packages/core/src/index.ts` (export all new services)
- Modify: `apps/web/src/runtime/aics-runtime-context.tsx` (expose new services)
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx` (create new service instances)

- [ ] **Step 1: Verify RuntimeRepositories has: sopTemplates, officeLayouts, racks, slots, libraryDocuments**
- [ ] **Step 2: Verify createMemoryRepositories() creates all new repos**
- [ ] **Step 3: Add new services to AicsRuntimeValue: sopService, libraryService, rackSlotService, companyTemplateService**
- [ ] **Step 4: Instantiate services in AicsRuntimeProvider**
- [ ] **Step 5: Run full test suite**

Run: `pnpm turbo run test --filter='./packages/*'` — ALL PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm turbo run typecheck` — ALL PASS

- [ ] **Step 7: Run build**

Run: `pnpm turbo run build` — ALL PASS

- [ ] **Step 8: Commit** — `feat(core,web): wire all new repositories and services into runtime`

---

## Verification Checklist

Before claiming completion:

- [ ] All new repository interfaces added to RuntimeRepositories
- [ ] All memory implementations in createMemoryRepositories()
- [ ] All new services exported from @aics/core
- [ ] All new services available via useAicsRuntime()
- [ ] RightSidebar has new tabs: Office, Server Room, Library
- [ ] CompanyCreationWizard shows on first run
- [ ] 3 default templates loadable
- [ ] Tests pass: `pnpm turbo run test`
- [ ] Typecheck passes: `pnpm turbo run typecheck`
- [ ] Build passes: `pnpm turbo run build`
