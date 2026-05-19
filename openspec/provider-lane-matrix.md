# Offisim Verified Provider Lane Matrix

Last updated: 2026-05-11

This file is the durable evidence log for product-taxonomy lane exposure.
Curated provider facts such as endpoints and models come from
`provider-source-registry`; product identity, access mode, and host-gated
exposure rules come from the repo-owned product taxonomy in
`packages/ui-office/src/lib/provider-product-taxonomy.ts`. Only lanes backed by
real harness evidence should be advertised here. Product UI may still hide a
verified lane until the current runtime host actually supports it.

## Legend

- `verified`: real Offisim harness, runtime, or trusted-host evidence exists in this repo workflow
- `pending`: not yet verified in the current lane
- `unsupported`: lane is intentionally unavailable for this provider/product
- `n/a`: lane is not applicable or not implemented

## Anthropic-family provider variants

| Provider Variant | Product | Endpoint | Gateway | Claude Agent SDK | OpenAI Agents SDK | Evidence | Notes |
|---|---|---|---:|---:|---:|---|---|
| `anthropic-default` | `anthropic-api` | Anthropic native | pending | pending | unsupported | No current Anthropic API key smoke in this workspace | Native Anthropic remains optional follow-up evidence; do not imply verified API-key Claude Agent SDK support |
| `minimax-intl-anthropic-coding` | `minimax` | `https://api.minimax.io/anthropic` | verified | verified | unsupported | 2026-04-22 `gateway` smoke ok; `claude-agent-sdk` gateway smoke ok; `claude-agent-sdk` runtime smoke ok; shared-thread load hit expected `runtime.queue-depth` boundary; desktop trusted-host sidecar live verify returned `TAURI_MINIMAX_CLAUDE_HOST_OK` | Current model truth is `MiniMax-M2.7`; do not use stale `highspeed` wording. If live verify hits 401, first check `.env.local` `MINIMAX_*` injection into `VITE_MINIMAX_*` through `apps/desktop/renderer/vite.config.ts` |
| `minimax-cn-anthropic-coding` | `minimax` | `https://api.minimaxi.com/anthropic` | pending | pending | unsupported | CN endpoint not exercised in this workspace | Keep gateway-only in product metadata for now |
| `kimi-cn-anthropic-coding` | `kimi` | `https://api.moonshot.cn/anthropic` | pending | pending | unsupported | No current harness evidence | Do not expose Claude lane yet |
| `zai-shared-anthropic-coding` | `zai-glm` | `https://api.z.ai/api/anthropic` | verified | verified | unsupported | 2026-04-22 `gateway` smoke ok; `claude-agent-sdk` gateway smoke ok; `claude-agent-sdk` runtime smoke ok; desktop trusted-host sidecar live verify returned `TAURI_ZAI_CLAUDE_HOST_OK` | Second verified Anthropic-compatible sample; product taxonomy may expose `claude-agent-sdk` only on supported trusted hosts |

## OpenAI-family provider variants

| Provider Variant | Product | Endpoint | Gateway | Claude Agent SDK | OpenAI Agents SDK | Evidence | Notes |
|---|---|---|---:|---:|---:|---|---|
| `openai-default` | `openai-api` | OpenAI native | pending | unsupported | pending | Runtime + Tauri transport path implemented, but no current OpenAI API-key smoke/load/edge evidence recorded | Native OpenAI is the first OpenAI Agents SDK target; do not expose the lane as production-supported until evidence exists |
| `openrouter-openai-general` | `openrouter` | `https://openrouter.ai/api/v1` | verified | unsupported | pending | 2026-04-22 prior harness smoke returned `OPENROUTER_OK`; OpenAI Agents SDK compat path exists only behind explicit backend harness opt-in (`--provider-variant openrouter-openai-general --allow-experimental-openai-compat`) | Keep gateway-only until OpenAI Agents SDK compat is verified end to end |
| `kimi-cn-openai-general` | `kimi` | `https://api.moonshot.cn/v1` | pending | unsupported | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `kimi-intl-openai-general` | `kimi` | `https://api.moonshot.ai/v1` | pending | unsupported | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `qwen-model-studio-manual` | `qwen-model-studio` | manual OpenAI-compatible endpoint | pending | unsupported | pending | Repo-owned placeholder; manual endpoint override is required and no current harness evidence exists | Keep gateway-only in product taxonomy until curated Qwen facts and smoke evidence land |
| `zai-shared-openai-general` | `zai-glm` | `https://api.z.ai/api/paas/v4` | pending | unsupported | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `zai-shared-openai-coding` | `zai-glm` | `https://api.z.ai/api/coding/paas/v4` | pending | unsupported | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `gemini-openai-general` | `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | pending | unsupported | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `deepseek-openai-general` | `deepseek` | `https://api.deepseek.com/v1` | pending | unsupported | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `lmstudio` | `lmstudio` | `http://localhost:1234/v1` | pending | unsupported | pending | Local endpoint not exercised in CI-like harness flow; compat verification must use explicit harness opt-in | User-managed local target |
| `custom` | `custom-compatible` | user supplied | pending | unsupported | pending | Manual endpoint only; no variant evidence allowed | Must stay gateway-only by default |

