## 1. Dependencies

- [ ] 1.1 Add `@radix-ui/react-checkbox`, `@radix-ui/react-radio-group`, `@radix-ui/react-switch`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, `@radix-ui/react-avatar` to `packages/ui-core/package.json` `dependencies` (latest stable, matching the existing `^1.x` Radix range)
- [ ] 1.2 Run `pnpm install` from repo root; commit `pnpm-lock.yaml` delta
- [ ] 1.3 Verify ui-core dist tree-shakes correctly (no Radix package brings unused submodules into ui-core bundle)

## 2. Add new primitive: `Checkbox`

- [ ] 2.1 Create `packages/ui-core/src/components/checkbox.tsx` exporting `Checkbox` based on `@radix-ui/react-checkbox` (`Root` + `Indicator`)
- [ ] 2.2 Props: `id?: string`, `checked?: boolean | 'indeterminate'`, `onCheckedChange?: (checked: boolean | 'indeterminate') => void`, `disabled?: boolean`, `name?: string`, `value?: string`, `aria-label?`, `aria-describedby?`, `className?`
- [ ] 2.3 States: default / hover (`hover:bg-white/8`) / focus-visible (`focus-visible:ring-2 focus-visible:ring-cyan-400/40`) / checked (`bg-cyan-500/20 border-cyan-400/60`) / indeterminate (same as checked, `<Minus>` icon) / disabled (`opacity-50 cursor-not-allowed`)
- [ ] 2.4 Render 16x16 box with `<Check>` / `<Minus>` from lucide-react inside `Indicator`
- [ ] 2.5 Export named: `Checkbox`. Add to `packages/ui-core/src/index.ts`
- [ ] 2.6 Optional `CheckboxField` wrapper export — `<label>` + `<Checkbox>` + label text — for the common labelled case

## 3. Add new primitive: `Radio` + `RadioGroup`

- [ ] 3.1 Create `packages/ui-core/src/components/radio.tsx` exporting `RadioGroup`, `RadioGroupItem` based on `@radix-ui/react-radio-group` (`Root` + `Item` + `Indicator`)
- [ ] 3.2 `RadioGroup` props: `value?: string`, `defaultValue?: string`, `onValueChange?: (value: string) => void`, `orientation?: 'horizontal' | 'vertical'` (default vertical), `disabled?: boolean`, `name?: string`, `loop?: boolean` (default true)
- [ ] 3.3 `RadioGroupItem` props: `value: string`, `id?: string`, `disabled?: boolean`, `aria-label?`, `className?`
- [ ] 3.4 Default visual: 16x16 circle, dot indicator on selected, same focus / hover / disabled treatments as Checkbox
- [ ] 3.5 Support `asChild` on `RadioGroupItem` so consumers can render rich card layouts (used by RuntimeBindingControl migration in 10.2)
- [ ] 3.6 Export named: `RadioGroup`, `RadioGroupItem`. Add to `index.ts`

## 4. Add new primitive: `Switch`

- [ ] 4.1 Create `packages/ui-core/src/components/switch.tsx` exporting `Switch` based on `@radix-ui/react-switch` (`Root` + `Thumb`)
- [ ] 4.2 Props: `id?: string`, `checked?: boolean`, `onCheckedChange?: (checked: boolean) => void`, `disabled?: boolean`, `name?: string`, `value?: string`, `aria-label?`, `aria-describedby?`, `size?: 'sm' | 'md'` (default md), `className?`
- [ ] 4.3 Visual: pill track 36x20 (md) or 28x16 (sm), white thumb, `bg-cyan-500/40` track when checked, `bg-white/10` when unchecked. Smooth 150ms transition on thumb position
- [ ] 4.4 States: default / hover (slight track lighten) / focus-visible / checked / disabled
- [ ] 4.5 Export named: `Switch`. Add to `index.ts`

## 5. Add new primitive: `Tooltip`

