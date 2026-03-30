# CLAUDE.md

## Product Boundary: AI Runtime Policy

Offisim must use its own agent/runtime pipeline as the only production AI path.

The distinction is **self-developed runtime vs vendor-direct**, not about any specific transport name.
`subscription` is one currently-implemented self-developed transport adapter (ACP via `claude acp`).
Future self-developed transports are equally valid production paths.
External vendor direct connections (`openai`, `anthropic`, `openai-compat`) are NOT valid production paths.

### Hard Rules

1. **Production AI path**
   - All user-facing AI interactions must go through the Offisim agent/runtime flow
     (boss -> manager -> employee graph nodes, orchestrated by OrchestrationService).
   - Direct `gateway.chat()` from UI code is never a valid production path.

2. **Provider classification**
   - Production-allowed: self-developed transport adapters (currently `subscription`).
   - Adapter-only: `openai`, `anthropic`, `openai-compat` — these exist in `gateway-factory.ts`
     as transport-layer code for the runtime to use internally, but must not be selectable
     as production provider in UI or runtime creation.
   - Future self-developed transports can be added to the production-allowed set by updating
     this policy.

3. **No vendor-direct transport in production**
   - Do not add or retain production paths that directly call OpenAI, Anthropic, OpenRouter,
     or other vendor endpoints as a product capability.
   - Tauri desktop bridge (`provider_chat` -> `reqwest` -> vendor API) must not be a production path.
   - Browser and shared runtime code must not bypass the Offisim runtime pipeline.

4. **Unified recorded path**
   - All AI calls must be recorded through `recordedLlmCall()` / `recordedLlmStream()`.
   - All AI calls must produce audit data in `llm_calls` table and emit runtime events
     (`llm.call.started`, `llm.call.completed`, `llm.usage.recorded`).
   - System services that call `llmGateway.chat()` directly must be migrated to a
     `RecordedSystemLlmCaller` wrapper with stable `nodeName` identifiers.

5. **Test-only exceptions**
   - Direct provider calls are allowed only in isolated test/dev code (`__tests__/`, `e2e/`).
   - Test-only code must not be imported by production runtime or UI code.
   - `gateway-factory.ts` is transport-layer infrastructure — it may support all providers
     for testing and adapter development, but production runtime must guard which providers
     are accepted.

6. **Review rule**
   - Any change touching provider config, runtime creation, gateway construction, or AI
     service calls must be reviewed against this policy.
   - If a change makes vendor-direct usage easier, broader, or more implicit in production
     paths, it is the wrong direction.
