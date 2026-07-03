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

## Delivered (2026-07-04)

Branch `feat/agent-workspace-requirements`. Each phase: implement → `/simplify`
(lead) → `codex:review` → verify + fix findings → gate re-green.

| Phase | Commit | Codex gate | Closes |
|---|---|---|---|
| 1 Git Initialize | `520563cf` | verified | shot 9 |
| 2 MCP always-on discovery | `2e1fd82e` | NO MATERIAL FINDINGS | shot 1 |
| 3 Provider settings focus | `8c366d6b` | NO MATERIAL FINDINGS | shots 6/7/8 |
| 4 De-tab Computer + Browser + IA | `0361fb64` | 1 LOW fixed | shots 2/3 |
| 5 Capability manifest (A1) | `db8a673a` | NO MATERIAL FINDINGS | shot 1 (deepen) |
| 6 Composer slash commands (E2/D2) | `cfe487af` | NO MATERIAL FINDINGS | shot 10 |
| 7 Output provenance (J1/J2) | `0983f114` | 1 MEDIUM fixed | — |
| hygiene deadcode | `f440a5c2` | full `pnpm validate` green | — |

Screenshot failure classes closed: **8 / 10** (1, 2, 3, 6, 7, 8, 9, 10).
Requirement groups landed: I, A1, A2, A3, B, C, E2, D2, F1, F2, F3(documented
unavailable), J1, J2, D3(memory/output roles clarified), K1/K2(partial).

Full `pnpm validate` passes on the cumulative diff (typecheck all packages, 60+
harness contracts, src-imports, agent-runtime-capabilities, knip) —
no contract broken, no dead code introduced.

## Continuation (needs a dedicated 3D effort + live release-.app verification)

These two are the requirements package's own "dedicated simulation layer"
lane — not tractable to a *verified* close in a single non-visual session,
because their acceptance is inherently live-3D (cold-start release `.app` +
Computer Use screenshots/interaction, per the hard rule "compile-green ≠
verified").

- **Phase 8 — 3D character clothing + diversity (Group G, shot 4).** Needs
  modular garment geometry (jacket/shirt/dress/trousers/shoes) authored into
  `build-character-assets.mjs` + a `clothingSet→mesh` table in `GltfCharacter`,
  consume the currently-unused `bodyType`, and live 3D screenshot evidence.
- **Phase 9 — living office motion ecology (Group H, shot 5).** Needs a
  navmesh/pathfinding subsystem (evaluate recast-navigation vs three-pathfinding),
  route `EmployeeUnit` through waypoints, planned-walk on drag, and an autonomous
  behavior/schedule layer — flowing through `projectSceneCues` to keep 2D/3D in
  sync — plus cold-start live 3D recording.

Deeper follow-ons noted along the way: the unified typed `@`-reference palette
(E1) building on `useThreadCapabilities`; the full D1 host-side skill/plugin
import; a browsable/citable Vault KB surface (D3); and deleting the dead
Offisim provider-catalog type vocabulary in `packages/shared-types/src/models.ts`
(EngineId / RuntimeEngine* / MainHarness* / ProviderProduct*) as a scoped
dead-code sweep.
