# Offisim Brand Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace legacy `Offisim` / `offisim` branding across the repo with `Offisim` / `offisim`, including package scopes, identifiers, config keys, docs, manifests, and tests.

**Architecture:** Treat the rename as a coordinated non-behavioral refactor. Apply replacements by category rather than file-by-file: package scope and import graph first, then runtime/config identifiers, then branded strings and URLs, then generated/test fixtures. Keep directory layout stable unless a filename itself still leaks the old brand into imports or type names.

**Tech Stack:** pnpm workspace, TypeScript/React, Rust/Tauri, JSON/YAML manifests, SQL schema/docs, Vitest

---

### Task 1: Replace workspace package scopes and import specifiers

**Files:**
- Modify: workspace `package.json` files
- Modify: source files importing `@offisim/*`
- Modify: config files referencing `@offisim/*`
- Modify: `pnpm-lock.yaml`

**Step 1: Inventory package-scope usages**

Run: `rg -n "@offisim/" . --glob '!node_modules' --glob '!dist'`
Expected: all package references are listed.

**Step 2: Replace package names in workspace manifests**

Change every workspace package/app manifest name from `@offisim/*` to `@offisim/*`.

**Step 3: Replace all `@offisim/*` import and script references**

Update source, tests, Tauri commands, README/docs, and Next/Vite config to `@offisim/*`.

**Step 4: Regenerate or patch lockfile references**

Run: `pnpm install --lockfile-only`
Expected: `pnpm-lock.yaml` no longer contains `@offisim/`.

### Task 2: Replace branded identifiers and filenames in code

**Files:**
- Modify/Rename: `packages/ui-office/src/runtime/offisim-runtime-context.tsx`
- Modify/Rename: `apps/web/src/runtime/OffisimRuntimeProvider.tsx`
- Modify/Rename: `apps/web/src/runtime/OffisimRuntimeProvider.test.ts`
- Modify: all call sites using `Offisim*` identifiers
- Modify: debug bridge types and branded error/logger comments

**Step 1: Rename exported runtime/provider symbols**

Rename legacy runtime/provider symbols to `OffisimRuntime*`, plus any brand-specific error types intended as product naming.

**Step 2: Rename files whose import paths still expose the old brand**

Rename file paths containing `offisim` / `Offisim` and update all relative imports.

**Step 3: Replace remaining word-brand identifiers**

Update comments, interface names, type names, and helper names where the old brand remains and the symbol is repo-local.

### Task 3: Replace runtime/config/storage/database branding

**Files:**
- Modify: Tauri config and Rust files
- Modify: browser storage key files
- Modify: env/default URL files
- Modify: auth defaults and desktop bridge/process names

**Step 1: Replace storage keys and local identifiers**

Change keys such as `offisim-provider-config`, `offisim:mcp-servers`, and similar to `offisim-*`.

**Step 2: Replace desktop/runtime names**

Change process/app names like `offisim-desktop`, browser bridge names, and sqlite file names like `offisim.db`.

**Step 3: Replace default URLs and handles**

Change `offisim.dev`, `api.offisim.market`, `offisim-official`, and similar seeded/default branding to Offisim equivalents.

### Task 4: Replace docs, schema examples, and machine-readable examples

**Files:**
- Modify: `README.md`
- Modify: `Docs/**`
- Modify: manifest schema/example files
- Modify: SQL migration/comments where branding is product-facing

**Step 1: Update all product-facing copy**

Replace `Offisim`/`offisim` in docs, comments intended for users, and command examples.

**Step 2: Update manifest/schema/example identifiers**

Replace `offisim.employee.*`, `$id` schema URLs, vendor extension keys, and examples that still carry the old brand.

**Step 3: Keep purely historical migration numbers stable**

Do not rewrite migration filenames unless required; only change contents/comments/examples where branding is exposed.

### Task 5: Update tests and verify

**Files:**
- Modify: tests asserting old package names, keys, or strings
- Verify: desktop/web/platform critical paths

**Step 1: Update test fixtures and expectations**

Replace hardcoded `offisim` values in tests and fixtures with `offisim`.

**Step 2: Run targeted verification**

Run:
- `rg -n "\\bOffisim\\b|\\boffisim\\b|@offisim/|Offisim" . --glob '!node_modules' --glob '!dist'`
- `pnpm install --lockfile-only`
- `pnpm --filter @offisim/ui-office test -- --runInBand` or nearest supported targeted test command
- `pnpm --filter @offisim/web test` if a local package test exists

Expected:
- search finds zero unintended legacy branding
- lockfile resolves with new workspace names
- targeted tests covering renamed storage/runtime imports pass
