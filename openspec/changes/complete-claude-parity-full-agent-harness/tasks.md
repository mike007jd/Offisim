## 1. Truth Baseline And Toxic Memory Cleanup

- [x] 1.1 Refresh `openspec/harness-capability-map.md` into a complete parity ledger with one row per ClaudeSource, ClaudeRust, SDK, MCP, default-harness, external-employee, and full-agent capability.
- [x] 1.2 Add source anchors for ClaudeSource main loop, streaming tool executor, tool orchestration, permission hooks, session restore, context compaction, subagent/fork, MCP, and background session surfaces.
- [x] 1.3 Add source anchors for ClaudeRust file/bash/grep/edit/patch, permission mode, sandbox/workspace boundary, task/tool registry, MCP/LSP registry, git/worktree/session state, terminal/job lifecycle, and mock parity harness surfaces.
- [x] 1.4 Classify every parity row as `reference`, `implemented-backend`, `implemented-release`, `full-agent-blocked`, or `explicitly-unavailable` with the exact missing gate.
- [x] 1.5 Update `openspec/protocols-ledger.md`, `openspec/provider-lane-matrix.md`, provider product taxonomy docs, and runtime profile docs so they distinguish provider product, access mode, model transport, text-only preview, gateway-bridged runtime, SDK-native full-agent runtime, driver, and replacement.
- [x] 1.6 Update root `CLAUDE.md` / `AGENTS.md` wording so full-agent profiles are implementation targets gated by release evidence, not permanent "do not build" states.
- [x] 1.7 Add an ad hoc memory correction note under `~/.codex/memories/extensions/ad_hoc/notes/` superseding stale memory that says full-agent work can stop at blocked/text-only status.
- [x] 1.8 Run and record a stale-truth grep over active specs, active changes, ledgers, provider matrix, root docs, and memory correction notes for old blocked/text-only/ordinary-SDK-lane framing.
- [x] 1.9 Update boundary specs and evidence maps for project workspace binding, desktop credential isolation, attachments, deliverables, skill mutation, employee-node routing, MCP transport scope, and Settings controller/runtime separation.
- [x] 1.10 Maintain `reference-feature-map.md` with source-backed business logic for every feature family; each row must include ClaudeSource anchors, ClaudeRust anchors or an explicit missing-counterpart note, Offisim target behavior, gates, and non-copy decisions.
- [x] 1.11 Require every implementation task, spec scenario, benchmark case, and release claim to reference a `reference-feature-map.md` row or be explicitly marked out of scope.

## 2. Default Harness Claude-Class Floor

- [x] 2.1 Audit current `offisim-core` employee loop against the parity ledger and list exact missing behavior instead of broad "not complete" labels.
- [x] 2.2 Close bounded multi-turn loop gaps: max rounds, duplicate tool calls, missing tool results, typed failures, and retry/recovery must all have deterministic scenarios.
- [x] 2.3 Close streaming gaps: text, reasoning, read-only early tool execution, write serialization, progress, cancellation, and stream/non-stream parity must be asserted.
- [x] 2.4 Close context survival gaps: compaction, prompt-too-long recovery, objective anchor retention, fork isolation, long-running yolo/refactor, and context-budget reporting must be asserted.
- [x] 2.5 Close run-state gaps: `RunConversationState` must record active context, pending tools, tool results, permission denials, discovered tools, checkpoint identity, budget, retry, cancellation, usage, and terminal status.
- [x] 2.6 Close default MCP gaps: initialize/connect, capabilities, list tools/resources/prompts, call/read/get, list-changed refresh, cancellation, failure classification, and shutdown must be in harness gates.
- [x] 2.7 Close default sandbox and credential gaps: file/path containment, symlink escape, oversized reads/writes, shell approval/audit, network disclosure, secret redaction, provider credential boundary, and denied-path completion behavior must be in gates.
- [x] 2.8 Extend completion verification so file/shell/MCP/workspace/native claims cannot complete without accepted evidence.
- [x] 2.9 Close local-productivity gaps: file tree, read/write/edit/patch, grep/search, git diff/status/branch/worktree, artifact/deliverable creation, memory/todo/skill access, and workspace-root binding must all have explicit evidence families.
- [x] 2.10 Close process-control gaps: one-shot shell, long-running shell, PTY-like interaction where supported, output limits, cancellation, timeout, orphan cleanup, and post-cancel side-effect denial must all be covered.
- [x] 2.11 Close project workspace gaps: active `workspace_root` propagation, `project_list_dir`, bounded `project_read_file_preview`, gateway `read_file`/`write_file`/`bash`, and workspace-binding-gap diagnostics must all agree in release `.app`.
- [x] 2.12 Close attachment and deliverable gaps: `read_attachment`, attachment GC, parsed document evidence, deliverable/artifact creation, artifact card commitment, and out-of-order event handling must be evidence families rather than chat-only presentation.

