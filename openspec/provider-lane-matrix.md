# Offisim Verified Provider Lane Matrix

Last updated: 2026-04-22

This file is the durable evidence log for product-taxonomy lane exposure.
Curated provider facts such as endpoints and models come from
`provider-source-registry`; product identity, access mode, and host-gated
exposure rules come from the repo-owned product taxonomy in
`packages/ui-office/src/lib/provider-product-taxonomy.ts`. Only lanes backed by
real harness evidence should be advertised here. Product UI may still hide a
verified lane until the current runtime host actually supports it.

## Legend

- `verified`: real Offisim harness evidence exists in this repo workflow
- `pending`: not yet verified in the current lane
- `n/a`: lane is not applicable or not implemented

## Anthropic-family provider variants

| Provider Variant | Product | Endpoint | Gateway | Claude Agent SDK | OpenAI Agents SDK | Evidence | Notes |
|---|---|---|---:|---:|---:|---|---|
| `anthropic-default` | `anthropic-api` | Anthropic native | pending | pending | n/a | No Anthropic API key present in current workspace on 2026-04-22 | Native Anthropic remains an optional follow-up sample; it is not required for closing task 2.3 or exposing verified Anthropic-compatible products |
| `minimax-intl-anthropic-coding` | `minimax` | `https://api.minimax.io/anthropic` | verified | verified | n/a | 2026-04-22 `gateway` smoke ok; `claude-agent-sdk` gateway smoke ok; `claude-agent-sdk` runtime smoke ok; shared-thread load hit expected `runtime.queue-depth` boundary; desktop trusted-host sidecar live verify returned `TAURI_MINIMAX_CLAUDE_HOST_OK` | Verified Anthropic-compatible baseline; product taxonomy may expose `claude-agent-sdk` only on supported trusted hosts |
| `minimax-cn-anthropic-coding` | `minimax` | `https://api.minimaxi.com/anthropic` | pending | pending | n/a | CN endpoint not exercised in this workspace | Keep gateway-only in product metadata for now |
| `kimi-cn-anthropic-coding` | `kimi` | `https://api.moonshot.cn/anthropic` | pending | pending | n/a | No current harness evidence | Do not expose Claude lane yet |
| `zai-shared-anthropic-coding` | `zai-glm` | `https://api.z.ai/api/anthropic` | verified | verified | n/a | 2026-04-22 `gateway` smoke ok; `claude-agent-sdk` gateway smoke ok; `claude-agent-sdk` runtime smoke ok; desktop trusted-host sidecar live verify returned `TAURI_ZAI_CLAUDE_HOST_OK` | Second verified Anthropic-compatible sample; product taxonomy may expose `claude-agent-sdk` only on supported trusted hosts |

## OpenAI-family provider variants

| Provider Variant | Product | Endpoint | Gateway | Claude Agent SDK | OpenAI Agents SDK | Evidence | Notes |
|---|---|---|---:|---:|---:|---|---|
| `openai-default` | `openai-api` | OpenAI native | pending | n/a | pending | 2026-04-22 runtime + Tauri transport path implemented, but no OpenAI API key supplied in current workspace to record smoke/load/edge evidence | Native OpenAI is the first OpenAI Agents SDK target; do not expose the product lane until evidence exists |
| `openrouter-openai-general` | `openrouter` | `https://openrouter.ai/api/v1` | verified | n/a | pending | 2026-04-22 prior harness smoke returned `OPENROUTER_OK`; OpenAI Agents SDK compat path now exists only behind explicit backend harness opt-in (`--provider-variant openrouter-openai-general --allow-experimental-openai-compat`) | Keep gateway-only until the OpenAI lane is verified end to end |
| `kimi-cn-openai-general` | `kimi` | `https://api.moonshot.cn/v1` | pending | n/a | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `kimi-intl-openai-general` | `kimi` | `https://api.moonshot.ai/v1` | pending | n/a | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `zai-shared-openai-general` | `zai-glm` | `https://api.z.ai/api/paas/v4` | pending | n/a | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `zai-shared-openai-coding` | `zai-glm` | `https://api.z.ai/api/coding/paas/v4` | pending | n/a | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `gemini-openai-general` | `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | pending | n/a | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `deepseek-openai-general` | `deepseek` | `https://api.deepseek.com/v1` | pending | n/a | pending | No current harness evidence; compat verification must use explicit harness opt-in | Pending |
| `lmstudio` | `lmstudio` | `http://localhost:1234/v1` | pending | n/a | pending | Local endpoint not exercised in CI-like harness flow; compat verification must use explicit harness opt-in | User-managed local target |
| `custom` | `custom-compatible` | user supplied | pending | n/a | pending | Manual endpoint only; no variant evidence allowed | Must stay gateway-only by default |

## Host exposure rule

As of 2026-04-22, product host exposure remains `gateway` only in both
`browser-limited` and `desktop-trusted` for ordinary API-key products.
Verified `claude-agent-sdk` evidence stays recorded here so the product
taxonomy can selectively expose that lane for trusted-host-compatible products
and curated variants once the host/runtime combination is approved. The
`openai-agents-sdk` lane now has runtime + Tauri transport support, but
products remain gateway-only until native OpenAI and any third-party compat
provider accumulate real smoke/load/edge evidence here.
