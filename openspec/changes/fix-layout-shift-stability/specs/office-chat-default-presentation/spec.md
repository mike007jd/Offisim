## ADDED Requirements

### Requirement: RightSidebar outer Tabs SHALL declare min-height floor

The `<Tabs>` element at `RightSidebar.tsx:71-75` (the outer Chat ↔ Tasks tabs) SHALL declare `min-h-[640px]` so that swapping between Chat and Tasks does NOT change the right rail's outer rendered height.

The 640 px floor accommodates: empty `ChatPanel` (≈ 540 px) + Workspace eyebrow + tab triggers, plus headroom for chat input growth (multi-line draft). When inner content exceeds the floor (long task lists, streaming chat) the inner scroll containers absorb the growth via `overflow-y: auto`, NOT the outer rail.

#### Scenario: RightSidebar outer Tabs minHeight is 640 px

- **WHEN** Office is open at 1440x900 with the right rail expanded
- **THEN** `getComputedStyle(rightSidebarOuterTabs).minHeight` SHALL be `'640px'`
- **AND** the right rail's outer rendered `height` SHALL be at least 640 px

#### Scenario: Chat ↔ Tasks tab swap leaves rail height unchanged

- **WHEN** the user clicks Tasks while a chat stream is active, then clicks Chat again
- **THEN** the rail's outer rendered `height` SHALL be identical before, during, and after the swap
- **AND** the surrounding workspace center (3D scene, SidePanel) SHALL NOT shift

### Requirement: RightSidebar TabsContent SHALL use `forceMount + TABS_RETAIN_STATE_CLASS` constants

Every `<TabsContent>` in `RightSidebar.tsx` (outer Chat / Tasks at lines 100, 108; inner Activity / Plan / Outputs at lines 131, 138, 145) SHALL include the `forceMount` prop and SHALL apply the `TABS_RETAIN_STATE_CLASS` constant from `@offisim/ui-core`.

Inline literals of `'data-[state=inactive]:hidden'` SHALL NOT appear in `RightSidebar.tsx`.

#### Scenario: All TabsContent declare forceMount + retain-state

- **WHEN** auditing `packages/ui-office/src/components/layout/RightSidebar.tsx`
- **THEN** every `<TabsContent>` (5 total: outer Chat / Tasks; inner Activity / Plan / Outputs) SHALL include `forceMount`
- **AND** every such `<TabsContent>` SHALL apply `TABS_RETAIN_STATE_CLASS` via `cn(...)`
- **AND** zero matches for the literal string `'data-[state=inactive]:hidden'` SHALL exist in the file

#### Scenario: Inner Tasks sub-tab swap is layout-stable

- **WHEN** the user is on the Tasks tab and swaps Activity ↔ Plan ↔ Outputs
- **THEN** the right rail's outer height SHALL NOT change between adjacent sub-tab swaps
- **AND** the active sub-tab's content scroll position SHALL be preserved on return swap

### Requirement: StreamingBubble SHALL bound height and use overscroll-contain

`StreamingBubble.tsx` SHALL declare `max-h-[60vh]`, `overflow-y-auto`, and `overscroll-contain` on the bubble outer div. The reasoning region (`StreamingBubble.ReasoningRegion`) SHALL declare a tighter bound: `max-h-[40vh]`, `overflow-y-auto`, `overscroll-contain`.

This bounds the streamed content's maximum vertical footprint and stops trackpad / mousewheel scroll-chain from rubber-banding into the rail's outer scroll container.

#### Scenario: Long streamed answer scrolls inside bubble

- **WHEN** the model streams a response exceeding 60vh of vertical text in chat
- **THEN** the bubble div SHALL render at `max-height: 60vh` with inner `overflow-y: auto`
- **AND** the chat list scroll position SHALL NOT advance past the chat list's own bottom when the user scrolls inside the bubble

#### Scenario: Reasoning region uses tighter bound

- **WHEN** the model emits reasoning content in addition to an answer
- **THEN** the reasoning region SHALL render at `max-height: 40vh` with `overflow-y: auto`
- **AND** the reasoning region SHALL NOT consume more vertical space than the answer that follows

#### Scenario: Overscroll-contain blocks rubber-band into rail

- **WHEN** the user trackpad-scrolls inside the bubble at the top edge (already at scroll top)
- **THEN** the bubble's parent chat-list scroll container SHALL NOT advance further upward
- **AND** the right rail's outer scroll container SHALL NOT advance upward either
