# Agent Workspace — Execution Plan (verified-iteration-loop)

Companion to `2026-07-03-agent-workspace-requirements-package.md`. Dependency-ordered
implementation backlog derived from a Phase-A parallel deep-read (6 clusters,
file:line evidence). Every phase closes with `/simplify xhigh` + `codex:review`
+ findings-verify/fix + gate re-green before the next phase (per user directive).

Branch: `feat/agent-workspace-requirements`. Checked at 2026-07-03.

## Corrected assumptions (Phase-A stale-assertion verdicts)

- **MCP is NOT unimplemented.** The full `mcp_search_tools`/`mcp_describe_tool`/
  `mcp_call` pipeline exists end-to-end, is release-bundled in
  `pi-agent-host.mjs`, and passes `harness:mcp-bridge-sdk`. Screenshot-1's apology
  is a **registration-gate gap**: the 3 meta tools register only when
  `payload.mcpTools.length>0` (entry.mjs:1093), and `buildMcpScope`
  (employee-persona.ts:176-215) returns `[]` for an employee with no
  `mcpToolGrants`. Fix = always-on discovery, not new plumbing.
- **`git init` backend already exists.** `git.rs:71-77` whitelists bare
  `git init` through the registered `git_exec` (lib.rs:225). Screenshot-9 needs
  only a renderer call site.
- **assistant-ui already supports categorized @-mentions + MCP tools**; Offisim
  disables it via `includeModelContextTools:false` + a flat employee list.
- **No navmesh libs installed** — recast-navigation / three-pathfinding are the
  requirement doc's *candidates*, not current deps. H is a new subsystem.
- **3D clothing has no garment geometry** — flat color multiply on a single
  skin-tight body mesh (GltfCharacter.tsx:472-476, docblock 55-56).

## Phase backlog (dependency order)

| # | Phase | Groups | Closes | Risk | Notes |
|---|-------|--------|--------|------|-------|
| 1 | Git non-repo → Initialize | I | shot 9 | low | backend init already whitelisted; add renderer init action + repo-state discriminator |
| 2 | MCP always-on discovery | A2 (core) | shot 1 | med | always register `mcp_search_tools` (empty-catalog aware) → actionable "no grants, set up" state; rebuild bundle; update harness guards |
| 3 | Provider settings focus | F | shots 6/7/8 | low-med | minimal add form + Advanced disclosure; summary-first; delete dead catalog types |
| 4 | Stage de-tab Computer + Browser + IA | B, C, K | shots 2/3 | med | remove `computer` from StagePrimaryTab; re-home to run trace; move setup→Settings; add `browser` capability; IA copy cleanup |
| 5 | Capability manifest + index | A1, A3, D1 | shot 1 (deepen) | high | per-thread manifest projection + unified capability index (mcp+skills+memory+deliverables) |
| 6 | Composer reference grammar | D2, E1, E2 | shot 10 | med | re-enable categorized @ palette; add /skill /tool /browser /computer /memory /output; share trigger layer with Connect |
| 7 | Memory/Vault/Output roles + provenance | D3, J | — | low-med | Vault → browsable KB; deliverables + producer/run/status; unified preview routing |
| 8 | 3D character clothing + diversity | G | shot 4 | med | modular garment geometry in build-character-assets.mjs; consume bodyType; author clips |
| 9 | Living office motion ecology | H | shot 5 | high | navmesh + pathfinding + planned walk + autonomous behavior/schedule (dedicated sim layer) |

## Per-phase gate (every phase that produces a diff)

1. Implement (subagent ownership boundaries where parallelizable; lead for small phases).
2. `/simplify xhigh` on the phase diff (lead does it).
3. `codex:review` on the cleaned diff (approved review path; NOT the token-heavy code-review workflow).
4. Verify findings vs live code; fix confirmed blockers; reject by-design with reason.
5. Re-green the relevant `pnpm validate` subset (typecheck + phase-relevant `harness:*`).
6. Live evidence for user-visible / runtime / native / data-write phases via the
   release `.app` (`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`).

## Hard rules carried in

- Pi Agent is the only runtime; no Offisim provider/model catalog regrowth.
- Renderer content flush to drawable area; no outer shell margin/gutter.
- MCP wire fields must be forwarded in BOTH Rust `sidecar_payload` AND read as
  `payload.*` in the Node host, then the 14MB `pi-agent-host.mjs` bundle rebuilt,
  or the change ships nothing (2026-07-02 projectId landmine).
- Prelaunch: disposable local state; add columns to baseline `schema.sql` +
  bump `LOCAL_SCHEMA_VERSION`, no migration chains.
- 3D live evidence = cold-start release `.app` + screenshot + logs + real
  interaction; compile-green ≠ verified.

## Close-out (after backlog drains)

- `dead-code-and-docs-cleanup-loop` (hygiene) on the accumulated diff.
- `ui-ux-audit-loop` to confirm UI/UX did not drift during development.
