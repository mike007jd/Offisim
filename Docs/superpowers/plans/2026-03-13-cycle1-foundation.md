# Cycle 1: Foundation Completion — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the foundation layer — desktop DB migrations, 2 AI-native company templates, and full UI package extraction from apps into shared packages.

**Architecture:** Three UI packages (`ui-core`, `ui-office`, `ui-market`) are extracted from `apps/web` and `apps/market`. Templates are added to `packages/core/src/templates/`. Desktop migration array is extended. After extraction, apps become thin shells that compose package components.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, shadcn/ui (radix), PixiJS 8, GSAP 3, pnpm workspaces

**Spec:** `Docs/superpowers/specs/2026-03-13-cycle1-foundation-spec.md`

---

## Parallelization Strategy

```
Wave 1 (all independent):
  ├── Task 1: Desktop migration v11-v13
  ├── Task 2: Content Studio template
  ├── Task 3: Product Team template
  └── Task 4: ui-core package scaffold + component extraction

Wave 2 (depends on Task 4 completing):
  ├── Task 5: ui-office package — extract from apps/web
  └── Task 6: ui-market package — extract from apps/market

Wave 3 (depends on Tasks 5+6):
  ├── Task 7: Rewire apps/web → thin shell
  └── Task 8: Rewire apps/market → thin shell

Wave 4 (depends on all):
  └── Task 9: Integration validation + commit
```

---

## Chunk 1: Independent Foundation Tasks (Wave 1)

