## ADDED Requirements

### Requirement: Full-agent trusted hosts SHALL preserve desktop credential isolation

Any Claude, Codex, OpenAI, or third-party full-agent trusted-host route SHALL use the same Rust-owned credential-isolation boundary as desktop LLM transport. Provider secrets, local-auth tokens, refresh tokens, session cookies, and subscription credentials SHALL NOT cross the Rust-to-JS boundary, appear in renderer contracts, or be written to activity/debug payloads.

Full-agent evidence SHALL record credential destination class and auth strategy without exposing secret bytes.

#### Scenario: Full-agent child receives credentials only inside trusted host

- **WHEN** a verified full-agent profile dispatches through a Tauri trusted host command
- **THEN** raw credential material is resolved and injected only inside the Rust trusted host or child-process environment
- **AND** TypeScript, renderer state, activity events, and completion evidence contain only opaque status and destination class

#### Scenario: Abort cancels the trusted host

- **WHEN** a full-agent model turn, native tool, MCP call, or sidecar request is cancelled
- **THEN** the matching Rust abort command cancels the in-flight request or child process
- **AND** no post-cancel stream, tool, or credential-bearing output is emitted

#### Scenario: Credential leakage blocks release gate

- **WHEN** release `.app` verification or logs show provider secret bytes, local-auth token bytes, or credential-shaped response headers crossing into JS-visible payloads
- **THEN** the full-agent profile and default harness release gate fail
- **AND** the profile remains unavailable
