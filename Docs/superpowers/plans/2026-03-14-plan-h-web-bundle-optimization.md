# Plan H: Web Bundle Optimization

> **File ownership:** `packages/core/package.json`, `packages/core/src/`, `apps/web/`. Does NOT touch apps/market, apps/platform, packages/renderer, packages/ui-market, packages/ui-office.

**Goal:** Reduce web bundle size from 1.72MB by splitting @aics/core into subpath exports that enable tree-shaking, and adding lazy loading to heavy web app components.

---

## Task 1: Core Package Subpath Exports

**Files:**
- Modify: `packages/core/package.json` (add subpath exports)
- Modify: `packages/core/tsconfig.json` (if needed)
- Create: `packages/core/src/browser.ts` (browser-safe barrel)

**Spec:**
Current problem: `@aics/core` exports everything in one barrel, pulling LangGraph + OpenAI SDK + all providers into the browser bundle even when only types/events are needed.

Recent commit `48870d8` already split drizzle to `@aics/core/drizzle`. Extend this pattern:

Add subpath exports in package.json:
```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./drizzle": { "types": "./dist/drizzle.d.ts", "import": "./dist/drizzle.js" },
    "./browser": { "types": "./dist/browser.d.ts", "import": "./dist/browser.js" },
    "./events": { "types": "./dist/events/index.d.ts", "import": "./dist/events/index.js" },
    "./types": { "types": "./dist/types.d.ts", "import": "./dist/types.js" }
  }
}
```

`browser.ts` should export only browser-safe items:
- EventBus, event factories, event types
- Repository interfaces (not Drizzle implementations)
- Template definitions
- Type definitions
- Logger
- NOT: LangGraph graphs, provider SDKs, Drizzle repos, checkpoint savers

`events/index.ts` (create if not exists): Just event bus + factories + types

- [ ] Step 1: Create browser.ts barrel with browser-safe exports
- [ ] Step 2: Create events subpath barrel if needed
- [ ] Step 3: Update package.json exports map
- [ ] Step 4: Build and verify all subpaths resolve
- [ ] Step 5: Commit

---

## Task 2: Web App Lazy Loading

**Files:**
- Modify: `apps/web/src/App.tsx` or equivalent entry point
- Modify: relevant component imports in apps/web

**Spec:**
Switch heavy components to lazy imports:
```typescript
const BossDashboard = lazy(() => import('@aics/ui-office').then(m => ({ default: m.BossDashboard })));
const InterviewWizard = lazy(() => import('@aics/ui-office').then(m => ({ default: m.InterviewWizard })));
const VersionHistoryTab = lazy(() => import('@aics/ui-office').then(m => ({ default: m.VersionHistoryTab })));
```

Wrap lazy components in `<Suspense fallback={<LoadingSpinner />}>`.

Also update web app to import from `@aics/core/browser` instead of `@aics/core` where possible, to avoid pulling in server-only code.

- [ ] Step 1: Update web app imports to use @aics/core/browser where applicable
- [ ] Step 2: Add lazy() imports for heavy components
- [ ] Step 3: Add Suspense boundaries
- [ ] Step 4: Build and check bundle size reduction
- [ ] Step 5: Commit

---

## Verification
- [ ] `pnpm run build --filter @aics/core` passes
- [ ] `pnpm run build --filter @aics/web` passes
- [ ] `pnpm run typecheck --filter @aics/core --filter @aics/web`
- [ ] `pnpm run test --filter @aics/core --filter @aics/web`
- [ ] Web bundle size measurably reduced (target: under 1MB)