### Task 1: Desktop Migration v11-v13

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs` (migration array, around line 85)

**Context:** Tauri migration array references SQL files from `Docs/03_migrations/aics_migrations_local_v0.1/`. Files 011, 012, 013 already exist there. The array currently ends at version 10.

- [ ] **Step 1: Add migration v11 (sop_templates)**

Add to the `migrations()` function vec, after the version 10 entry:

```rust
Migration {
    version: 11,
    description: "sop templates and steps",
    sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/011_sop_templates.sql"),
    kind: MigrationKind::Up,
},
```

- [ ] **Step 2: Add migration v12 (office_layouts)**

```rust
Migration {
    version: 12,
    description: "office layouts",
    sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/012_office_layouts.sql"),
    kind: MigrationKind::Up,
},
```

- [ ] **Step 3: Add migration v13 (library_documents)**

```rust
Migration {
    version: 13,
    description: "library documents",
    sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/013_library_documents.sql"),
    kind: MigrationKind::Up,
},
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cd apps/desktop && pnpm tauri build --ci 2>&1 | head -20
# If no Rust toolchain available, at least verify the SQL files exist:
cat Docs/03_migrations/aics_migrations_local_v0.1/011_sop_templates.sql | head -5
cat Docs/03_migrations/aics_migrations_local_v0.1/012_office_layouts.sql | head -5
cat Docs/03_migrations/aics_migrations_local_v0.1/013_library_documents.sql | head -5
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "fix(desktop): register migration v11-v13 (sop_templates, office_layouts, library_documents)"
```

---

### Task 2: Content Studio Template

**Files:**
- Create: `packages/core/src/templates/content-studio.ts`
- Modify: `packages/core/src/templates/index.ts` (add to TEMPLATES array)

**Context:** Read `packages/core/src/templates/rd-company.ts` for the exact template structure. Follow the same pattern: `CompanyTemplate` with employees array and sops array. Each employee has `persona_json` with `characterConfig` inside it, and `config_json` with model preferences.

- [ ] **Step 1: Create content-studio.ts**

Create `packages/core/src/templates/content-studio.ts` with:
- Template id: `'content-studio'`, name: `'Content Studio'`, icon: `'📝'`
- 4 employees from spec (Dana Rivera/analyst, Leo Zhang/developer, Priya Sharma/pm, Marco Rossi/frontend)
- Each employee needs: `name`, `role_slug`, `persona_json` (JSON.stringify with expertise + style + characterConfig), `config_json`
- CharacterConfig values from spec table
- SOP: `sop-content-pipeline` with 4 steps (research → draft → review → optimize)
- `layoutPreset: 'rd-office'`

The persona_json expertise/style fields should reflect AI-native capabilities:
- Dana (Researcher): expertise = "Deep research, fact verification, multi-source synthesis, structured briefing"
- Leo (Writer): expertise = "Content drafting, tone adaptation, audience-aware writing, structured prose"
- Priya (Critic): expertise = "Quality auditing, factual accuracy review, style consistency, structured critique with actionable feedback"
- Marco (Optimizer): expertise = "SEO optimization, format adaptation, distribution readiness, content polishing"

- [ ] **Step 2: Register in index.ts**

In `packages/core/src/templates/index.ts`:
- Add import: `import { contentStudioTemplate } from './content-studio.js';`
- Add to TEMPLATES array: `contentStudioTemplate`

- [ ] **Step 3: Run core tests**

```bash
pnpm --filter @aics/core test 2>&1 | tail -5
```
Expected: all tests pass (templates are data, no logic to break)

- [ ] **Step 4: Build core**

```bash
pnpm --filter @aics/core build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/templates/content-studio.ts packages/core/src/templates/index.ts
git commit -m "feat(core): add Content Studio template — AI Generate-Critique pattern"
```

---

### Task 3: Product Team Template

**Files:**
- Create: `packages/core/src/templates/product-team.ts`
- Modify: `packages/core/src/templates/index.ts` (add to TEMPLATES array)

**Context:** Same pattern as Task 2. Read `rd-company.ts` for structure.

- [ ] **Step 1: Create product-team.ts**

Create `packages/core/src/templates/product-team.ts` with:
- Template id: `'product-team'`, name: `'Product Team'`, icon: `'🚀'`
- 4 employees from spec (Ava Mitchell/pm, Noah Kim/backend, Elena Volkov/fullstack, Raj Patel/analyst)
- CharacterConfig values from spec table
- SOP: `sop-build-cycle` with 4 steps (specify → design → implement → review)
- `layoutPreset: 'rd-office'`

Persona expertise fields:
- Ava (Spec Writer): "Requirements analysis, acceptance criteria definition, edge case identification, structured specification"
- Noah (Architect): "System design, API contract definition, data modeling, component boundary design"
- Elena (Implementer): "Production-grade implementation, test coverage, error handling, code documentation"
- Raj (Reviewer): "Code review, security analysis, performance audit, structured critique with severity ratings"

- [ ] **Step 2: Register in index.ts**

Add import and add `productTeamTemplate` to TEMPLATES array.

- [ ] **Step 3: Run core tests + build**

```bash
pnpm --filter @aics/core test 2>&1 | tail -5
pnpm --filter @aics/core build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/templates/product-team.ts packages/core/src/templates/index.ts
git commit -m "feat(core): add Product Team template — AI Spec-Driven pattern"
```

---

### Task 4: ui-core Package — Extract Shared Atomic Components

**Files:**
- Modify: `packages/ui-core/package.json` (add dependencies)
- Modify: `packages/ui-core/tsconfig.json` (configure for React JSX)
- Create: `packages/ui-core/src/components/*.tsx` (move from apps/web/src/components/ui/)
- Create: `packages/ui-core/src/lib/utils.ts` (cn function)
- Create: `packages/ui-core/src/index.ts` (barrel export)
- Create: `packages/ui-core/tailwind.preset.js` (shared design tokens)

**Context:** `apps/web/src/components/ui/` contains 13 shadcn components (~562 lines total). `apps/web/src/lib/utils.ts` has the `cn()` helper (6 lines). The market app has NO shadcn components — it uses plain Tailwind classes. After extraction, both apps import from `@aics/ui-core`.

**Important:** The components use `@/lib/utils` import alias which must become a relative import or package-local path.

- [ ] **Step 1: Update package.json**

Replace `packages/ui-core/package.json` with proper dependencies:
```json
{
  "name": "@aics/ui-core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./styles": "./src/styles/tokens.css"
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.1.6",
    "@radix-ui/react-dropdown-menu": "^2.1.6",
    "@radix-ui/react-label": "^2.1.2",
    "@radix-ui/react-popover": "^1.1.6",
    "@radix-ui/react-progress": "^1.1.2",
    "@radix-ui/react-scroll-area": "^1.2.3",
    "@radix-ui/react-select": "^2.1.6",
    "@radix-ui/react-separator": "^1.1.2",
    "@radix-ui/react-switch": "^1.1.3",
    "@radix-ui/react-tabs": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.1.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.0.2"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.8.0"
  }
}
```

Note: Check exact radix versions from `apps/web/package.json` before writing. The versions above are placeholders — use whatever web currently has.

- [ ] **Step 2: Create tsconfig.json for JSX**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Move cn() utility**

Create `packages/ui-core/src/lib/utils.ts`:
```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Move all shadcn components**

Copy each file from `apps/web/src/components/ui/` to `packages/ui-core/src/components/`:
- badge.tsx, button.tsx, card.tsx, dialog.tsx, dropdown-menu.tsx
- input.tsx, progress.tsx, scroll-area.tsx, select.tsx, tabs.tsx
- textarea.tsx, alert.tsx, toast-banner.tsx

In each file, replace `import { cn } from '@/lib/utils'` with `import { cn } from '../lib/utils.js'`.

- [ ] **Step 5: Create barrel export**

Create `packages/ui-core/src/index.ts` that re-exports everything:
```typescript
export { cn } from './lib/utils.js';
export * from './components/badge.js';
export * from './components/button.js';
export * from './components/card.js';
export * from './components/dialog.js';
export * from './components/dropdown-menu.js';
export * from './components/input.js';
export * from './components/progress.js';
export * from './components/scroll-area.js';
export * from './components/select.js';
export * from './components/tabs.js';
export * from './components/textarea.js';
export * from './components/alert.js';
export * from './components/toast-banner.js';
```

- [ ] **Step 6: Create tailwind preset**

Create `packages/ui-core/tailwind.preset.js` extracting the AICS design tokens (colors, fonts) from `apps/web/tailwind.config.ts`. This preset can be consumed by both web and market.

- [ ] **Step 7: Build and verify**

```bash
pnpm install
pnpm --filter @aics/ui-core build 2>&1 | tail -10
```
Expected: compiles with no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ui-core/
git commit -m "feat(ui-core): extract shared atomic components from apps/web"
```

---

## Chunk 2: UI Package Extraction (Wave 2)

### Task 5: ui-office Package — Extract Office Runtime Components

**Files:**
- Modify: `packages/ui-office/package.json`
- Modify: `packages/ui-office/tsconfig.json`
- Create: `packages/ui-office/src/components/**/*.tsx` (move from apps/web)
- Create: `packages/ui-office/src/hooks/*.ts` (move from apps/web)
- Create: `packages/ui-office/src/index.ts`

**Context:** This is the largest extraction — 67 component files (~5,413 lines) + 16 hooks (~2,237 lines) from `apps/web/src/`. The runtime context (`AicsRuntimeProvider`, `aics-runtime-context.tsx`) stays in `apps/web` because it wires platform-specific repos. Components that call `useAicsRuntime()` continue to work because the context is provided by the app shell above them in the React tree.

**Critical:** The `useScene` hook imports from `@aics/renderer`. The `useAicsRuntime` hook is defined in `apps/web/src/runtime/aics-runtime-context.tsx`. Components in ui-office need to import the context type — export `useAicsRuntime` and `AicsRuntimeValue` from a shared location. The cleanest approach: move the context definition to ui-office, keep only the provider implementation in apps/web.

- [ ] **Step 1: Update package.json with dependencies**

Check `apps/web/package.json` for all dependencies used by components/hooks being extracted. Key deps: `@aics/ui-core`, `@aics/renderer`, `@aics/shared-types`, `@aics/core`, `@aics/install-core`, `react`, `lucide-react`.

- [ ] **Step 2: Create tsconfig.json for JSX**

Same pattern as ui-core but with path references to workspace deps.

- [ ] **Step 3: Move runtime context definition**

Move `apps/web/src/runtime/aics-runtime-context.tsx` to `packages/ui-office/src/runtime/aics-runtime-context.ts`. This file defines the context shape + `useAicsRuntime` hook. The actual Provider stays in apps/web.

Export from ui-office: `useAicsRuntime`, `AicsRuntimeValue` type.

- [ ] **Step 4: Move components directory-by-directory**

Move each directory from `apps/web/src/components/` (except `ui/` which went to ui-core):

```
agents/          → packages/ui-office/src/components/agent/
chat/            → packages/ui-office/src/components/chat/
dashboard/       → packages/ui-office/src/components/dashboard/
employees/       → packages/ui-office/src/components/employees/
events/          → packages/ui-office/src/components/events/
install/         → packages/ui-office/src/components/install/
layout/          → packages/ui-office/src/components/layout/
library/         → packages/ui-office/src/components/library/
onboarding/      → packages/ui-office/src/components/onboarding/
office/          → packages/ui-office/src/components/office/
pitch/           → packages/ui-office/src/components/pitch/
plan/            → packages/ui-office/src/components/plan/
scene/           → packages/ui-office/src/components/scene/
server-room/     → packages/ui-office/src/components/server-room/
settings/        → packages/ui-office/src/components/settings/
error/           → packages/ui-office/src/components/error/
ErrorBoundary.tsx → packages/ui-office/src/components/error/ErrorBoundary.tsx
```

In each file:
- Replace `import { ... } from '@/components/ui/...'` → `import { ... } from '@aics/ui-core'`
- Replace `import { ... } from '@/lib/utils'` → `import { cn } from '@aics/ui-core'`
- Replace `import { useAicsRuntime } from '../../runtime/aics-runtime-context'` → `import { useAicsRuntime } from '../../runtime/aics-runtime-context.js'` (now local to package)
- Replace `import { COMPANY_ID } from '../../lib/constants'` → inline or co-locate constant
- Keep other `@aics/*` imports as-is (they're workspace packages)

- [ ] **Step 5: Move hooks**

Move all files from `apps/web/src/hooks/` to `packages/ui-office/src/hooks/`. Update internal import paths.

- [ ] **Step 6: Move runtime hooks (not the Provider)**

Move from `apps/web/src/runtime/`:
- `use-agent-states.ts` → `packages/ui-office/src/hooks/use-agent-states.ts`
- `use-event-stream.ts` → `packages/ui-office/src/hooks/use-event-stream.ts`
- `use-streaming-content.ts` → `packages/ui-office/src/hooks/use-streaming-content.ts`

Keep in apps/web: `AicsRuntimeProvider.tsx` (the actual provider with platform logic).

- [ ] **Step 7: Create barrel index.ts**

Export all components and hooks from `packages/ui-office/src/index.ts`.

- [ ] **Step 8: Build and fix type errors**

```bash
pnpm install
pnpm --filter @aics/ui-office build 2>&1
```
Iterate on import path fixes until clean compile.

- [ ] **Step 9: Commit**

```bash
git add packages/ui-office/
git commit -m "feat(ui-office): extract office runtime components and hooks from apps/web"
```

---

### Task 6: ui-market Package — Extract Market Components

**Files:**
- Modify: `packages/ui-market/package.json`
- Modify: `packages/ui-market/tsconfig.json`
- Create: `packages/ui-market/src/components/**/*.tsx` (move from apps/market)
- Create: `packages/ui-market/src/index.ts`

**Context:** `apps/market/src/components/` has 11 files (~464 lines). These are all presentational components with no runtime context dependency. Market uses plain Tailwind classes, not shadcn — so ui-market depends on ui-core for types/utilities but may not import many actual components yet.

- [ ] **Step 1: Update package.json**

Dependencies: `@aics/ui-core`, `@aics/shared-types`, react as peer dep. Check `apps/market/package.json` for any additional deps used by components (e.g., `lucide-react`).

- [ ] **Step 2: Create tsconfig.json**

Same JSX pattern.

- [ ] **Step 3: Move all components**

Move from `apps/market/src/components/`:
```
CreatorBadge.tsx    → packages/ui-market/src/components/creator/CreatorBadge.tsx
InstallButton.tsx   → packages/ui-market/src/components/install/InstallButton.tsx
InstallModal.tsx    → packages/ui-market/src/components/install/InstallModal.tsx
KindIcon.tsx        → packages/ui-market/src/components/listing/KindIcon.tsx
ListingCard.tsx     → packages/ui-market/src/components/listing/ListingCard.tsx
PermissionsPanel.tsx → packages/ui-market/src/components/package/PermissionsPanel.tsx
RatingStars.tsx     → packages/ui-market/src/components/review/RatingStars.tsx
ReviewList.tsx      → packages/ui-market/src/components/review/ReviewList.tsx
RiskBadge.tsx       → packages/ui-market/src/components/listing/RiskBadge.tsx
SearchFilters.tsx   → packages/ui-market/src/components/search/SearchFilters.tsx
VersionTable.tsx    → packages/ui-market/src/components/package/VersionTable.tsx
```

Update import paths: `@/components/...` → relative imports within package. `@/lib/format` → move format.ts to ui-market or inline.

- [ ] **Step 4: Move lib/format.ts**

If `apps/market/src/lib/format.ts` (37 lines) is only used by market components, move to `packages/ui-market/src/lib/format.ts`.

- [ ] **Step 5: Create barrel index.ts**

- [ ] **Step 6: Build and verify**

```bash
pnpm install
pnpm --filter @aics/ui-market build 2>&1
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui-market/
git commit -m "feat(ui-market): extract market components from apps/market"
```

---

## Chunk 3: App Rewiring (Wave 3)

### Task 7: Rewire apps/web → Thin Shell

**Files:**
- Modify: `apps/web/package.json` (add @aics/ui-office dep, remove moved deps)
- Modify: `apps/web/src/App.tsx` or main entry
- Rewrite: `apps/web/src/components/layout/AppLayout.tsx` (import from ui-office)
- Delete: all moved component/hook files from apps/web
- Keep: `apps/web/src/runtime/AicsRuntimeProvider.tsx`
- Keep: `apps/web/src/lib/` (tauri-specific, browser-specific, constants)
- Keep: `apps/web/src/types/`

**Context:** After extraction, apps/web should contain only:
- Entry point (main.tsx, App.tsx)
- AicsRuntimeProvider (platform-specific wiring)
- lib/ (tauri repos, browser runtime, constants)
- types/ (debug bridge, global augmentations)
- Thin AppLayout that composes ui-office components

- [ ] **Step 1: Update package.json**

Add dependencies: `@aics/ui-core`, `@aics/ui-office`
Remove dependencies that moved to ui-core/ui-office (radix packages, etc.)

- [ ] **Step 2: Delete moved files**

Remove all files from `apps/web/src/components/` except layout/AppLayout.tsx (which gets rewritten).
Remove all files from `apps/web/src/hooks/`.
Remove runtime hooks that moved (keep only AicsRuntimeProvider.tsx).

- [ ] **Step 3: Rewrite AppLayout.tsx**

AppLayout now imports everything from `@aics/ui-office`:
```typescript
import { AgentPanel, ChatDrawer, RightSidebar, StatusBar, SceneCanvas, ... } from '@aics/ui-office';
```

- [ ] **Step 4: Update AicsRuntimeProvider imports**

AicsRuntimeProvider now imports context type from `@aics/ui-office` instead of local file:
```typescript
import { AicsRuntimeContext } from '@aics/ui-office';
```

- [ ] **Step 5: Verify dev server**

```bash
pnpm --filter web dev
# Open http://localhost:5173 and verify all UI renders
```

- [ ] **Step 6: Run web tests**

```bash
pnpm --filter web test 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/
git commit -m "refactor(web): rewire to thin shell importing from @aics/ui-office"
```

---

### Task 8: Rewire apps/market → Thin Shell

**Files:**
- Modify: `apps/market/package.json`
- Modify: all page files in `apps/market/src/app/` to import from `@aics/ui-market`
- Delete: `apps/market/src/components/` (all moved to ui-market)
- Potentially delete: `apps/market/src/lib/format.ts` (if moved)

- [ ] **Step 1: Update package.json**

Add: `@aics/ui-core`, `@aics/ui-market`

- [ ] **Step 2: Update page imports**

Each page file (`page.tsx`, `search/page.tsx`, `listing/[slug]/page.tsx`, `creator/[handle]/page.tsx`) changes:
```typescript
// Before
import { ListingCard } from '@/components/ListingCard';
// After
import { ListingCard } from '@aics/ui-market';
```

- [ ] **Step 3: Delete moved files**

Remove `apps/market/src/components/` directory.

- [ ] **Step 4: Verify dev server**

```bash
pnpm --filter market dev
# Open http://localhost:3000 and verify pages render
```

- [ ] **Step 5: Commit**

```bash
git add apps/market/
git commit -m "refactor(market): rewire to thin shell importing from @aics/ui-market"
```

---

## Chunk 4: Integration Validation (Wave 4)

### Task 9: Full Validation + Final Commit

- [ ] **Step 1: Full typecheck**

```bash
pnpm -r typecheck 2>&1 | tail -20
```
Expected: 0 errors across all packages.

- [ ] **Step 2: Full test suite**

```bash
pnpm -r test 2>&1 | tail -30
```
Expected: all existing tests pass.

- [ ] **Step 3: Full build**

```bash
pnpm -r build 2>&1 | tail -20
```
Expected: all packages build successfully.

- [ ] **Step 4: Visual smoke test — web**

Start web dev server, create company with each of the 3 templates:
1. R&D Company → 8 employees, correct zones
2. Content Studio → 4 employees (Researcher, Writer, Critic, Optimizer)
3. Product Team → 4 employees (Spec Writer, Architect, Implementer, Reviewer)

Verify wizard shows 3 template cards in grid.

- [ ] **Step 5: Visual smoke test — market**

Start market dev server, verify all pages render:
- Home page with listing grid
- Search page with filters
- Listing detail page
- Creator page

- [ ] **Step 6: Tag + push**

```bash
git tag cycle1-foundation-complete
git push && git push --tags
```