- [ ] 5.1 Create `packages/ui-core/src/components/tooltip.tsx` exporting `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` based on `@radix-ui/react-tooltip`
- [ ] 5.2 `TooltipProvider` defaults: `delayDuration={700}`, `skipDelayDuration={300}`, `disableHoverableContent={false}`
- [ ] 5.3 `TooltipContent` defaults: `side="bottom"`, `sideOffset={4}`, `align="center"`, `collisionPadding={8}`. Class: `z-50 max-w-xs rounded-md border border-white/15 bg-slate-900/95 px-2 py-1 text-xs text-slate-100 shadow-lg backdrop-blur-sm data-[state=delayed-open]:animate-in data-[state=closed]:animate-out`
- [ ] 5.4 `TooltipContent` has built-in `<Arrow>` element rendering `bg-slate-900/95` triangle
- [ ] 5.5 Export named: `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent`. Add to `index.ts`
- [ ] 5.6 Mount `<TooltipProvider delayDuration={700}>` once in `apps/web/src/App.tsx` near the root tree (around the existing `OffisimRuntimeProvider` mount); verify no second Provider in any subtree

## 6. Add new primitive: `Popover`

- [ ] 6.1 Create `packages/ui-core/src/components/popover.tsx` exporting `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverClose` based on `@radix-ui/react-popover`
- [ ] 6.2 `PopoverContent` defaults: `align="start"`, `sideOffset={4}`, `collisionPadding={8}`. Class: `z-50 min-w-[8rem] rounded-lg border border-white/15 bg-slate-900 p-3 text-slate-200 shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40`
- [ ] 6.3 Portal to `document.body` by default; expose `forceMount` / `container` props as Radix passthroughs
- [ ] 6.4 Set `role="dialog"` and `aria-modal="false"` on content (Popover is non-modal)
- [ ] 6.5 Export named: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverClose`. Add to `index.ts`

## 7. Add new primitive: `Avatar`

- [ ] 7.1 Create `packages/ui-core/src/components/avatar.tsx` exporting `Avatar`, `AvatarImage`, `AvatarFallback` based on `@radix-ui/react-avatar`
- [ ] 7.2 `Avatar` props: `size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'` (16/24/32/40/56 px; default `md`), `shape?: 'circle' | 'square'` (default circle; square = `rounded-lg`), `ring?: 'none' | 'subtle' | 'accent'` (default `subtle` = `border-white/15`; `accent` = `border-cyan-400/40`), `className?`
- [ ] 7.3 `AvatarImage` accepts `src` + `alt`; `AvatarFallback` accepts `delayMs?: number` (default 600) + children (initials or `<User>` lucide icon)
- [ ] 7.4 Default fallback styling: centered slate-400 text, font-medium; auto-sizes to Avatar size
- [ ] 7.5 Export named: `Avatar`, `AvatarImage`, `AvatarFallback`. Add to `index.ts`

## 8. Complete `Button` state matrix

- [ ] 8.1 Add `isLoading?: boolean` to `ButtonProps` interface in `packages/ui-core/src/components/button.tsx`
- [ ] 8.2 When `isLoading === true`: render `<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />` as the first child (before existing children); set `aria-busy="true"`; force `disabled` (so the underlying disabled handling kicks in); preserve text children visually so layout doesn't shift
- [ ] 8.3 Spinner color = `currentColor` so it inherits per-variant text (cyan-100 for default, red-200 for destructive, slate-300 for ghost, etc.)
- [ ] 8.4 Add dev-time check: when `import.meta.env.DEV && size === 'icon' && !ariaLabel && !ariaDescribedBy && !hasTextChildren(children)`, `console.warn('[ui-core] Button size="icon" requires aria-label or aria-describedby')`
- [ ] 8.5 Implement `hasTextChildren(children: ReactNode): boolean` helper — walks `Children.toArray()` and returns true if any descendant is a non-empty string
- [ ] 8.6 Update Button JSDoc to document `isLoading` semantics (preserves width, sets aria-busy, forces disabled)

