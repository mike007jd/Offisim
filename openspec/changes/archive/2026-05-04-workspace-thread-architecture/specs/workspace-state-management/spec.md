## MODIFIED Requirements

### Requirement: Office session state is managed through WorkspaceSessionState

All Office workspace UI state (`viewMode`, `selectedEmployeeId`, `selectedThreadId`, `studioMode`, `dashboardOpen`, `kanbanOpen`, `marketplaceListingId`, `leftPanelWidth`, `rightPanelWidth`) SHALL be stored in the `OfficeSessionState` slice of `WorkspaceSessionState` and updated exclusively via `updateWorkspaceState('office', updater)`. `selectedThreadId` SHALL identify the currently active `chat_threads` row within the active project; it SHALL be `null` only when no project is bound or the bootstrap has not yet ensured a default thread.

For direct chat, `selectedEmployeeId` SHALL be the only UI-state input used when composing a NEW run. Once a message has been sent, that run's resolved target employee SHALL be treated as run-local state for streaming / interaction / retry purposes; later `selectedEmployeeId` changes SHALL affect only future runs and MUST NOT retarget an in-flight or pending direct-chat run. The same rule SHALL apply to the run's conversation rail identity: switching `selectedEmployeeId` after a run fails may change which rail the user is currently viewing, but it MUST NOT re-key the failed run's retry rail or move that retry's committed output onto the newly selected employee. The same rule SHALL extend to `selectedThreadId`: switching the active thread SHALL NOT retarget any in-flight or failed-run-retry's resolved thread.

#### Scenario: Reading office state

- **WHEN** any component needs to read Office UI state (e.g. whether dashboard is open, or which thread is active)
- **THEN** it SHALL read from `workspaceSessionState.office.dashboardOpen` / `workspaceSessionState.office.selectedThreadId`, not from an independent `useState` variable

#### Scenario: Writing office state

- **WHEN** any component needs to switch the active thread
- **THEN** it SHALL call `updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId: nextId }))`, not a standalone `setSelectedThreadId()` setter

#### Scenario: Office state persists across workspace switches

- **WHEN** user navigates from Office to Settings and back to Office
- **THEN** Office state (`viewMode`, `selectedEmployeeId`, `selectedThreadId`, panel widths) SHALL be preserved, except overlays (`dashboardOpen`, `kanbanOpen`, `marketplaceListingId`) which SHALL be closed on leave

#### Scenario: Direct-chat send captures the current selected employee and thread

- **WHEN** `workspaceSessionState.office.selectedEmployeeId === 'maya'` and `selectedThreadId === 'T1'` and the user sends a new direct-chat message
- **THEN** that run SHALL be created with `maya` as its target employee and `T1` as its thread
- **AND** the UI SHALL NOT re-resolve the run target or run thread from any other ref after the send begins

#### Scenario: Switching selected employee does not retarget an in-flight run

- **WHEN** a direct-chat run was sent while `selectedEmployeeId === 'maya'`, and before the run finishes the user switches the UI selection to `alex`
- **THEN** the already-started run, its pending interaction, and any retry derived from that failed run SHALL remain targeted at `maya`
- **AND** only the next newly-sent message MAY target `alex`

#### Scenario: Switching selected employee does not re-key a failed run retry rail

- **WHEN** a direct-chat run failed while `selectedEmployeeId === 'maya'`, the user then switches `selectedEmployeeId` to `alex`, and later invokes retry on the failed run
- **THEN** the failed run's retry SHALL still use Maya's conversation rail identity
- **AND** Alex becoming the current UI selection SHALL affect only what the user is looking at, not where the retry output is stored or committed

#### Scenario: Switching selectedThreadId does not retarget an in-flight or retry run

- **WHEN** a chat run was started under `selectedThreadId === 'T1'` and the user switches the active thread to `T2` before the run resolves (or before invoking retry on a failed run from T1)
- **THEN** the in-flight run and any retry derived from a T1 failed run SHALL remain bound to T1
- **AND** subsequent newly-sent messages while the thread is `T2` MAY target T2

## ADDED Requirements

### Requirement: OfficeSessionState exposes selectedThreadId in defaults and serialization

The `createDefaultSessionState()` factory SHALL return an `office` slice containing `selectedThreadId: null`. URL routing serialization / deserialization (`apps/web/src/lib/url-routing/`) SHALL round-trip `selectedThreadId` so deep links to a specific thread restore correctly. On bootstrap, when `selectedThreadId === null` and the active project has at least one `chat_threads` row, the runtime SHALL set `selectedThreadId` to the project's most-recently-updated thread.

#### Scenario: Default factory includes selectedThreadId

- **WHEN** `createDefaultSessionState()` is called
- **THEN** the returned object SHALL include `office.selectedThreadId === null`

#### Scenario: URL round-trips selectedThreadId

- **WHEN** the URL contains a thread parameter referencing thread `T1`
- **THEN** the parser SHALL set `office.selectedThreadId` to `T1`
- **AND** subsequent `office` updates that change `selectedThreadId` SHALL be reflected in the serialized URL

#### Scenario: Bootstrap selects most-recent thread

- **WHEN** the runtime mounts with `selectedThreadId === null`, an active project bound, and the project has at least one `chat_threads` row
- **THEN** `selectedThreadId` SHALL be set to the project's most-recently-updated thread before the rail renders message content
