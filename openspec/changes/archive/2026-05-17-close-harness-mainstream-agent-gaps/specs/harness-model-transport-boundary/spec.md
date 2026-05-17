## ADDED Requirements

### Requirement: Anthropic-route transport SHALL use ephemeral prompt caching (G01)

The model transport boundary SHALL place a bounded set of ephemeral `cache_control` breakpoints on the stable request prefix when the active provider supports Anthropic prompt caching. Breakpoints SHALL cover the system-prompt prefix, the tool-definition block, and a single rolling breakpoint on the last stable conversation message. Breakpoints SHALL NOT be placed on a volatile suffix that changes every turn.

A provider that does not support Anthropic prompt caching SHALL be gated behind a per-provider capability flag and SHALL no-op (never error, never send Anthropic-only cache fields to an incompatible endpoint).

#### Scenario: Anthropic request carries cache breakpoints

- **WHEN** the default harness sends a multi-turn Anthropic-route request through the transport boundary
- **THEN** the serialized request marks the system prefix, tool block, and one rolling conversation message with ephemeral `cache_control`
- **AND** no breakpoint is placed on a per-turn volatile suffix

#### Scenario: Unsupported provider does not receive cache fields

- **WHEN** the active provider's capability flag reports no prompt-caching support (e.g. an OpenAI-compatible endpoint)
- **THEN** the request is sent with no `cache_control` fields
- **AND** the transport does not raise an error or downgrade the request

### Requirement: Transport SHALL account cache-read and cache-creation tokens (G01)

`LlmUsage` SHALL include `cacheReadInputTokens` and `cacheCreationInputTokens`. The transport SHALL parse these from provider usage payloads, persist them with the recorded call, and the cost service SHALL price cache-read and cache-creation tokens distinctly from uncached input tokens.

#### Scenario: Cache tokens are parsed and priced

- **WHEN** a cached Anthropic response returns cache-read/creation token counts in its usage payload
- **THEN** the recorded call persists `cacheReadInputTokens` and `cacheCreationInputTokens`
- **AND** the cost calculation prices cache-read and cache-creation tokens at their distinct rates rather than as full-price input

#### Scenario: Optional live cache hit shows a token delta

- **WHEN** Anthropic credentials are supplied and the same stable prefix is sent on two consecutive turns against a caching-capable provider
- **THEN** the second turn's recorded usage shows non-zero cache-read tokens
- **AND** the reported input cost for the cached prefix is lower than the first turn

### Requirement: Transport retry classification SHALL cover connection, directive, and mid-stream overload (G07)

The transport SHALL treat provider connection/timeout errors as recoverable, honor a `Retry-After` header (overriding computed backoff), honor a server `x-should-retry` directive, and detect a mid-stream overloaded error body even when the SDK does not surface it as a status code.

#### Scenario: Connection error is retried

- **WHEN** a request fails with a connection/timeout error that has no HTTP status
- **THEN** the transport classifies it as recoverable and retries with backoff
- **AND** it does not treat the missing status as non-retryable

#### Scenario: Retry-After is honored

- **WHEN** a rate-limited response includes a `Retry-After` header
- **THEN** the next attempt waits at least the header-specified delay
- **AND** the header delay overrides the computed/backoff-capped delay

#### Scenario: Mid-stream overload is detected

- **WHEN** a streaming response carries an overloaded error body without a 529 status
- **THEN** the transport classifies it as a retryable overload
- **AND** the run does not surface a malformed-stream failure for that case

### Requirement: Streaming transport SHALL enforce an inactivity watchdog (G07)

The streaming transport SHALL abort a stream that produces no event within a bounded inactivity window, in addition to any total-duration deadline.

#### Scenario: Stalled stream is aborted on idle

- **WHEN** a stream opens then produces no event for longer than the inactivity window
- **THEN** the transport aborts the scoped request before the total-duration deadline
- **AND** the run receives a typed timeout outcome rather than hanging for the full deadline

### Requirement: Model resolution SHALL degrade instead of hard-failing (G07)

Model resolution SHALL expose a deterministic fallback model and SHALL downgrade to it after a bounded number of consecutive provider capacity errors, rather than returning a null gateway that hard-fails the run.

#### Scenario: Unknown or capacity-failed model falls back

- **WHEN** a model id cannot be resolved, or the resolved model returns repeated consecutive capacity errors
- **THEN** resolution returns the deterministic fallback model
- **AND** the run continues on the fallback instead of terminating with a null-gateway crash
