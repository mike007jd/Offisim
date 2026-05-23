## ADDED Requirements

### Requirement: Non-wizard dialogs SHALL use the V3 `.dlg` shell padding

Every non-wizard dialog SHALL render through the `DialogShell` `.dlg` shell with V3 padding: head `16px 18px 14px`, body `16px 18px`, foot `12px 18px` (replacing the prior `px-5 pb-3 pt-5` / `px-5 py-4` / `px-5 py-3`). The size clamp, tab-height stability, and sticky-footer behavior SHALL be unchanged.

#### Scenario: Dialog padding matches V3

- **WHEN** a non-wizard dialog (e.g. Install, Keyboard Shortcuts) renders
- **THEN** its head/body/foot padding resolves to `16/18/14`, `16/18`, `12/18`
- **AND** the dialog still obeys clamp min/max height and tab-height stability

### Requirement: Wizards SHALL be migrated to consume the `--wiz-*` dark tokens and stay dark under light-only

Phase 0 SHALL be a hard prerequisite: it emits the `--wiz-*` dark tokens (`--wiz-bg`, `--wiz-surface`, `--wiz-line`, `--wiz-line-2`, `--wiz-ink-1..4`, `--wiz-blue`, `--wiz-emerald`) into `:root` but does NOT rewrite the wizard files. This change SHALL perform the actual wizard migration that consumes those tokens.

`CompanyCreationWizard` and `EmployeeCreatorOverlay` currently render dark only because their **semantic Tailwind tokens** (`bg-surface*`, `border-border-*`, `text-text-*`) still resolve dark; they hold NO hard-coded dark hex. `company-creation-wizard-preview.tsx` (the scene SVG) is the only file holding raw `var(--surface-*)` plus literal hex. Both are relight vectors: Phase 0's light-only revalue would relight them.

This change SHALL pin both vectors to the `--wiz-*` dark tokens:

1. The semantic-token surfaces of `CompanyCreationWizard` and `EmployeeCreatorOverlay` (`bg-surface*` / `border-border-*` / `text-text-*`) SHALL be migrated to `--wiz-*`.
2. The `company-creation-wizard-preview.tsx` SVG's raw `var(--surface-*)` and literal hex SHALL be migrated to `--wiz-*` (scene base/line surfaces to `--wiz-*`; brand-accent geometry hex MAY remain).

Under the light-only app, the migrated wizards SHALL remain fully dark (intentional reverse-risk; do not relight).

#### Scenario: Wizard stays dark under light-only after migration

- **WHEN** the CompanyCreationWizard or EmployeeCreatorOverlay opens in the light-only app after this change
- **THEN** its panels and preview SVG render on `--wiz-*` dark tokens with no light patches
- **AND** it does not inherit the light `--surface-*`/semantic palette that Phase 0 revalues

### Requirement: Toast / confirm / installable popovers SHALL use a V3 card skin derived from the `.toast` grammar

The lifecycle prototype does NOT define an `.icard` CSS rule (it appears only as a comment string in the states prototype). The real popover/confirm card grammar in the lifecycle prototype is `.toast`: a status-tinted surface built on `--surface-1`, `--elev-2` shadow, and a status-tinted icon chip (`--accent-surface` / matching status-surface token). This change SHALL define a `ui-core` token-based card skin from that `.toast` grammar and apply it to the toast, confirm, and installable popover surfaces, replacing the generic `bg-surface-elevated p-3` / plain `border bg-surface-elevated` defaults.

Because these surfaces use different shells, the skin tokens SHALL be applied per shell:

- `PopoverContent` (Radix popover content; one product consumer, `SopAddStepPopover`) SHALL apply the V3 card skin to its default className.
- `ToastBanner` (fixed top-of-viewport notification; 14 product consumers) SHALL align its variant table to the V3 status-tinted card tokens.
- `SkillInstallConfirmBubble` (a chat bubble that renders `<Card>`, NOT a `PopoverContent`) SHALL apply the same status-tinted tokens on its `Card` shell and SHALL NOT be converted into a `PopoverContent`.

#### Scenario: Popover / toast use the V3 card skin

- **WHEN** a toast, confirm, or installable popover (`PopoverContent` default / `ToastBanner`) renders
- **THEN** it uses the V3 card skin derived from the `.toast` grammar (token-based status-tinted surface), not the generic elevated-surface default

#### Scenario: SkillInstallConfirmBubble keeps its Card shell

- **WHEN** the `SkillInstallConfirmBubble` renders in chat
- **THEN** it renders a `<Card>` carrying the V3 status-tinted skin tokens
- **AND** it is NOT a `PopoverContent`

### Requirement: Lifecycle V3 redo SHALL ship no notification bell

No lifecycle surface (dialog, overlay, wizard, popover, toast) introduced or touched by this change SHALL render a notification bell.

#### Scenario: No bell in lifecycle surfaces

- **WHEN** auditing any lifecycle dialog / overlay / wizard / popover / toast touched by this change
- **THEN** no bell icon SHALL appear

## Notes (non-normative — out of scope, this change does not touch)

This change is visual-only (className / token). It does NOT modify, and makes no normative claim about, the following capabilities, which are owned elsewhere and are asserted as no-ops here:

- `modal-stack` (`getModalStackDepth`, `useRegisterModal`, `useTopmostEscape`) — `modal-stack.ts` SHALL NOT appear in this change's diff.
- `dialog-overlay-protocol` (close semantics, Escape routing, focus trap/restore, a11y, the single canonical `DialogShell` primitive).
- `popover-protocol` (single canonical Popover, modal-stack registration as `kind:'popover'`, z-index, dirty-check).
- install singularity (`useInstallFlow`).

If this change's diff alters the behavior of any of the above, it is out of scope and SHALL be reverted. The visual padding/skin/token edits SHALL leave those protocols' behavior byte-for-byte unchanged.
