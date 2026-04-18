## ADDED Requirements

### Requirement: Market workspace exposes discovery entry for external A2A agents

The Market workspace SHALL render a fixed "Connect external A2A agent" entry in Explore mode (not consuming registry listing slots) and, separately, an equivalent entry at the top of Manage → Installed tab. Clicking either entry SHALL open the External Employee Install Dialog. The entry MUST NOT modify `INSTALLABLE_KINDS` (which stays `['employee']`) nor pollute the registry `ListingSummary` schema.

#### Scenario: Explore mode pinned discovery card

- **WHEN** a user with a selected company navigates to Market → Explore
- **THEN** the grid SHALL render a pinned "Connect external A2A agent" card above or at the start of the listing grid
- **AND** clicking the card SHALL open the External Employee Install Dialog in step 1 (URL input)

#### Scenario: Manage → Installed entry

- **WHEN** the user is on Market → Manage with `manageTab === 'installed'`
- **THEN** the installed-items area SHALL render an "Add external A2A agent" action above the installed list
- **AND** clicking the action SHALL open the same Install Dialog

#### Scenario: No registry listing pollution

- **WHEN** the pinned entry is rendered
- **THEN** it MUST NOT appear in `useMarketplace().results`, MUST NOT count toward `hasMore` / `isLoading`, and MUST NOT be treated as a registry asset

### Requirement: Install Dialog drives a 3-step agent card discovery → preview → confirm flow

The External Employee Install Dialog SHALL expose exactly three steps: (1) Endpoint input, (2) Agent card preview + brand/role confirmation, (3) Persist. Step transitions MUST be forward-only within one dialog session; returning to step 1 SHALL reset any cached agent card and require a fresh `Discover` click.

#### Scenario: Step 1 — endpoint input validation

- **WHEN** the dialog mounts
- **THEN** step 1 SHALL show inputs for `url` (required), `token` (optional), `agentId` (optional)
- **AND** the Discover button SHALL be disabled while `url.trim()` fails URL parsing or is missing a scheme

#### Scenario: Step 2 — preview after successful discovery

- **WHEN** Discover succeeds and the agent card validates
- **THEN** step 2 SHALL render agentCard `name`, `description`, `provider.organization`, `version`, `capabilities` summary, and `skills[]` list
- **AND** an inferred `brand_key` SHALL be preselected (see brand inference requirement)
- **AND** a role_slug select SHALL be rendered, prefilled with a brand-defaulted role (hermes → developer, codex → developer, openclaw → researcher, custom → empty forcing selection)
- **AND** a user-editable display name input SHALL be prefilled with `agentCard.name`
- **AND** a Confirm button SHALL be disabled while `role_slug` is empty or `brand_key` is unset

#### Scenario: Step 3 — confirm persists and closes

- **WHEN** the user clicks Confirm in step 2 with a valid role
- **THEN** `repos.employees.create` SHALL be called with `is_external: 1`, `a2a_url`, optional `a2a_token`, optional `a2a_agent_id`, `brand_key`, `agent_card_json: JSON.stringify(agentCard)`, `name`, `role_slug`
- **AND** after success the dialog SHALL close, emit an `employee.created` event via the runtime event bus, and surface a success toast naming the new employee

#### Scenario: Dialog dismiss cancels pending fetch

- **WHEN** the user closes the dialog (Escape, outside click, or close button) while a discovery fetch is in flight
- **THEN** the in-flight fetch SHALL be aborted (AbortController) and no employee SHALL be created

### Requirement: Agent card discovery validates v1.0 schema and classifies errors

The discovery helper `discoverAgentCard(url, token?, signal?)` SHALL fetch `{url}/.well-known/agent-card.json` and reject with a typed error in one of the following classes: `network` (fetch throws or non-2xx before body), `cors` (TypeError with `message` matching browser CORS phrasing), `invalid-json` (response body fails JSON parse), `schema` (parsed body missing required v1.0 fields), `incompatible-protocol` (no JSONRPC binding in `supportedInterfaces`). UI copy SHALL map each class to human-readable guidance.

#### Scenario: Well-formed v1.0 card resolves

- **WHEN** the server returns a 200 with a valid `A2AAgentCard` containing at least one `supportedInterfaces` entry with `protocolBinding === 'JSONRPC'`
- **THEN** discover SHALL resolve with the parsed card
- **AND** the resolved card SHALL NOT be cached between dialog openings

#### Scenario: Missing JSONRPC binding is rejected

- **WHEN** the server returns a card whose `supportedInterfaces` contains only entries with `protocolBinding !== 'JSONRPC'`
- **THEN** discover SHALL reject with class `incompatible-protocol`
- **AND** the dialog SHALL surface a message explaining the client only speaks JSON-RPC

#### Scenario: CORS failure is classified, not silent

