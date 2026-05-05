# Release verify — fix-workspace-binding-and-employee-context-mismatch

Date: 2026-05-05

## Release app under test

- Path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Binary timestamp: `2026-05-05T19:18:42+1200`
- Binary sha256: `67fb51a75fc0ae95e2f481b1ecd666d199deffd3baac8eada5c88cb193eb8f00`
- Latest rebuilt release app after unrelated right-sidebar layout fix:
  - Binary timestamp: `2026-05-05T19:59:26+1200`
  - Binary sha256: `ea517781a7ca4e49a3b55331e88fffe292a67092a1a8d409d5d0e911397dd9c9`

## Workspace binding / builtin tool lane

- Release app project: `Codex Bound Offisim`
- Workspace root shown in app: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Prompt: `Ask Alex Chen to read README.md using read_file and report the first heading only.`
- Result: Alex Chen completed and replied `# Offisim`.
- `task_runs` evidence:
  - `task_run_id`: `tr-dc-2d0b05ed-d8c3-4799-90cb-70748c3404f3`
  - `thread_id`: `codex-bound-offisim::thread-163eb07a-9bf8-4115-adf0-242dbedcb42e::`
  - `employee_id`: `00d110ef-3668-439b-803e-6399d8d3e44f`
  - `status`: `completed`
  - `output_json`: `{"content":"\n\nThe first heading in README.md is:\n\n# Offisim"}`
- `mcp_audit_log` evidence:
  - `audit_id`: `ma-1389a830-1c2b-4a96-a87e-ac6733edd271`
  - `tool_name`: `read_file`
  - `arguments_json`: `{"path":"README.md"}`
  - `result_json` begins with `# Offisim`
  - `error`: empty
  - `created_at`: `2026-05-05T07:01:04.539Z`

## Lane comparison

- Release `.app` and desktop dev use the same `apps/web/src/lib/tauri-runtime.ts` path for builtin tools. That path resolves a project-scoped binding, passes `projectId` to `project_read_file`, `project_write_file`, and `bash_execute`, then the Rust sandbox constrains roots by that `project_id`.
- The Tauri Rust command layer is shared by release and desktop dev: `apps/desktop/src-tauri/src/builtin_tools.rs` reads `projects.workspace_root` by `project_id` and raises `no project workspace_root is bound for file/shell tools` only when no valid root exists.
- Web dev/browser mode is intentionally browser-limited for file/shell tools. `apps/web/src/lib/browser-runtime.ts` calls `createBuiltinTools({ executionMode: 'browser-limited' })`; `packages/core/src/tools/builtin/{file-read-tool,file-write-tool,bash-tool}.ts` return `null` in browser-limited mode. So this defect was not a browser file/shell execution path; the relevant risk was the Tauri desktop path used by both release and desktop dev.

## Boss roster / personnel rail parity

- Release app project: `Codex Bound Offisim`
- Personnel rail at verify time showed 10 members including `Alex Chen` and `Maya Lin`.
- Prompt: `Who is on this team? Mention Alex Chen and Maya Lin by name if they are in the personnel rail.`
- Thread: `thread-f7e74d6a-f59c-42e5-9a45-d68b7bb56ad2`
- Boss reply directly listed:
  - `Alex Chen (developer)` under enabled employees.
  - `Maya Lin (frontend)` under disabled employees.
  - Explicit confirmation: both `Alex Chen` and `Maya Lin` are on the personnel rail.
- Runtime event evidence:
  - `event_type`: `boss.route.decided`
  - `payload_json`: `{"action":"direct_reply","route":"direct_reply"}`
  - `created_at`: `2026-05-05T07:21:19.231Z`
- Event query after the pre-fix roster repro and post-fix verification found no live `boss.roster-divergence` row. Conclusion: the old repro did not have observable divergence coverage; the repair wires the event family and the deterministic parity harness now asserts the healthy path does not emit it.

## Deterministic gate

- `pnpm --filter @offisim/core typecheck` passed.
- `node scripts/harness-contract.mjs --force-build` passed with 54 scenarios.
- `boss-roster-team-chat-parity` now pins:
  - disabled personnel rail members are visible to Boss roster answers;
  - roster questions stay `direct_reply` even if the model initially returns `delegate`;
  - healthy parity does not emit `boss.roster-divergence`.

## Archive-gate notes

- Spec/task/code consistency checked on 2026-05-05 against:
  - `openspec/changes/fix-workspace-binding-and-employee-context-mismatch/specs/project-workspace-binding/spec.md`
  - `openspec/changes/fix-workspace-binding-and-employee-context-mismatch/specs/employee-node-boundaries/spec.md`
  - `apps/web/src/lib/tauri-runtime.ts`
  - `apps/desktop/src-tauri/src/builtin_tools.rs`
  - `packages/core/src/agents/boss-node.ts`
- `openspec/protocols-ledger.md` has an unrelated Tauri-row change from `add-chat-attachment-end-to-end`; this workspace/Boss change did not introduce a new protocol surface.
- Historical pre-fix evidence for the exact `workspace_root` failure was recovered from `openspec/changes/archive/2026-05-01-consolidate-runtime-context-and-skill-tool-routing/`: task 4.1 captured the release `.app` chat-visible `'no project workspace root is bound'` failure, and the Stream 2 Diagnosis Notes identify the failed layer as runtime context / builtin tool dispatch carrying no current thread into the Tauri builtin adapters. The current release build verifies the fixed behavior.