## Smoke Refresh Entry Points

Generic gateway/API smoke:

- `pnpm harness:smoke -- --level gateway --provider anthropic --base-url <url> --model <model> --api-key <key>`
- `pnpm harness:smoke -- --level gateway --provider openai --base-url <url> --model <model> --api-key <key>`

Claude Agent SDK smoke:

- `pnpm harness:smoke -- --level gateway --provider anthropic --execution-lane claude-agent-sdk --base-url <url> --model <model> --api-key <key>`
- For trusted-host local auth, also build sidecars with `pnpm build:claude-agent-host` before desktop release verification.

OpenAI Agents SDK smoke:

- Native OpenAI: `pnpm harness:smoke -- --level gateway --provider openai --execution-lane openai-agents-sdk --model <model> --api-key <key>`
- OpenAI-compatible experimental refresh: add `--provider-variant <variant-id> --allow-experimental-openai-compat --base-url <url>`.

Credential notes:

- If a row lacks credentials, leave it `pending`; do not recommend provider swapping as evidence.
- MiniMax 401 must be triaged by checking whether `.env.local` `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, and `MINIMAX_MODEL` are injected into `VITE_MINIMAX_API_KEY`, `VITE_MINIMAX_BASE_URL`, and `VITE_MINIMAX_MODEL` by `apps/desktop/renderer/vite.config.ts`.

## Host exposure rule

As of 2026-05-09, model calling is owned by the default `offisim-core` harness.
`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` rows in this
matrix are model transport/provider adapter evidence, not ordinary SDK product
lanes. Unverified model transports must not expose or claim execution of file,
shell, memory, todo, skill, MCP, workspace, or builtin Offisim tool schemas.
Verified `claude-agent-sdk` rows are LLM/model transport evidence, not
permission to route local workspace tool work through SDK transport. The
`openai-agents-sdk` transport has runtime + Tauri transport support, but
full-agent product exposure remains unavailable until native OpenAI and any
third-party compat provider accumulate real smoke/load/edge evidence here and
the corresponding employee runtime profile has release `.app` proof.

Tool-capable work uses the default Offisim harness / gateway evidence path
unless a separate runtime engine capability profile or main-harness control
plane route has been verified. Model transport selection alone cannot enable
employee-agent mode, main-harness driver mode, replacement mode, SDK-native
tools, or Offisim gateway tools. Current Codex, Claude, and OpenAI engine text
profiles remain text-only preview profiles.

Separate Codex, Claude, and OpenAI `sdk-native-full-power` employee profiles
live under the `sdk-native-full-agent` tier, but none are currently promoted.
As of the 2026-05-11 review fix, `codex-engine:sdk-native-full-power` is
blocked again: the exact release `.app` hash
`bf10cbcb54a79f94cb5ed312fe2f5793179b0e35e480d9d458134991a0254525` passed the
model-pass-through and fail-closed checks, but the active Offisim selected model
is `MiniMax-M2.7`, which Codex local auth rejects with a 400 unsupported-model
error. Direct sidecar probing with `gpt-5.4` proves the Codex event bridge can
emit native shell evidence, but that is not release promotion evidence for the
currently selected product model. Codex, Claude, and OpenAI full-agent profiles
remain unavailable until they pass selected-model compatibility, native/gateway
tool success, denied-path, cancellation, checkpoint/resume, MCP,
hook/guardrail, handoff/subagent, budget, sandbox, usage/cost, rollback,
tool-bridge, benchmark, credential-boundary, and release `.app` evidence.

As of 2026-05-08, desktop credential transport is provider-profile scoped in
Tauri mode. The webview may request a provider profile id and endpoint kind, but
Rust owns canonical base URL resolution, credential host binding, auth scheme,
HTTPS/local-endpoint policy, cross-host redirect blocking, and credential-shaped
response-header filtering. Provider transport evidence must therefore name both
the product transport and the credential destination class verified in the release app.