- **WHEN** the browser blocks the fetch with a CORS-origin error (`fetch` throws TypeError)
- **THEN** discover SHALL reject with class `cors`
- **AND** the dialog SHALL instruct the user that the remote server needs to return `Access-Control-Allow-Origin` for this web origin

#### Scenario: Schema-invalid response is rejected

- **WHEN** the fetched body parses as JSON but lacks `name` or `supportedInterfaces[]`
- **THEN** discover SHALL reject with class `schema`
- **AND** no partial card SHALL be persisted to `agent_card_json`

### Requirement: Brand inference maps agent card to BrandRegistry with explicit fallback

`inferBrandKey(agentCard)` SHALL derive an `ExternalBrandVariant` from `agentCard.name` and `agentCard.provider?.organization` by lowercase substring match against the canonical brand keys `hermes | openclaw | codex`, returning the first match. If no canonical brand matches, it SHALL return `'custom'`. The result MUST appear in the preview as a pre-selected value that the user can override from a full select of `ExternalBrandVariant`.

#### Scenario: Exact brand-name match

- **WHEN** `agentCard.name` is `"Hermes"` or `agentCard.provider.organization` equals `"OpenClaw"`
- **THEN** `inferBrandKey` SHALL return `'hermes'` or `'openclaw'` respectively

#### Scenario: Case-insensitive substring match

- **WHEN** `agentCard.name` is `"codex-helper"` or `"OpenClaw Deep Research"`
- **THEN** `inferBrandKey` SHALL return `'codex'` or `'openclaw'` via case-insensitive substring detection

#### Scenario: Unknown brand falls back to custom

- **WHEN** neither the name nor the provider organization matches a canonical key
- **THEN** `inferBrandKey` SHALL return `'custom'`
- **AND** the dialog SHALL make this visible to the user (label/copy) so the override intent is clear

#### Scenario: User override persists

- **WHEN** the inferred brand is `'custom'` and the user selects `'hermes'` from the brand select
- **THEN** Confirm SHALL persist `brand_key: 'hermes'` regardless of the inferred value

### Requirement: Settings workspace exposes an External Employees management tab

`SettingsTab` union SHALL be extended to include `'external'`. `SettingsTabNav` SHALL render a new tab labeled "External Employees" and `SettingsWorkspaceSurface` SHALL render a `SettingsExternalTab` panel listing every employee where `is_external === 1` scoped to the active company. Each row SHALL expose Refresh-card, Edit-token, and Disconnect actions. The existing workspace back-navigation (`DEFAULT_SETTINGS_STATE`) SHALL keep `activeTab === 'provider'` as the default.

#### Scenario: Tab nav renders new entry

- **WHEN** the Settings workspace mounts for a company that has at least one external employee
- **THEN** the tab nav SHALL show an "External Employees" tab alongside Provider / Runtime / MCP

#### Scenario: List shows every external employee

- **WHEN** the tab is active and `repos.employees.findByCompany(activeCompanyId)` returns rows with `is_external === 1`
- **THEN** the panel SHALL render one card per row displaying `name`, resolved brand displayName, `a2a_url`, and `agent_card_json.name` fallback
- **AND** internal employees (`is_external === 0`) SHALL NOT appear in this list

#### Scenario: Refresh-card re-fetches the agent card

- **WHEN** the user clicks Refresh on an external-employee row
- **THEN** the UI SHALL re-run `discoverAgentCard(row.a2a_url, row.a2a_token)` and on success persist the new `agent_card_json` via `repos.employees.update`
- **AND** on error the UI SHALL surface the classified error without mutating the row

#### Scenario: Disconnect removes the employee

- **WHEN** the user confirms Disconnect on an external-employee row
- **THEN** `repos.employees.delete(row.employee_id)` SHALL be called
- **AND** the Office scene SHALL cease rendering the brand avatar on next state snapshot (driven by existing scene subscribers)

### Requirement: Persisted external employee contract matches dispatch and render contracts

On confirm, the created employee row SHALL satisfy the contracts already defined by `external-employee-a2a-dispatch` and `external-employee-brand-avatars`: `is_external === 1`, `a2a_url` non-null, `brand_key` one of `hermes | openclaw | codex | custom`, `agent_card_json` a JSON string of the discovered card. No other fields SHALL be introduced by this change; schema-level evolution is out of scope here.

#### Scenario: Row roundtrip to dispatch path

- **WHEN** a newly installed external employee receives a task assignment
- **THEN** `employee-node` SHALL route through `runEmployeeA2A` based on `is_external === 1`
- **AND** the A2A client SHALL use `a2a_url`, `a2a_token`, and `a2a_agent_id` from the persisted row

#### Scenario: Row roundtrip to render path

- **WHEN** the same employee is rendered in the office scene or listings
- **THEN** `resolveBrand(employee)` SHALL return an `external` resolution with the correct `BrandEntry`
- **AND** 2D canvas and 3D scene SHALL branch to the brand asset (or custom fallback when `brand_key === 'custom'`)
