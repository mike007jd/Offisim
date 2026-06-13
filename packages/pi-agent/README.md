# @offisim/pi-agent

Vendored, trimmed fork of [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi)
(MIT — Copyright (c) 2025 Mario Zechner; see `LICENSE`).

- **Upstream pin:** `v0.79.2` / commit `f21f3c4bbdd3868ce2a7a68019d7920b838f663b`
- **Forked:** 2026-06-13 as part of the harness kernel replacement
  (`Docs/plans/2026-06-13-pi-kernel-replacement.md`).

## What was kept

The core turn-based agent loop and its types:

- `agent.ts` — the stateful `Agent` wrapper (transcript, lifecycle events, tool
  execution, steering / follow-up queues, abort).
- `agent-loop.ts` — `runAgentLoop` / `runAgentLoopContinue` and the inner
  tool-execution loop (sequential / parallel, `beforeToolCall` / `afterToolCall`
  hooks, `transformContext`, `convertToLlm`, `getApiKey`).
- `types.ts` — `AgentTool`, `AgentToolResult`, `AgentContext`, `AgentEvent`,
  `AgentLoopConfig`, `StreamFn`, and the rest of the loop contract.

## What was removed

- The entire `harness/` subtree: session JSONL persistence, compaction /
  branch-summarization, prompt templates, system-prompt assembly, skills, and the
  Node env adapter. Offisim supplies its own bridge layer, per-message SQLite
  persistence, and budget/compaction subsystem.
- `proxy.ts` (the agent HTTP proxy utilities).

## Known upstream behaviour Offisim patches around

`runAgentLoopContinue` throws if the last transcript message is an `assistant`
message that still has an unanswered `toolCall` (dangling tool call). Offisim's
persistence layer synthesizes a tool result for dangling calls before resuming so
the ResumeBar never crashes on restart. See the bridge layer, not this package.

## Updating from upstream

Re-pin a newer tag and re-copy `agent.ts`, `agent-loop.ts`, `types.ts`, rewriting
`@earendil-works/pi-ai` → `@offisim/pi-ai` and `.ts` import extensions → `.js`.
Keep this README's pin in sync.
