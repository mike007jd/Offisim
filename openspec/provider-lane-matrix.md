# Offisim Verified Provider Lane Matrix

Last updated: 2026-04-22

This file is the durable evidence log for `ProviderPreset.supportedExecutionLanes`.
Only lanes backed by real harness evidence should be advertised here. Product UI
may still hide a verified lane until the current runtime host actually supports it.

## Legend

- `verified`: real Offisim harness evidence exists in this repo workflow
- `pending`: not yet verified in the current lane
- `n/a`: lane is not applicable or not implemented

## Anthropic-family presets

| Preset | Endpoint | Gateway | Claude Agent SDK | OpenAI Agents SDK | Evidence | Notes |
|---|---|---:|---:|---:|---|---|
| `anthropic-default` | Anthropic native | pending | pending | n/a | No Anthropic API key present in current workspace on 2026-04-22 | Must verify native first before closing task 2.3 |
| `minimax-intl-anthropic-coding` | `https://api.minimax.io/anthropic` | verified | verified | n/a | 2026-04-22 `gateway` smoke ok; `claude-agent-sdk` gateway smoke ok; `claude-agent-sdk` runtime smoke ok; shared-thread load hit expected `runtime.queue-depth` boundary; desktop trusted-host sidecar live verify returned `TAURI_MINIMAX_CLAUDE_HOST_OK` | `supportedExecutionLanes = ['gateway', 'claude-agent-sdk']` |
| `minimax-cn-anthropic-coding` | `https://api.minimaxi.com/anthropic` | pending | pending | n/a | CN endpoint not exercised in this workspace | Keep gateway-only in preset metadata for now |
| `kimi-cn-anthropic-coding` | `https://api.moonshot.cn/anthropic` | pending | pending | n/a | No current harness evidence | Do not expose Claude lane yet |
| `zai-shared-anthropic-coding` | `https://api.z.ai/api/anthropic` | verified | verified | n/a | 2026-04-22 `gateway` smoke ok; `claude-agent-sdk` gateway smoke ok; `claude-agent-sdk` runtime smoke ok; desktop trusted-host sidecar live verify returned `TAURI_ZAI_CLAUDE_HOST_OK` | `supportedExecutionLanes = ['gateway', 'claude-agent-sdk']` |

## OpenAI-family presets

| Preset | Endpoint | Gateway | Claude Agent SDK | OpenAI Agents SDK | Evidence | Notes |
|---|---|---:|---:|---:|---|---|
| `openai-default` | OpenAI native | pending | n/a | pending | No OpenAI API key supplied in current workspace for this change | OpenAI lane still unimplemented |
| `openrouter-openai-general` | `https://openrouter.ai/api/v1` | verified | n/a | pending | 2026-04-22 prior harness smoke returned `OPENROUTER_OK` | Keep gateway-only until OpenAI lane exists and is reverified |
| `kimi-cn-openai-general` | `https://api.moonshot.cn/v1` | pending | n/a | pending | No current harness evidence | Pending |
| `kimi-intl-openai-general` | `https://api.moonshot.ai/v1` | pending | n/a | pending | No current harness evidence | Pending |
| `zai-shared-openai-general` | `https://api.z.ai/api/paas/v4` | pending | n/a | pending | No current harness evidence | Pending |
| `zai-shared-openai-coding` | `https://api.z.ai/api/coding/paas/v4` | pending | n/a | pending | No current harness evidence | Pending |
| `gemini-openai-general` | `https://generativelanguage.googleapis.com/v1beta/openai` | pending | n/a | pending | No current harness evidence | Pending |
| `deepseek-openai-general` | `https://api.deepseek.com/v1` | pending | n/a | pending | No current harness evidence | Pending |
| `lmstudio` | `http://localhost:1234/v1` | pending | n/a | pending | Local endpoint not exercised in CI-like harness flow | User-managed local target |
| `custom` | user supplied | pending | n/a | pending | Manual endpoint only; no preset evidence allowed | Must stay gateway-only by default |

## Host exposure rule

As of 2026-04-22, product host exposure remains `gateway` only in both
`browser-limited` and `desktop-trusted`. Verified `claude-agent-sdk` evidence
stays recorded here, but product UI should keep those lanes hidden until the
desktop path supports normal tool-enabled turns without falling back into
runtime errors. `openai-agents-sdk` remains backend-harness only until task 3.x
lands.
