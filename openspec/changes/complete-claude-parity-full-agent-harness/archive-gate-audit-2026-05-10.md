# Archive Gate Audit - 2026-05-10

Change: `complete-claude-parity-full-agent-harness`

## 2026-05-11 Correction

This audit is superseded for Codex full-agent promotion status. The review-fix pass fixed the model-pass-through, evidence-family, and runtime-route-isolation findings, then rebuilt and verified the release `.app`.

The corrected production decision is: no SDK-native full-agent profile is currently promoted. `codex-engine:sdk-native-full-power` is `blocked` because the release app now passes the selected model `MiniMax-M2.7` to Codex, and Codex local auth rejects it as unsupported. Current evidence is `review-fix-evidence-2026-05-11.md`; old 2026-05-10 rows below are historical unless explicitly updated.

## Objective Restatement

The objective is to finish the OpenSpec change requirements for Claude parity full-agent harness work. Concrete success means:

- Default `offisim-core` harness has code, deterministic gates, release `.app` evidence, and truthful docs.
- Full-agent, gateway-bridged, driver, and replacement routes are implemented as gated profiles/control-plane concepts, not ordinary SDK lanes.
- No profile is presented as production available without deterministic, benchmark, credential, sandbox, rollback, and release evidence.
- OpenSpec truth sources, provider matrix, root guidance, runtime UI copy, stale-memory correction, and release evidence agree.
- Archive is allowed only when all completed work is checked and any intentionally unshipped release work is explicitly named as a blocker.

## Prompt-To-Artifact Checklist

| Requirement / named item | Evidence inspected | Status |
| --- | --- | --- |
| Change artifacts: `proposal.md`, `design.md`, `specs/**/*.md`, `tasks.md` | `openspec status --change complete-claude-parity-full-agent-harness --json` reports schema `spec-driven`, all artifacts `done`. | Satisfied |
| Task progress manifest | `openspec instructions apply --change complete-claude-parity-full-agent-harness --json` must report `92/92` after final Codex full-agent release evidence and this archive audit update. | Satisfied |
| Truth baseline tasks 1.1-1.11 | `openspec/harness-capability-map.md`, `openspec/provider-lane-matrix.md`, `openspec/protocols-ledger.md`, `reference-feature-map.md`, stale truth report, root guidance, and memory correction note are present or updated in this change. | Satisfied |
| Default harness floor tasks 2.1-2.12 | Backend gates and completion evidence families are recorded in `openspec/harness-capability-map.md`; release `.app` evidence for local read, denied path, completion, and cancellation is recorded in `release-app-verify-2026-05-10.md`. | Satisfied |
| Full-agent profile model tasks 3.1-3.6 | `RuntimeEngineCapabilityProfile` model distinguishes text-only, gateway-bridged, sdk-native-full-agent, driver, and replacement; unavailable profiles list missing gates; `harness:engine-profiles` passed 13/13. | Satisfied for gated model |
| SDK-native adapter tasks 4.1-4.11 | Normalized native activity envelope, partial-state handling, trusted-host and credential boundary contracts are implemented and documented; Codex event bridge has sidecar evidence, but the release profile is blocked by selected-model compatibility. | Satisfied for bridge; no SDK-native full-agent is promoted |
| Gateway/evidence tasks 5.1-5.7 | Completion verifier and contract harness distinguish native, gateway-bridged, pure-text, artifact, MCP, shell, browser/desktop, memory/todo/skill, and mislabeled evidence cases. | Satisfied |
| Control plane tasks 6.1-6.7 | `harness:main-control-plane` passed 9/9; policy requires explicit owner/profile/rollback and blocks self-promotion from SDK health. | Satisfied |
| Personnel/runtime UX tasks 7.1-7.7 | Release `.app` Computer Use observations recorded Personnel/Settings runtime surfaces; unavailable full-agent profiles show missing gates and are not selectable as production-ready. | Satisfied |
| Cross-route benchmark tasks 8.1-8.7 | `openspec/changes/complete-claude-parity-full-agent-harness/model-bench-report-2026-05-11.json` exists; `harness:model-bench` passed; offisim-core measured and SDK-native full-agent routes are benchmark-visible as blocked when release evidence is missing or incompatible. | Satisfied |
| Deterministic/live gates tasks 9.1-9.8 | Harness map records PASS for contract, replay, provider-adapter, engine-profiles, stream-tools, context, resume, chaos, soak, MCP lifecycle, VCR, and model-bench. | Satisfied |
| Release `.app` tasks 10.1-10.3, 10.5-10.7 | `pnpm --filter @offisim/desktop build` passed again on 2026-05-11; exact release `.app` launched via path; Computer Use attached; Settings Runtime showed Codex full-agent blocked under selected model `MiniMax-M2.7`; default harness evidence remains valid. | Satisfied |
| Release `.app` task 10.4 | 2026-05-11 release `.app` hash `bf10cbcb54a79f94cb5ed312fe2f5793179b0e35e480d9d458134991a0254525`, pid `77420`; release tasks `tr-yolo-2274aac6-002d-454c-aed0-2c049af036fa` and `tr-yolo-a6838d85-2026-44db-9a59-148f3b8888e5` failed closed for missing workspace root and unsupported selected model; direct sidecar control with `gpt-5.4` proves the bridge, not release promotion. | Satisfied as fail-closed demotion; no promoted profile |
| Documentation and archive tasks 11.1-11.8 | Harness map, provider matrix, root guidance, runtime copy, stale truth report, OpenSpec validate, diff hygiene, type/Rust/release checks, and feature map are updated or recorded. | Satisfied |
| Archive gate task 11.9 | This audit records that all implementation, benchmark, release, feature-map, and truth-source cleanup tasks are checked after final Codex full-agent evidence. | Satisfied |

