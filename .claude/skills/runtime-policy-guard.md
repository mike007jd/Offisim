# Offisim Runtime Policy Guard

> **When to use:** Any change touching `gateway-factory`, `provider-*`, `adapter-*`, `recorded-call`, `message-bus`, `OrchestrationService`, or any production path that can trigger an LLM call.

This skill exists to stop vendor-direct runtime drift. If a change introduces a new AI call path, verify policy before reviewing code style.

## Hard Checks

1. Production request flow must stay inside the orchestration stack.
   - Boss/manager/employee execution belongs under `OrchestrationService`.
   - Channel adapters hand work to orchestration; they do not own bespoke model calls.

2. Every real LLM call must go through recorded wrappers.
   - Use `recordedLlmCall()` or `recordedLlmStream()`.
   - If a helper cannot use those wrappers, the default assumption is that the design is wrong.

3. Provider usage must respect the production allowlist.
   - UI presets and tests can mention vendor-direct providers.
   - Production code must satisfy the provider policy guard in `CLAUDE.md`.
   - Run `pnpm check:provider-policy` before claiming the change is safe.

4. New adapters or bridges must preserve auditability.
   - Inputs, outputs, and errors must remain visible to telemetry/audit layers.
   - Avoid hidden retry loops or sidecar model invocations outside the recorded path.

## Review Questions

- Does this change create a second way to reach a model?
- Does it bypass `recordedLlmCall()` / `recordedLlmStream()`?
- Does it let a transport or UI layer talk to a provider SDK directly?
- Does it require updating the allowlist or the provider policy test?

## Expected Verification

- `pnpm check:provider-policy`
- Targeted unit tests for the touched runtime path
- If orchestration or recording changed, add or update integration coverage
