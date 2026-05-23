## ADDED Requirements

### Requirement: DialogShell SHALL declare V3 head/body/foot padding

`DialogShell` SHALL render its three regions with V3 padding: head `16px 18px 14px`, body `16px 18px`, foot `12px 18px`. This replaces the prior `px-5 pb-3 pt-5` head, `px-5 py-4` body, and `px-5 py-3` foot. The body's vertical padding (`16px`) is unchanged from the current `py-4` (= 16px), so the base "Dialogs ship a sticky three-region layout" requirement's bottom-padding reserve note stays valid; only the horizontal padding tightens from `px-5` (20px) to `18px` and the head/foot vertical values align to V3. The existing clamp-based min/max height, tab-height stability (`DIALOG_TABS_CONTENT_CLASS` min-h floor), flex `min-h-0` chain, sticky-footer bottom-padding reserve, and the ≤1-visual-container-layer rule SHALL all remain in force.

#### Scenario: DialogShell padding is V3 16–18

- **WHEN** inspecting a rendered `DialogShell`
- **THEN** head padding is `16px 18px 14px`, body `16px 18px`, foot `12px 18px`
- **AND** clamp min/max height and tab-height stability are unchanged