## Verification Commands

| Command / gate | Result |
| --- | --- |
| `openspec validate complete-claude-parity-full-agent-harness --strict` | Pass |
| `git diff --check` | Pass |
| `cargo test local_db --quiet` | Pass, 2 local DB tests |
| `cargo check` in `apps/desktop/src-tauri` | Pass |
| `pnpm --filter @offisim/desktop build` | Pass, rebuilt `Offisim.app` after Codex full-agent model isolation and cancellation classification fixes |
| `node --check scripts/tauri-codex-agent-host.mjs` | Pass |
| `pnpm --filter @offisim/web typecheck` | Pass |
| `node apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/Resources/resources/codex-agent-host.mjs` full-agent event probe | Pass; emitted session, MCP lifecycle, native shell success, resume/fork, checkpoint/rollback, and timeout budget events |
| `mcp__gitnexus.detect_changes(scope: all, repo: Offisim)` | Medium risk, 170 changed symbols, 27 changed files, one affected process: `RunEmployeeEngine -> GenerateId` |

Previously recorded harness gates in `openspec/harness-capability-map.md`:

- `pnpm harness:contract`
- `pnpm harness:replay`
- `pnpm harness:provider-adapter`
- `pnpm harness:context`
- `pnpm harness:resume`
- `pnpm harness:chaos`
- `pnpm harness:soak -- --iterations=1`
- `pnpm harness:mcp-lifecycle -- --force-build`
- `pnpm harness:engine-profiles -- --force-build`
- `pnpm harness:main-control-plane -- --force-build`
- `pnpm harness:stream-tools`
- `pnpm harness:vcr`
- `pnpm harness:model-bench -- --force-build --report-file ...`

## Remaining Unpromoted Profiles

Task 10.4 is complete as a release gate because there are no promoted SDK-native full-agent profiles left to verify. `codex-engine:sdk-native-full-power` is blocked until selected-model compatibility and release `.app` evidence pass.

Claude and OpenAI SDK-native full-agent profiles remain unavailable. They are not counted as promoted profiles and must not be claimed as release verified until they pass the same release `.app` evidence set.

## Completion Decision

Archive gate 11.9 can be checked only under the corrected production claim: default `offisim-core` remains the verified release route, SDK-native full-agent profiles are modeled and fail closed, and no Codex/Claude/OpenAI full-agent profile is promoted in this build.