## 9. Complete `Input` / `Textarea` / `Select` form-control matrix

- [ ] 9.1 Add `error?: boolean` and `helperText?: string` to `InputProps` extended interface in `packages/ui-core/src/components/input.tsx`
- [ ] 9.2 `Input` renders a fragment when `helperText` is set: `<input ... aria-invalid={error || undefined} aria-describedby={mergedDescribedBy} /><p id={helperId} className={cn('mt-1 text-xs', error ? 'text-red-300' : 'text-slate-400')}>{helperText}</p>`
- [ ] 9.3 `Input` border swaps to `border-red-400/60` when `error === true`; default `border-white/15` otherwise
- [ ] 9.4 `mergedDescribedBy` logic: if caller passes `aria-describedby`, append helperId with space; else use helperId alone; if no helperText, do not generate id
- [ ] 9.5 Reconcile `Input` padding from `py-1` to `py-1.5` so it baseline-aligns with `SelectTrigger`
- [ ] 9.6 Repeat 9.1-9.4 for `packages/ui-core/src/components/textarea.tsx` (props named the same)
- [ ] 9.7 Repeat 9.1-9.5 for `SelectTrigger` in `packages/ui-core/src/components/select.tsx`; pad reconciles to `py-1.5` (currently `py-2`)
- [ ] 9.8 Verify forwarded `id` works: if caller provides `id`, use it as-is; helper id is `${id}-helper`; if no caller id, both are generated via `useId()`

## 10. Complete `Badge`, `DropdownMenuItem`, `Card`, `Progress`