## 3. Full-Agent Runtime Profile Model

- [x] 3.1 Refactor runtime capability profiles so `text-only`, `gateway-bridged-tools`, `sdk-native-full-agent`, `driver`, and `replacement` have distinct schemas and evidence requirements.
- [x] 3.2 Replace any "blocked forever" profile semantics with "unavailable until these gates pass" while keeping production selection disabled.
- [x] 3.3 Add profile fields for native tools, gateway tools, MCP, sessions, resume, fork, subagents/handoffs, hooks/guardrails, cancellation, budget, usage/cost, sandbox, checkpoint, rollback, telemetry, failure taxonomy, memory/todo/skill access, artifact/deliverable authority, git/worktree authority, process-control authority, browser/desktop authority, and credential boundary.
- [x] 3.4 Add profile-fit checks that block tasks exceeding the selected profile and return typed outcomes rather than silently falling back to provider/gateway mode.
- [x] 3.5 Add deterministic engine-profile cases proving every unavailable full-agent profile lists actionable missing gates.
- [x] 3.6 Add deterministic engine-profile cases proving an available full-agent profile cannot be selected unless every required evidence flag is present.

## 4. SDK-Native Full-Agent Adapters

- [x] 4.1 Define the normalized native activity envelope for model stream, reasoning, native tool, MCP, permission, guardrail, subagent, handoff, session, checkpoint, rollback, usage, budget, cancellation, and terminal events.
- [x] 4.2 Update Claude full-agent adapter path so it does not force one-shot text, `maxTurns=1`, empty tools, or discarded native events when running in verified full-agent mode.
- [x] 4.3 Update Codex full-agent adapter path so native app-server/session events map into the normalized envelope and preserve local tool/cancellation semantics.
- [x] 4.4 Add OpenAI Agents full-agent adapter path or mark it explicitly unavailable with missing host/tool/MCP/session gates.
- [x] 4.5 Preserve native permission requests and guardrail decisions and map allow/deny/ask into Offisim audit and activity events.
- [x] 4.6 Preserve native MCP lifecycle events, including server status, tool/resource list, call result, failure, cancellation, list-changed, and shutdown.
- [x] 4.7 Preserve native session resume/fork identity and attach it to Offisim task/run/checkpoint identity.
- [x] 4.8 Preserve native usage/cost/tracing fields without leaking provider-specific raw payloads into renderer contracts.
- [x] 4.9 Add typed partial-state handling for max-turn, timeout, tool failure, guardrail failure, provider error, cancellation, and budget exhaustion.
- [x] 4.10 Add trusted-host preflight for each full-agent adapter: binary/sidecar presence, version/hash, auth state, workspace root, sandbox mode, MCP config, credential scope, and unavailable reason must be recorded before task dispatch.
- [x] 4.11 Route every full-agent trusted-host request through the same credential-isolated Tauri bridge contract: no provider secret crosses Rust-to-JS, abort kills the active bridge/child process, and credential destination class is recorded in evidence.

## 5. Gateway-Bridge And Evidence Classification

- [x] 5.1 Define when a native agent may propose a gateway-bridged tool call and which Offisim approval/checkpoint path executes it.
- [x] 5.2 Record native proposal evidence separately from gateway execution evidence.
- [x] 5.3 Update completion verifier to accept SDK-native evidence only for task classes that profile has release proof for.
- [x] 5.4 Update completion verifier to accept gateway-bridged evidence only when Offisim executed the boundary and task-run identity matches.
- [x] 5.5 Add deterministic scenarios for native success, native denied path, gateway-bridged success, gateway-bridged denial, and mislabeled evidence rejection.
- [x] 5.6 Add completion-verifier cases for file, shell, MCP, git/worktree, artifact, memory/todo/skill, browser/desktop, SDK-native, gateway-bridged, and pure-text evidence families.
- [x] 5.7 Add evidence rejection cases for attachment-only final text, artifact-without-deliverable-event, skill mutation without confirmation, workspace tool result from unbound root, and provider transport smoke being mislabeled as full-agent evidence.

