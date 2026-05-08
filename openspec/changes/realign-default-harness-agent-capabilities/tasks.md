## 1. Canonical OpenSpec Truth

- [x] 1.1 Create a new OpenSpec change that supersedes the previous active `strengthen-default-agent-harness` framing.
- [x] 1.2 Define the corrected three-layer architecture: default Offisim harness, provider SDK leaf lanes, and non-default agent employee/control-plane routes.
- [x] 1.3 Add spec deltas for default harness ownership, control-plane tiers, provider lane boundary, runtime engine profiles, provider matrix language, docs alignment, and release verification gates.

## 2. Poisoned Truth-Source Sweep

- [x] 2.1 Scan memory for stale entries that could be over-applied to current Offisim runtime architecture.
- [x] 2.2 Add an ad hoc memory correction note instead of editing historical memory directly.
- [x] 2.3 Scan active specs, archived changes, AGENTS/CLAUDE docs, provider matrix, protocol ledger, and runtime user-facing copy for overly broad Gateway-only wording.

## 3. Repo Cleanup

- [x] 3.1 Update AGENTS/CLAUDE guidance so provider SDK lane fail-closed remains true without banning verified employee agent profiles or harness control-plane routes.
- [x] 3.2 Update provider matrix and protocol ledger wording to distinguish provider lane evidence from full-agent/runtime profile evidence.
- [x] 3.3 Update SDK-lane rejection messages and host instructions so users are pointed to the default Offisim harness/gateway tools or verified tool-capable employee profiles.
- [x] 3.4 Mark the previous active change as superseded and archive it without syncing old delta specs into main specs.

## 4. Validation And Git Closure

- [x] 4.1 Run `openspec validate realign-default-harness-agent-capabilities --strict`.
  - PASS 2026-05-09: `openspec validate realign-default-harness-agent-capabilities --strict --json` returned valid=true with 0 issues.
- [x] 4.2 Run focused type/harness checks affected by copy/spec/runtime guidance changes.
  - PASS 2026-05-09: `pnpm --filter @offisim/core typecheck`, `pnpm --filter @offisim/web typecheck`, `pnpm harness:provider-adapter`, `pnpm harness:deterministic`, `pnpm harness:context`, `pnpm harness:mcp-lifecycle -- --force-build`, `pnpm harness:engine-profiles -- --force-build`, `pnpm harness:main-control-plane -- --force-build`, `pnpm harness:stream-tools`, and `pnpm harness:model-bench` passed.
- [x] 4.3 Run `gitnexus_detect_changes()` before commit.
  - PASS 2026-05-09: `gitnexus_detect_changes(scope=all)` completed. Risk is high because the commit includes the previously uncommitted harness/runtime implementation plus this boundary cleanup; affected flows are the expected browser runtime, MCP, engine profile, main harness, and provider-lane surfaces.
- [x] 4.4 Commit the cleanup and new OpenSpec on `main`.
  - PASS 2026-05-09: committed as `9951e19a feat: realign harness agent capabilities`.
- [ ] 4.5 Push `main` to `origin/main` and verify the remote advanced.
