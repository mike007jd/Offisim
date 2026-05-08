## ADDED Requirements

### Requirement: Provider resolution SHALL produce a transport profile consumable by Rust

ProviderConfig resolution in the webview MAY produce a candidate provider profile create/update request that the user confirms. Credential-injecting Tauri commands SHALL NOT accept canonical base URL, allowed host set, auth header name, or final credential destination from the webview at request time.

Rust-side provider profile storage or registry SHALL be the source of truth for canonical base URL, allowed host set, auth scheme, local-endpoint flag, and endpoint path policy. Runtime construction SHALL pass only provider profile identity and endpoint intent to the Rust-owned bridge, not host policy that the webview can rewrite per request.

The resolved profile SHALL fail closed when a required host, scheme, model, or credential mode is missing. Compatibility providers SHALL stay on the gateway lane unless their provider-lane matrix entry has live evidence for a specific SDK lane.

#### Scenario: Resolved profile includes host policy
- **WHEN** runtime init resolves a MiniMax Anthropic-compatible provider
- **THEN** Rust-side provider profile storage includes `https://api.minimax.io/anthropic` as the canonical base URL and `api.minimax.io` as the allowed credential host
- **AND** Tauri requests cannot substitute another host per request

#### Scenario: Credential request carries only profile identity and endpoint intent
- **WHEN** the webview invokes the credential-injecting Tauri command for a MiniMax chat request
- **THEN** the invoke payload contains provider profile id, endpoint kind, request id, body, and non-credential metadata
- **AND** the invoke payload does not contain canonical base URL, allowed host set, auth header name, or final credential destination

#### Scenario: Missing profile fails before gateway creation
- **WHEN** a ProviderConfig cannot resolve a canonical host or credential mode
- **THEN** runtime init returns a structured unavailable state
- **AND** no `LlmGateway` or SDK adapter is created for that record

#### Scenario: Local endpoint is explicit
- **WHEN** a provider profile uses `http://localhost:1234/v1`
- **THEN** the profile is accepted only when marked as a local model endpoint
- **AND** non-local provider profiles using `http:` are rejected

### Requirement: Custom provider profile creation SHALL disclose credential destination

When a user creates or edits a custom OpenAI-compatible or Anthropic-compatible provider profile, the UI SHALL display the exact scheme, host, port, and path prefix where credentials will be sent. Provider profile creation and update SHALL be audited without storing secret bytes.

#### Scenario: User sees credential destination before saving custom provider
- **WHEN** a user creates a custom provider profile for `https://api.example.com/v1`
- **THEN** the UI displays scheme `https`, host `api.example.com`, port if any, and path prefix `/v1`
- **AND** the user confirms this destination before the profile becomes usable

#### Scenario: Provider profile audit excludes secret bytes
- **WHEN** a provider profile is created or updated
- **THEN** the audit event records profile id, scheme, host, path prefix, local-endpoint flag, and actor
- **AND** the audit event does not contain API key, bearer token, session cookie, or credential placeholder value