## 6. Control Plane Promotion, Driver, And Replacement

- [x] 6.1 Extend main harness policy so full-agent employee, driver, and replacement modes require explicit trusted policy and cannot self-promote from SDK health.
- [x] 6.2 Add policy fields for actor, scope, reason, previous owner, next owner, profile id, verification status, checkpoint id, rollback plan, and timestamp.
- [x] 6.3 Add driver proposal flow for file edit, shell command, handoff, plan mutation, and approval requests without direct global state mutation.
- [x] 6.4 Add replacement-mode preflight that blocks without benchmark equivalence, checkpoint handoff, rollback, failure containment, and release evidence.
- [x] 6.5 Add rollback path from driver/replacement back to `offisim-core` with audit event and preserved task/run evidence.
- [x] 6.6 Add control-plane harness cases for no-self-promotion, driver proposal, replacement blocked, replacement rollback, and stale policy rejection.
- [x] 6.7 Add external/A2A employee cases proving discovery, install, or health cannot count as full-agent parity unless the external employee passes the same profile, evidence, sandbox, checkpoint, rollback, and release gates.

## 7. Personnel Runtime And Activity UX

- [x] 7.1 Update Personnel Runtime surfaces to show tier, availability, evidence class, missing gates, and profile identity for every runtime option.
- [x] 7.2 Disable production selection for unavailable full-agent profiles and show actionable blockers.
- [x] 7.3 Show available full-agent profiles only after deterministic, benchmark, and release `.app` evidence references exist.
- [x] 7.4 Update activity feed mappers to render native tool, gateway-bridge, MCP, permission, guardrail, subagent, handoff, checkpoint, rollback, cancellation, usage, and failure events.
- [x] 7.5 Remove fake "engine accepted task" or final-text-only rows from full-agent activity surfaces.
- [x] 7.6 Add UI smoke or component harness coverage for blocked profile, available profile, missing-gate tooltip, and activity feed event mapping.
- [x] 7.7 Update Settings Provider/Runtime surfaces so product, access mode, model transport, runtime profile, employee default, driver, and replacement state are separate controls with separate unavailable reasons.

## 8. Cross-Route Benchmark

- [x] 8.1 Build a benchmark runner that executes the same task matrix through `offisim-core` and each candidate full-agent/gateway-bridged profile.
- [x] 8.2 Include task cases for file read/write/edit/patch, grep/search, shell command, long-running process, git diff/status/branch/worktree, MCP tool, artifact/deliverable creation, memory/todo/skill operation, long-context run, subagent/handoff, browser/desktop boundary where supported, cancellation, denied sandbox escape, budget exhaustion, rollback, and pure text answer.
- [x] 8.3 Measure task completion, tool correctness, denied-path behavior, context retention, cancellation, resume/fork, MCP behavior, rollback/checkpoint, usage/cost, latency, telemetry, and evidence quality.
- [x] 8.4 Fail benchmark if a promoted full-agent route is missing evidence for a required task class.
- [x] 8.5 Fail benchmark if `offisim-core` is materially weaker on core local productivity workflows without an explicit product trade-off record.
- [x] 8.6 Persist benchmark report under the change with route ids, hashes, command outputs, and blockers.
- [x] 8.7 Map every benchmark scenario and report finding back to `reference-feature-map.md` row IDs so coverage gaps are visible.

## 9. Deterministic And Live Harness Gates

