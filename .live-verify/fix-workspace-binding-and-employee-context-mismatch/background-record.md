# Background verification — fix-workspace-binding-and-employee-context-mismatch

Date: 2026-05-05

## Code evidence

- `apps/web/src/lib/tauri-runtime.ts` now resolves a project-scoped workspace binding and passes `projectId` to the Tauri builtin filesystem/shell commands.
- `apps/desktop/src-tauri/src/builtin_tools.rs` now accepts `project_id` on `project_read_file_preview`, `project_read_file`, `project_list_dir`, `project_write_file`, and `bash_execute`; when supplied, the sandbox root query is constrained to that project row.
- `packages/shared-types/src/events/workspace.ts` now carries `consumer` and expanded `missingAt` values so a future missing workspace binding names the dropping layer.
- `packages/core/src/agents/boss-node.ts` now emits `boss.roster-divergence` when Boss prompt roster assembly diverges from the active company roster.
- `packages/core/harness/scenarios/boss-roster-team-chat-parity.json` pins team-chat Boss roster parity and confirms no divergence event fires on the healthy path.

## Commands

- `pnpm --filter @offisim/ui-office typecheck` passed.
- `pnpm --filter @offisim/web typecheck` passed.
- `node scripts/harness-contract.mjs --force-build` passed: 54 scenarios.
- `pnpm --filter @offisim/ui-office build` passed.
- `pnpm --filter @offisim/desktop build` passed.
- `openspec validate fix-workspace-binding-and-employee-context-mismatch --strict` passed.
- `git diff --check` passed.

## Release build

- App path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- App timestamp: `2026-05-05T18:50:18+1200`
- Binary sha256: `dc1e7186a643838f6d8b68082024fc0efb78c5f5ec7ab5b32b0b296424fa5581`
- Refreshed app timestamp after Boss roster routing fix: `2026-05-05T19:18:42+1200`
- Refreshed binary sha256: `67fb51a75fc0ae95e2f481b1ecd666d199deffd3baac8eada5c88cb193eb8f00`

## Release live verification

- Workspace builtin lane and Boss team-chat roster parity are verified in `verify-record.md`.
