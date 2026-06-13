/**
 * Offisim fork of `@earendil-works/pi-agent-core` (upstream `earendil-works/pi`,
 * MIT, pinned at v0.79.2 / commit f21f3c4).
 *
 * Only the core turn-based agent loop is vendored: `Agent`, `runAgentLoop`,
 * `runAgentLoopContinue`, and the loop/tool/event types. The upstream `harness/`
 * subtree (session JSONL persistence, compaction, prompt templates, Node env) and
 * `proxy.ts` are intentionally omitted — Offisim supplies its own bridge layer,
 * persistence (per-message SQLite), and budget/compaction subsystem. See README.
 */

export * from "./agent.js";
export * from "./agent-loop.js";
export * from "./types.js";
