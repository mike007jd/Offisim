## ADDED Requirements

### Requirement: Trusted hosts SHALL resolve credential strategy from product access mode

On Tauri desktop, the trusted host SHALL resolve credential strategy from the selected product's `accessMode`.

- `api-key` products SHALL continue to use the Rust-owned secret file and per-request header injection
- `local-auth` / `subscription` products SHALL use a Rust-owned resolver that reads approved local auth sources without exposing raw credential material to the webview

The webview SHALL only receive opaque availability/status results. It SHALL NOT receive raw tokens, refresh tokens, session cookies, or provider secret bytes.

#### Scenario: OpenAI API product uses the secret file path

- **WHEN** the selected product is `openai-api` with `accessMode = "api-key"`
- **THEN** Tauri injects the credential through the existing Rust-owned secret-file bridge
- **AND** the webview still sees only placeholder credential values

#### Scenario: Codex product uses a trusted local-auth resolver

- **WHEN** the selected product is `codex` with `accessMode = "local-auth"`
- **THEN** the trusted host resolves availability and auth from approved local auth sources
- **AND** no raw auth token is returned to TypeScript

### Requirement: Unsupported local-auth products SHALL fail closed on unsupported hosts

If a selected product requires trusted-host local auth and the current host cannot supply a verified resolver, runtime init SHALL fail closed with a structured unavailable state.

Offisim SHALL NOT silently rewrite such a product into an API-key product or browser-direct route.

#### Scenario: Codex is unavailable on webview-only host

- **WHEN** the selected product is `codex` and the active host is `browser-limited`
- **THEN** runtime init reports `product unavailable on current host`
- **AND** no outbound request is attempted

#### Scenario: Claude local-auth resolver missing on desktop

- **WHEN** the selected product is `claude`, the host is `desktop-trusted`, and no verified Claude auth resolver is available
- **THEN** runtime init reports a structured unavailable state
- **AND** Offisim does not silently fall back to an Anthropic API-key route