- [x] 9.1 Add deterministic scenarios for full-agent native tool success, native denied path, file/edit/patch, shell/process, git/worktree, MCP lifecycle, memory/todo/skill, artifact, cancellation, resume/fork, checkpoint/rollback, guardrail allow/deny, subagent/handoff telemetry, credential boundary, and budget exhaustion.
- [x] 9.2 Add stream-tools cases for native event streaming and gateway-bridge event ordering.
- [x] 9.3 Add context/resume cases for full-agent session resume/fork equivalence.
- [x] 9.4 Add chaos/soak cases for cancelled native tools, failing MCP, hung sidecar, and bounded memory.
- [x] 9.5 Add model-bench route comparisons that include offisim-core, SDK-native full-agent, and gateway-bridged evidence classes.
- [x] 9.6 Run `pnpm harness:contract`, `pnpm harness:replay`, `pnpm harness:provider-adapter`, `pnpm harness:engine-profiles`, `pnpm harness:stream-tools`, `pnpm harness:context`, `pnpm harness:resume`, `pnpm harness:chaos`, `pnpm harness:soak`, `pnpm harness:vcr` if introduced, and `pnpm harness:model-bench`.
- [x] 9.7 Run live provider smoke/load/edge gates for each promoted route when credentials and local SDK hosts are available; leave explicit blockers when unavailable.
- [x] 9.8 Add or update focused gates for `project-workspace-binding`, `desktop-llm-credential-isolation`, `chat-attachments-end-to-end`, `deliverable-artifact-handoff`, `agent-mediated-skill-install`, `employee-node-boundaries`, `mcp-transport-decision`, and `settings-controller-boundaries` so these boundary specs cannot drift outside parity work.

## 10. Release App Verification

- [x] 10.1 Build the desktop renderer and `@offisim/desktop` release artifacts from the current worktree.
- [x] 10.2 Launch the exact release `.app` path, not bundle id, and attach with Computer Use.
- [x] 10.3 Verify default `offisim-core` fresh employee work in release `.app` with local tool success, denied path, cancellation, and completion evidence.
- [x] 10.4 Verify each promoted full-agent profile in release `.app` with text success, native tool success, denied native path, MCP lifecycle, cancellation, resume/fork, checkpoint/rollback, budget exhaustion, sandbox escape denial, and typed completion classification.
  - 2026-05-11 review correction: no full-agent profile remains promoted. `codex-engine:sdk-native-full-power` is blocked again because the release app passes the active selected model `MiniMax-M2.7` to Codex, and Codex local auth rejects it as unsupported. Evidence: `review-fix-evidence-2026-05-11.md`.
- [x] 10.5 Verify Personnel Runtime surfaces show correct availability, missing gates, selected profile, and evidence references.
- [x] 10.6 Record bundle path, bundle hash, timestamp, process id, app URL/window evidence, active project/company/employee, DB/event/audit evidence, screenshots or Computer Use observations, and remaining blockers.
  - 2026-05-11 review correction: final release hash `bf10cbcb54a79f94cb5ed312fe2f5793179b0e35e480d9d458134991a0254525`; Computer Use attached pid `77420`; Settings Runtime shows Codex full-agent `blocked` with selected-model blocker.
- [x] 10.7 If Computer Use, credentials, or local SDK hosts are unavailable, keep the relevant release tasks unchecked and mark the profile unavailable.

## 11. Documentation, Matrices, And Archive Gates

- [x] 11.1 Update `openspec/harness-capability-map.md` after implementation with final statuses and evidence references.
- [x] 11.2 Update `openspec/protocols-ledger.md` and `openspec/provider-lane-matrix.md` to reflect implemented profiles, unavailable profiles, and transport/runtime distinctions.
- [x] 11.3 Update root `CLAUDE.md`, root `AGENTS.md`, and package-local guidance touched by this change.
- [x] 11.4 Update user-facing runtime copy so it never presents text-only preview as full-agent or blocked status as final strategy.
- [x] 11.5 Run stale-truth grep/report again and attach the result to the change.
  - 2026-05-11 review correction: attached `stale-truth-grep-2026-05-11.md` after updating stale Codex promotion evidence files.
- [x] 11.6 Run `openspec validate complete-claude-parity-full-agent-harness --strict`.
- [x] 11.7 Run `git diff --check`, relevant typechecks, and desktop Rust checks for touched code.
- [x] 11.8 Refresh `reference-feature-map.md` before archive and leave any unverified or source-unmapped feature row unchecked/unavailable.
- [x] 11.9 Archive only after all implementation, benchmark, release, feature-map, and truth-source cleanup tasks are checked or explicitly left as unshipped blockers.
