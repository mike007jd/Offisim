## ADDED Requirements

### Requirement: Tauri LLM transport SHALL bind credentials to Rust-owned provider destinations

On Tauri desktop, any provider credential injected by Rust SHALL be bound to a Rust-owned provider profile and a declared endpoint kind. The webview SHALL NOT pass the final request URL or arbitrary credential header name to the command that injects a provider secret.

The transport request SHALL identify a provider profile and endpoint kind. Rust SHALL resolve the canonical base URL, scheme, host, auth header, and path policy from local provider profile storage or an equivalent Rust-owned registry. Default outbound provider traffic SHALL require `https:`. Local model endpoints MAY use `http://127.0.0.1` or `http://localhost` only when the provider profile is explicitly marked local.

Rust SHALL reject redirects that would carry credential material to a different host. Response headers returned to the webview SHALL filter credential-shaped and session-shaped headers, including `authorization`, `proxy-authorization`, `set-cookie`, and provider diagnostic secret headers.

#### Scenario: Webview cannot choose arbitrary credential destination
- **WHEN** a Tauri LLM request is made from the webview
- **THEN** the invoke payload does not contain a raw final `url` field for the credential-injecting command
- **AND** Rust resolves the destination from `providerProfileId` and `endpointKind`

#### Scenario: External attacker host is rejected
- **WHEN** a request attempts to route an OpenAI-compatible provider credential to `https://attacker.example/v1/chat/completions`
- **THEN** Rust rejects the request before reading or injecting the stored credential
- **AND** no outbound network request is sent to `attacker.example`

#### Scenario: Cross-host redirect strips or blocks credential
- **WHEN** the provider endpoint returns a redirect to a different host
- **THEN** Rust blocks the redirect or retries without credential material
- **AND** no `Authorization` or `x-api-key` value reaches the redirected host

#### Scenario: Response headers are filtered
- **WHEN** a provider response includes `set-cookie` or credential-shaped diagnostic headers
- **THEN** the Tauri channel sent to the webview omits those headers
- **AND** content streaming still reaches the SDK parser normally

### Requirement: Tauri capabilities SHALL scope credential-injecting commands to runtime webview

Tauri capabilities and command permissions SHALL expose credential-injecting LLM commands only to the intended main runtime window or webview. Capability rules are a first-layer IPC boundary and SHALL NOT replace command-level provider profile, host allowlist, redirect, and header filtering validation.

#### Scenario: Unprivileged webview cannot invoke credential transport
- **WHEN** a non-runtime webview attempts to invoke the credential-injecting LLM transport command
- **THEN** Tauri capability denies IPC access before command execution
- **AND** direct command-level tests still reject arbitrary provider host inputs

### Requirement: Trusted sidecar commands SHALL be project-scoped and provider-profile-scoped

Claude and Codex trusted sidecar commands SHALL NOT accept arbitrary `cwd` from the webview. They SHALL accept a project or workspace identifier, resolve the canonical workspace root in Rust, and validate that the child process cwd is inside that workspace. If no workspace is bound and the request needs local file/command context, the command SHALL fail closed with a typed unavailable error.

Claude trusted-host base URL SHALL be resolved from Rust-side provider profile state. The webview SHALL NOT pass `base_url` into the command that injects Anthropic credentials.

Each sidecar execution SHALL write an audit event containing at least `requestId`, `projectId` or explicit null reason, canonical `cwd`, `providerProfileId`, `executionLane`, and `employeeId` when available. The audit event SHALL NOT include credential bytes.

#### Scenario: Arbitrary cwd is rejected
- **WHEN** the webview requests a Claude sidecar run with cwd `/Users/me/.ssh`
- **THEN** Rust rejects the run unless that path is the canonical workspace root for the active project
- **AND** the sidecar process is not spawned

#### Scenario: Claude baseURL comes from provider profile
- **WHEN** a Claude sidecar run starts
- **THEN** `ANTHROPIC_BASE_URL` is derived from the selected Rust-side provider profile
- **AND** no request payload field can override it

#### Scenario: Sidecar audit records execution boundary
- **WHEN** a trusted sidecar child process is spawned
- **THEN** an audit event records request id, project id, cwd, provider profile id, and lane
- **AND** the audit payload contains no raw API key, auth token, or cookie
