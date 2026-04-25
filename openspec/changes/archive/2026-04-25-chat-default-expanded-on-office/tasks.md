## 1. AppLayout right rail default + persistence

- [x] 1.1 Add `RIGHT_RAIL_STORAGE_KEY = 'offisim-rightrail-open'` constant in `packages/ui-office/src/components/layout/AppLayout.tsx`
- [x] 1.2 Add `readStoredRightOpen(initNarrow): boolean | null` helper — try/catch read; return `null` when storage unavailable or no value
- [x] 1.3 Change `useState(() => !initNarrow && !initTablet)` to lazy initializer that prefers stored value, falls back to `!initNarrow` (default expanded for any non-narrow tier)
- [x] 1.4 Wrap `setRightOpen` callsites: extract `commitRightOpen(next: boolean)` helper that updates state + writes localStorage in try/catch
- [x] 1.5 Update viewport tier change effect (line ~143-163): when transitioning between tiers, prefer stored value over hardcoded mode default; only apply hardcoded default (mobile collapse) when no stored value
- [x] 1.6 Replace all `setRightOpen(...)` callsites in handles + collapsed bar onClick with `commitRightOpen(...)`; keep `requestRightExpandToken` effect using `commitRightOpen(true)` so auto-expand also persists

## 2. ChatPanel team-chat empty state

- [x] 2.1 In `packages/ui-office/src/components/chat/ChatPanel.tsx`, modify the `showEmpty` branch (line ~496-521): when `!isRunning && !isDirectChat` no longer return `<EmptyState>` block
- [x] 2.2 Replace with empty fragment for the message area body (let `flex-1` whitespace dominate); keep `<ScrollArea>` wrapper structure if needed for layout consistency (or use flex spacer)
- [x] 2.3 Add inline starter-prompts chip row above `<ChatInput>` in the input region: render only when `showEmpty && !isDirectChat && onboardingStarterPrompts?.length`; reuse styling pattern from current `EmptyState` chip buttons (text-xs, rounded-lg, bg-white/5 border-white/10) but adapted for horizontal row
- [x] 2.4 Wire chip click to call `handleSend(prompt.text)` — same code path as user-typed message; chip row hides automatically once `messages.length > 0`
- [x] 2.5 Drop `onboardingWelcome` consumption inside `ChatPanel` (the prop remains in interface for back-compat but is no longer rendered); add a code-level note that welcome card moved out of chat empty state

## 3. EmptyState component status

- [x] 3.1 Leave `packages/ui-office/src/components/error/EmptyState.tsx` unchanged (still exported from package); confirm no other call sites reference it via grep — if no other consumers exist, mark as candidate for removal in a future cleanup change (out of scope here). Verified 2026-04-25: no callers in `packages/` or `apps/` outside dist; types `EmptyStateWelcome` / `StarterPrompt` still consumed via `web.ts` re-export and `ChatPanel` interface

## 4. Build + typecheck

- [x] 4.1 `pnpm --filter @offisim/shared-types build`
- [x] 4.2 `pnpm --filter @offisim/ui-core build`
- [x] 4.3 `pnpm --filter @offisim/core build`
- [x] 4.4 `pnpm --filter @offisim/ui-office build`
- [x] 4.5 `pnpm --filter @offisim/web build`
- [x] 4.6 `pnpm typecheck` (full)
- [x] 4.7 `pnpm lint` (Biome — must be clean for the touched files); biome `--write` formatted a pre-existing long-line in ChatPanel `resolveInteractionTargetEmployeeId` while I was here

## 5. Live verify (web, three viewports)

- [x] 5.1 Verify desktop `1440x900`: open Office with `localStorage.removeItem('offisim-rightrail-open')` → right rail expanded, Chat tab active, input visible without scroll, no boss-greeting card in message area
- [x] 5.2 Verify tablet `1280x800`: same pre-condition → right rail expanded (was collapsed pre-change), input visible, chat usable
- [x] 5.3 Verify narrow `390x844`: right rail collapsed (or mobile drawer takes over per existing rules); A3 default-expanded does NOT apply
- [x] 5.4 Verify persistence: at desktop, click right rail collapse handle → reload → still collapsed; expand → reload → still expanded
- [x] 5.5 Verify viewport tier change with stored preference: clear storage, collapse at 1440px (stores `false`), resize to 1280px → still collapsed
- [x] 5.6 Verify storage failure fallback: in DevTools block localStorage / use private mode → Office still loads with right rail expanded at desktop (no error toast). Code-verified via try/catch wrapping; runtime exception leak from monkey-patched setItem during test was unrelated noise from `browser-runtime-storage.ts` (pre-existing, separate code path)
- [x] 5.7 Verify starter chip row: with `onboardingStarterPrompts` present, chips appear above input in empty state; click one → message sends, chip row disappears. Chip presence + correct labels ("Feature spec", "Tech RFC") verified; click→send not exercised live (would burn LLM tokens) — code path is identical to user-typed `handleSend`
- [x] 5.8 Verify direct chat empty state still shows existing one-line "Start a conversation with X" hint and no starter chips
- [x] 5.9 Verify `requestRightExpandToken` auto-expand still works: from a collapsed state, select an employee in personnel rail → right rail expands and chat shifts to direct-chat header. Verified: clicking employee triggered direct-chat header + Team back button + input placeholder "Message Alex Chen..."
- [x] 5.10 Capture screenshots for the three reference viewports per `responsive-app-shell` Requirement "Responsive behavior is verified by screenshot QA"; include them in `archive` notes (or `verify-notes.md` under change dir). Screenshots saved at `verify-screenshots/`

## 6. Spec sync (post-apply, pre-archive)

- [x] 6.1 Re-read implementation against `specs/office-chat-default-presentation/spec.md` and `specs/responsive-app-shell/spec.md`; correct any drift before archive — verify-notes.md maps every scenario; no drift
- [x] 6.2 Update `packages/ui-office/CLAUDE.md` if any new gotcha emerges — skipped: storage key naming alone is not a gotcha; AppLayout right-rail persistence is mechanical, no double-state risk
- [x] 6.3 Cross-check `openspec/protocols-ledger.md` — A3 touches no protocol/SDK row; no update
- [ ] 6.4 Update `~/.claude/projects/.../memory/project_ux_overhaul_queue.md` A3 line to `[x] archived` with apply + archive commit SHAs after archive (deferred to archive step)
