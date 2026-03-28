# Dark-Only Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove light and system theme behavior so Offisim always runs in dark mode.

**Architecture:** Keep the existing theme entry points (`ThemeProvider`, `useTheme`, `useSceneColors`) so callers do not need to change imports, but collapse their behavior to a single dark-mode path. Remove light-mode CSS tokens from the web shell so the root theme variables always match the dark-designed UI.

**Tech Stack:** React, TypeScript, Tailwind v4 theme tokens, Vitest

---

### Task 1: Lock theme context to dark

**Files:**
- Modify: `packages/ui-office/src/theme/theme-provider.tsx`
- Test: `packages/ui-office/src/__tests__/theme-provider.test.tsx`

**Step 1: Write the failing test**

Assert that the provider always resolves to `dark`, even if localStorage contains `light` or `system`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @offisim/ui-office test -- src/__tests__/theme-provider.test.tsx`

**Step 3: Write minimal implementation**

Remove light/system/storage branches from `theme-provider.tsx` and force the root class to `dark`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @offisim/ui-office test -- src/__tests__/theme-provider.test.tsx`

### Task 2: Remove light scene palette

**Files:**
- Modify: `packages/ui-office/src/theme/use-scene-colors.ts`
- Test: `packages/ui-office/src/__tests__/use-scene-colors.test.tsx`

**Step 1: Write the failing test**

Assert that changing theme no longer produces different scene colors and that the hook always returns the dark palette.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @offisim/ui-office test -- src/__tests__/use-scene-colors.test.tsx`

**Step 3: Write minimal implementation**

Delete the light palette branch and return the dark palette directly.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @offisim/ui-office test -- src/__tests__/use-scene-colors.test.tsx`

### Task 3: Remove light CSS tokens

**Files:**
- Modify: `apps/web/src/index.css`
- Verify: `pnpm --filter @offisim/web typecheck`

**Step 1: Write the failing test**

Use the previous theme tests as red coverage for dark-only behavior; CSS has no direct unit test in this repo.

**Step 2: Write minimal implementation**

Move dark token values to `:root`, remove the light-mode block, and remove unused `.dark`-only overlay selectors by making them unconditional.

**Step 3: Verify**

Run: `pnpm --filter @offisim/web typecheck`
Run: `pnpm --filter @offisim/ui-office test -- src/__tests__/theme-provider.test.tsx src/__tests__/use-scene-colors.test.tsx src/__tests__/company-creation-wizard.test.tsx`