- [ ] 10.1 `Badge` (`packages/ui-core/src/components/badge.tsx`): add `size?: 'xs' | 'sm' | 'md'` variant axis to `cva`. `xs`: `px-1.5 py-0.5 text-[10px]`; `sm` (default): `px-2.5 py-0.5 text-xs`; `md`: `px-3 py-1 text-sm`
- [ ] 10.2 `Badge`: add `dismissible?: boolean` + `onDismiss?: () => void` (extending `BadgeProps` interface — separate from `cva` since it's behavior, not style). When `dismissible`, render an `<X className="h-3 w-3 ml-1.5">` button after children with `aria-label="Dismiss"` invoking `onDismiss`
- [ ] 10.3 `DropdownMenuItem` (`packages/ui-core/src/components/dropdown-menu.tsx`): add `variant?: 'default' | 'destructive'` to props (extends `ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>`). Destructive: `text-red-300 hover:text-red-200 focus:bg-red-500/10 focus-visible:bg-red-500/10`
- [ ] 10.4 `DropdownMenuItem`: replace `focus:bg-white/10 focus:text-slate-100` with `focus:bg-white/10 focus:text-slate-100 focus-visible:ring-2 focus-visible:ring-cyan-400/40` (Radix sets `data-highlighted` on hover and keyboard, so we keep `focus:` for the bg highlight but add `focus-visible:ring` for keyboard-only ring)
- [ ] 10.5 `Card` (`packages/ui-core/src/components/card.tsx`): add `CardFooter` forwardRef component. Class: `flex items-center gap-2 justify-end p-4 pt-0 border-t border-white/10`. Export from card.tsx and from `index.ts`
- [ ] 10.6 `Progress` (`packages/ui-core/src/components/progress.tsx`): add `size?: 'sm' | 'md' | 'lg'` (heights `h-1` / `h-2` / `h-3`; default `md` = current `h-2`)
- [ ] 10.7 `Progress`: add `tone?: 'default' | 'success' | 'warning' | 'error'` (fill colors `bg-cyan-400` / `bg-emerald-400` / `bg-amber-400` / `bg-red-400`; default `default`)
- [ ] 10.8 `Select`: split today's combined trigger-and-item file into clear lookups for `error` / `helperText` work in 9.7

## 11. a11y baseline normalization

- [ ] 11.1 `Select.tsx:17` Trigger: change `focus:outline-none focus:ring-2 focus:ring-cyan-400/40` to `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40`
- [ ] 11.2 `Select.tsx:66` Item: keep `focus:bg-white/10` (Radix uses keyboard+hover both for highlight), add `focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-inset`
- [ ] 11.3 `Dialog.tsx:41` DialogPrimitive.Close: change `focus:outline-none focus:ring-2 focus:ring-cyan-400/40` to `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40`
- [ ] 11.4 `DropdownMenu.tsx:35` Item: keep `focus:bg-white/10 focus:text-slate-100`, add `focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-inset`
- [ ] 11.5 Verify `Dialog`, `DialogShell`, `OverlayShell` all render `aria-modal="true"` + `role="dialog"` + carry `aria-labelledby` from a Title or accept `aria-label` (DialogPrimitive sets these by default; spot-check the DialogShell custom path)
- [ ] 11.6 Add a `useEffect` dev warn in `Dialog`/`DialogShell`/`OverlayShell` when neither `aria-label` nor `aria-labelledby` resolves at render time (gates on `import.meta.env.DEV`)
- [ ] 11.7 Add identical `focus-visible:` ring treatment to `RadioGroupItem`, `Checkbox`, `Switch`, `Tooltip`, `Popover` per Tasks 2-7

## 12. Migrate self-rolled UI in ui-office

- [ ] 12.1 Rewrite `packages/ui-office/src/components/sop/SopAddStepPopover.tsx` using ui-core `Popover` + `Input` + `Select` + `Textarea` + `Button`. Remove the hand-rolled outside-click + Escape effects (Popover provides these). Anchor to a virtual element via `PopoverAnchor` with the click x/y coordinates, or refactor parent to render the popover relative to the click target — choose the option that keeps the existing canvas-based positioning behavior
- [ ] 12.2 Rewrite `packages/ui-office/src/components/runtime/RuntimeBindingControl.tsx` using ui-core `RadioGroup` + `RadioGroupItem asChild`. Keep the existing card visual (title + description + unavailable hint inside each card) by using `asChild` on each item. Remove the `// biome-ignore lint/a11y/useSemanticElements` comment because the migration eliminates the workaround
- [ ] 12.3 Replace raw `<input>` (line 103) and `<textarea>` (line 101) in `packages/ui-office/src/components/employees/EmployeeQuickCard.tsx` with ui-core `Input` and `Textarea`. Verify no styling regression (Input adds `h-9` border + bg by default — adjust callers if the visual was bare)
- [ ] 12.4 Audit `packages/ui-office/src/components/install/BindingForm.tsx:58` — the `<Badge variant="error">required</Badge>` next to the field is replaced with `Input ... error helperText="required"`; remove the Badge
- [ ] 12.5 Grep `packages/ui-office/src/components` for any remaining raw `<button>` / `<input>` / `<textarea>` / `<select>`; review each with a 1-line justification or replace
- [ ] 12.6 Grep `apps/web/src/components` (and `apps/web/src` broadly) for raw `<button>` / `<input>` / `<textarea>` / `<select>`; expected zero hits per audit, confirm

## 13. Migrate `title=` tooltips to ui-core Tooltip

- [ ] 13.1 Inventory `title=` usages in `packages/ui-office/src/components`. Audit-known sites: `settings/SettingsRuntimeTab.tsx`, `settings/SettingsProviderTab.tsx`, `settings/VaultDirectorySection.tsx`, `settings/SettingsContentArea.tsx`, `settings/McpConfigPanel.tsx`, `studio/StudioProperties.tsx`, `studio/StudioPalette.tsx`, `install/FileImportTrigger.tsx`, `chat/PipelineProgress.tsx`, `chat/MessageBubble.tsx`, `office/MeetingPanel.tsx`, `chat/ChatDrawer.tsx`, `office/MeetingControls.tsx`, `deliverable/DeliverableCard.tsx`, `layout/StatusBar.tsx`, `layout/RightSidebar.tsx`, `workspace/WorkspacePageShell.tsx`, `sop/SopSidebar.tsx`, `layout/Header.tsx`, `sop/SopEmptyState.tsx`. Confirm each
- [ ] 13.2 For each `title=` on an icon-only button or status badge that conveys meaningful info, wrap in `<Tooltip><TooltipTrigger asChild>...</TooltipTrigger><TooltipContent>...</TooltipContent></Tooltip>`
- [ ] 13.3 Drop the `title=` attribute once Tooltip is in place — `title=` shows as a native browser tooltip with bad styling and no keyboard accessibility, so it is redundant
- [ ] 13.4 For `title=` on disabled-state hints (e.g. `EmptyState.disabledReason`, `RuntimeBindingControl.ENGINE_UNAVAILABLE_HINT`), wrap with Tooltip — disabled buttons don't fire mouse events but Tooltip can show via parent hover, see Radix docs

## 14. Storybook-style dev verification page (temporary)

- [ ] 14.1 Create `apps/web/src/dev/ui-core-gallery.tsx` — a one-off page mounted at route `/dev/ui-core` (gated by `import.meta.env.DEV`) that renders every primitive in every state for keyboard / screen-reader walkthroughs
- [ ] 14.2 Sections: Buttons (every variant + size + isLoading + icon-only), Form fields (Input / Textarea / Select with error + helperText), Toggles (Checkbox / Radio / Switch all states), Floating (Tooltip / Popover / Dialog / DropdownMenu), Surface (Card with CardFooter / Badge with sizes / Progress with sizes+tones), Avatar (sizes + fallback)
- [ ] 14.3 Wire route in `apps/web/src/App.tsx` only when `import.meta.env.DEV`; production build excludes the page entirely
- [ ] 14.4 Page used for manual verification (Section 16); REMOVED before archive (task 17.7)

## 15. Build + typecheck gates (serial per CLAUDE.md)

- [ ] 15.1 `pnpm --filter @offisim/shared-types build`
- [ ] 15.2 `pnpm --filter @offisim/ui-core typecheck`
- [ ] 15.3 `pnpm --filter @offisim/ui-core build`
- [ ] 15.4 `pnpm --filter @offisim/core build` (sanity — should not be affected, ui-core is downstream of core)
- [ ] 15.5 `pnpm --filter @offisim/ui-office typecheck`
- [ ] 15.6 `pnpm --filter @offisim/ui-office build`
- [ ] 15.7 `pnpm --filter @offisim/web typecheck`
- [ ] 15.8 `pnpm --filter @offisim/web build`
- [ ] 15.9 `npx biome check packages/ui-core packages/ui-office apps/web` — zero new errors (existing 10 warnings allowed); fix 2-space / single-quote / trailing-comma lapses
- [ ] 15.10 `pnpm --filter @offisim/desktop build` — release `.app` builds clean (verifies bundled `web/dist` includes Tooltip/Popover/etc.)

## 16. Live verification (browser + release Tauri)

- [ ] 16.1 Open `apps/web` dev mode (`pnpm --filter @offisim/web dev`), navigate to `/dev/ui-core` page
- [ ] 16.2 Tab through every primitive: Button (each variant), Input, Textarea, Select, Checkbox, Radio (arrow keys cycle), Switch (Space toggles), Dialog (Tab traps inside, Esc closes), DropdownMenu (arrow keys cycle, Esc closes), Tooltip (focus reveals), Popover (focus reveals, Esc closes). Confirm focus ring (cyan-400/40) ONLY appears on Tab / arrow / programmatic focus, NOT on mouse click
- [ ] 16.3 Hover-test: mouse-click each focusable element, confirm NO sticky focus ring stays after click (this is the focus-visible: contract)
- [ ] 16.4 VoiceOver pass on macOS: `Cmd+F5` to enable; navigate Checkbox / Radio / Switch / Tooltip / Popover / Dialog. Verify each announces role + state correctly (Checkbox announces "checked / unchecked / mixed", Switch announces "on / off", Dialog reads title via aria-labelledby, Tooltip content reads when trigger receives focus)
- [ ] 16.5 Contrast spot-check using browser devtools color picker: verify `text-slate-300` on `bg-slate-900` ≥ 9:1 (AAA), `text-slate-400` on `bg-white/5` over `bg-slate-900` ≥ 4.5:1 (AA), `text-red-300` on `bg-slate-900` ≥ 4.5:1 (AA). Record screenshots in tasks
- [ ] 16.6 Console check during dev page walk: verify NO new console errors or warnings except the intentional dev-warn for icon-only Button without aria-label (verify that warn fires for a deliberately-mislabeled test case)
- [ ] 16.7 Drive the migrated SopAddStepPopover — open a SOP, double-click empty canvas to add a step, verify popover opens at click coordinates, focus auto-moves to label input, Escape closes, click-outside closes, form submission creates step. Test near each viewport edge to confirm collision-aware positioning flips popover when needed
- [ ] 16.8 Drive the migrated RuntimeBindingControl — Personnel inspector → Runtime tab → confirm 4 cards render, arrow-keys cycle radios, Space selects, disabled engines (when adapter unavailable) skip in arrow nav and don't accept Space. Verify selected state visually distinct (cyan-400/40 border + cyan-50 text)
- [ ] 16.9 Drive Tooltip migrations: hover Settings tab nav (truncated), Studio palette buttons, Header status icons, SOP sidebar overflow — confirm tooltip text appears after 700ms; Tab to each and confirm tooltip appears on focus immediately (Radix default for keyboard focus is no delay)
- [ ] 16.10 Build Tauri release `.app` (`pnpm --filter @offisim/desktop build`), open the bundled `.app`, sanity-test ChatPanel + Settings + SOP add step + Personnel inspector — confirm no UI regression vs web mode

## 17. Spec / docs / archive sync

- [ ] 17.1 Cross-check `packages/ui-office/CLAUDE.md` UI/Scene/3D section — remove any documentation of hand-rolled patterns (the `<button role="radio">` workaround in RuntimeBindingControl, raw `<input>` in EmployeeQuickCard) once they're migrated; the doc should reflect the new ui-core-only state
- [ ] 17.2 Add a Cross-Cutting Facts entry in root `CLAUDE.md` if not already implied: "ui-core is the SSOT for atomic components; raw `<button>`/`<input>`/`<textarea>`/`<select>` and hand-rolled tooltips/popovers/radios are forbidden in component code (see `ui-core-component-library` capability)"
- [ ] 17.3 Verify `openspec/protocols-ledger.md` — this change touches no external protocol, so no ledger update needed; document this verification in archive notes
- [ ] 17.4 Confirm OpenSpec Archive Gate three checks:
  - **Spec consistency**: `specs/ui-core-component-library/spec.md` and `specs/ui-core-a11y-baseline/spec.md` reflect the actual delivered set (every primitive added, every state matrix entry, every focus-visible fix)
  - **Tasks consistency**: every checked `[x]` has live evidence (Section 16 records or commit reference)
  - **Doc consistency**: `packages/ui-office/CLAUDE.md` migrated-section reads correctly post-migration; no stale "hand-rolled" claims
- [ ] 17.5 Archive Gate explicit: this change does NOT touch A2A / MCP / Tauri / LangGraph / Better Auth / SKILL.md / agentskills.io protocol surfaces, so `openspec/protocols-ledger.md` does not need updating
- [ ] 17.6 Memory: update `MEMORY.md` Active Backlog to remove this change once archived; add a 1-line note that ui-core SSOT is now spec-locked
- [ ] 17.7 Delete `apps/web/src/dev/ui-core-gallery.tsx` and the `/dev/ui-core` route wiring in `App.tsx` before final archive (this was a temporary verification surface)
