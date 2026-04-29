## MODIFIED Requirements

### Requirement: Local tool work SHALL NOT route to external A2A employees

Requests that require Offisim-local filesystem, shell, workspace, or path-bounded project tools SHALL route only to enabled internal employees running in a tools-capable gateway context. External A2A employees and text/reasoning-only SDK lanes SHALL NOT be selected for those tasks as if they could access local project files or commands.

The "requires local tools" decision SHALL be the precomputed `state.taskToolIntent.requiresLocalTools` from the `task-tool-intent` capability, NOT a per-call regex match against task text. Routing nodes (`boss-node`, `manager-node`, `pm-planner/preflight`, `employee-direct-setup-node`) SHALL read this state field; they SHALL NOT call any text-matching helper to re-derive the same decision.

The intent detector SHALL NOT trigger on bare nouns like "file" / "command" / "命令" / "文件" or natural-prose phrases like "describe the workspace" / "file a bug" — only on verb+object pairs, explicit tool-name tokens, or explicit Chinese imperatives (see `task-tool-intent` capability for the full token contract). Free-text false positives SHALL NOT silently lock external A2A employees out of harmless conversational requests.

Direct-to-employee requests that explicitly target an external A2A employee for local file or command work SHALL fail fast with a user-facing explanation instead of sending the task to the external endpoint.

#### Scenario: Boss avoids external A2A for local tools

- **WHEN** a user asks to read, write, list, or execute commands in the project workspace (verb+object form)
- **AND** both internal and external employees are available
- **THEN** routing selects an enabled internal employee for the local-tool task
- **AND** no A2A request is sent as local filesystem evidence.

#### Scenario: External direct local-tool request fails fast

- **WHEN** direct chat targets an external A2A employee with a local file or shell request
- **THEN** the request is rejected before external dispatch
- **AND** the user is told to use an internal gateway-lane employee for project file and command work.

#### Scenario: Free-text noun does not lock out external employees

- **WHEN** a user sends a direct chat to an external A2A employee containing only bare nouns or idiomatic phrases (`describe the workspace`, `file a bug`, `请描述一下当前的命令行界面`)
- **THEN** `state.taskToolIntent.requiresLocalTools` is `false`
- **AND** the request is dispatched to the external A2A endpoint without fail-fast
- **AND** no `task.assignment.rerouted` event fires

## ADDED Requirements

### Requirement: Routing reroutes SHALL emit `task.assignment.rerouted` events

When a routing node overrides an LLM-chosen assignment for any reason — local-tool gating filtering out an external A2A pick, sanitize-fallback swapping a missing or disabled employee, planner-recommended reordering — the runtime SHALL emit a `task.assignment.rerouted` event before dispatching the rerouted assignment.

The event factory SHALL live at `packages/core/src/events/event-factories.ts` with signature `taskAssignmentRerouted(companyId, taskRunId, requestedEmployeeId, resolvedEmployeeId, reason, threadId, source)` where:
- `requestedEmployeeId: string` — the LLM/planner's original pick
- `resolvedEmployeeId: string` — the actual employee that received the dispatch
- `reason: 'requires-local-tools' | 'employee-not-found' | 'employee-disabled' | 'no-recommendation-fallback'`
- `source: 'manager' | 'pm-planner'`

The event payload SHALL be added to `packages/shared-types/src/event-types.ts` event union and SHALL appear under the `task.*` prefix for EventLog filtering. `packages/ui-office/src/lib/event-log-store.ts` `EVENT_PREFIXES` and `TYPE_PREFIX_MAP` SHALL include the new event type. The activity-log renderer SHALL format the event as `Manager rerouted <taskRunId> from <requestedName> to <resolvedName>: <reason>` (or planner-source equivalent).

The runtime SHALL also emit a structured logger record at `info` level with the same field set so headless / CI runs surface the rerouting decision.

#### Scenario: Manager rerouting emits structured event
- **WHEN** manager-node receives an LLM `decision.assignments` entry referencing an external A2A employee for a local-tool task
- **AND** the gate filters that assignment out and re-binds to an internal employee
- **THEN** a `task.assignment.rerouted` event is emitted with `source: 'manager'`, `reason: 'requires-local-tools'`, `requestedEmployeeId` of the external pick, `resolvedEmployeeId` of the internal fallback
- **AND** a logger.info entry with the same fields appears in the runtime log

#### Scenario: Activity feed surfaces the reroute
- **WHEN** the EventLog UI subscribes to the `task.*` prefix
- **THEN** the new `task.assignment.rerouted` event is delivered to the activity feed
- **AND** the renderer shows a row "Manager rerouted task <id> from <Maya> to <Alex>: Maya cannot use local tools" (or analogous formatted text)

#### Scenario: Activity feed collapses noisy reroutes
- **WHEN** the activity feed receives 5 consecutive `task.assignment.rerouted` events with the same `reason` and `source` for the same `taskRunId`
- **THEN** the renderer collapses entries 4 and 5 (and any further duplicates) under a single row with a count badge `×N` instead of stacking N full rows
