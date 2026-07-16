# Documentation Truth Ledger

Checked at: 2026-07-17 NZST

This ledger separates current product truth from point-in-time plans and
evidence. `REWRITE` means the file remains current after correction; `RETAIN`
means it was rechecked and stays authoritative for its stated scope;
`SUPERSEDE` means unique history/evidence is preserved behind a visible banner
and current replacement link; `DELETE` requires proof that no unique contract,
decision, evidence, public, legal, security, or dynamic-reference value remains.

## Proof method

Every deletion candidate was checked through five independent lenses:

1. tracked path and inbound-reference search;
2. current gateway/host/schema/UI code and retained harness behavior;
3. current maintained docs and active task acceptance;
4. historical decision/evidence value, including screenshots and release hashes;
5. a skeptic pass asking what fact, audit trail, or protected boundary would be
   lost if the file disappeared.

Result: no tracked documentation or screenshot met the `DELETE` threshold.
The actual dead-doc defect was authoritative-looking stale language, so the safe
cleanup is current-file rewrites plus explicit supersession.

## Current sources

| Path | Disposition | Current role / replacement |
|---|---|---|
| `AGENTS.md` | REWRITE | Current completion, gateway, account/model, workspace, and release rules |
| `CLAUDE.md` | REWRITE | Current AI worker guidance; Pi API plus Codex and Claude Code orchestration implemented |
| `README.md` | REWRITE | Public overview and source router |
| `SECURITY.md` | REWRITE | Current credential, native-state, workspace, and host threat model |
| `apps/desktop/CLAUDE.md` | REWRITE | Current desktop gateway/host and release guidance |
| `packages/core/CLAUDE.md` | REWRITE | Current core ownership and effective-workspace boundary |
| `Docs/SYSTEM_FRAMEWORK.md` | REWRITE | Maintained architecture, four-layer persistence, and flow map |
| `Docs/FEATURES.md` | REWRITE | Maintained product catalog, including Loops NL, Market user flow, and Office dramaturgy |
| `Docs/CODEBASE_MAP.md` | REWRITE | Maintained ownership and documentation-routing map |
| `Docs/HARNESS_ARCHITECTURE.md` | REWRITE | Current neutral gateway plus Pi API/Codex/Claude orchestration host gates |
| `Docs/UI_FRAMEWORK_STACK.md` | REWRITE | Approved renderer stack and current design-source precedence |
| `Docs/design/.v3-dna-brief.md` | REWRITE | Canonical dense-HUD grammar and semantic radius roles |
| `Docs/design/offisim-office-layout-v3-prototype.html` | REWRITE | Canonical visual-grammar specimen only; behavior/copy examples defer to current tasks and engine ADR |
| `Docs/00_start_here/LOCAL_DEVELOPMENT.md` | REWRITE | Current account setup and desktop engine entrypoints |
| `Docs/00_start_here/RELEASE_GATES.md` | REWRITE | Current responsibility-based release gates |
| `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md` | RETAIN | Current engine/account/model/session/workspace decision |
| `Docs/architecture/2026-07-13-native-stage-capability-lanes.md` | REWRITE | Current manual-vs-agent Stage boundary, engine-neutral wording |
| `Docs/architecture/2026-07-02-prelaunch-vibe-debt-policy.md` | REWRITE | Current prelaunch cleanup policy and protected engine boundaries |
| `Docs/architecture/2026-06-26-collaboration-domain-boundary.md` | REWRITE | Current isolated API/Codex no-tools collaboration contract |
| `Docs/architecture/2026-06-26-enhance-profile-contract.md` | REWRITE | Current isolated same-engine text-job contract |
| `Docs/architecture/2026-06-26-loop-domain-mission-adapter.md` | REWRITE | Current Loop NL/IR/send-time contract and baseline-schema wording |
| `Docs/architecture/2026-06-26-loop-graph-react-flow-elk.md` | RETAIN | Current read-only graph projection contract |
| `Docs/roadmap/2026-07-13-ui-ux-consistency-pass/plan.md` | REWRITE | Active plan and shipped/pending truth |
| `Docs/roadmap/2026-07-13-ui-ux-consistency-pass/tasks.md` | REWRITE | Active acceptance and evidence ledger |

## Retained scoped contracts and governance

| Path | Disposition | Why retained |
|---|---|---|
| `CHANGELOG.md` | RETAIN | Chronological release history; old behavior is explicitly time-scoped |
| `CODE_OF_CONDUCT.md` | RETAIN | Public governance |
| `Docs/00_start_here/DEPLOYMENT.md` | RETAIN | Platform and desktop distribution guidance |
| `Docs/platform-deployment-gates.md` | RETAIN | Platform deployment/security gates |
| `Docs/security/renderer-sql-and-fs-trust-boundary.md` | RETAIN | Security boundary contract |
| `Docs/contracts/inert-storage-ledger.md` | RETAIN | Explicit storage-writer truth and cleanup evidence |
| `Docs/contracts/storage-consistency-contracts.md` | RETAIN | Cross-store consistency contract |
| `Docs/cleanup-exemptions.md` | REWRITE | Current reviewed keep-list for dynamic/generated boundaries |
| `Docs/design/office-art-bible.md` | RETAIN | Current Office visual/geometry source |
| `Docs/design/spacing-density.md` | RETAIN | Current density reference |
| `Docs/design/2026-07-13-codex-pets-sync.md` | REWRITE | Current pet package/projection contract, engine-neutral wording |
| `Docs/evidence/2026-07-13-issues-48-49/README.md` | RETAIN | Release evidence manifest |
| `apps/desktop/renderer/src/assets/characters/LICENSES.md` | RETAIN | Required asset licensing/provenance |
| `apps/desktop/renderer/src/assistant/runtime/README.md` | RETAIN | Narrow assistant presentation/runtime boundary |
| `apps/platform/CLAUDE.md` | RETAIN | Current platform-specific worker guidance |
| `packages/doc-engine/CLAUDE.md` | RETAIN | Current doc-engine worker guidance |
| `packages/db-local/src/migrations/README.md` | RETAIN | Explicit no-historical-migration policy |
| `packages/core/src/loops/compiler-profiles/software-development/assets/*.md` | RETAIN | Runtime-loaded compiler-profile assets, not repository docs |
| `apps/platform/src/seed/payloads/skill-research-summary.md` | RETAIN | Seed payload content, not an architecture source |
| `packages/doc-engine/harness/fixtures/sample.md` | RETAIN | Parser fixture |

## Superseded implementation and decision records

| Path | Disposition | Current replacement |
|---|---|---|
| `Docs/architecture/2026-06-18-pi-agent-only-runtime.md` | SUPERSEDE | `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md` |
| `Docs/architecture/2026-06-25-pi-0.80-compat-spike.md` | SUPERSEDE | Current lockfiles, official sources, and engine-neutral ADR |
| `Docs/architecture/2026-06-25-truth-closure.md` | SUPERSEDE | Current account billing contract for Cost/Usage; retained run/artifact history |
| `Docs/DELEGATION_ARCHITECTURE.md` | SUPERSEDE | `Docs/HARNESS_ARCHITECTURE.md` plus current delegation harnesses |
| `Docs/test-loops/codex-functional-test-loop.md` | SUPERSEDE | `Docs/00_start_here/RELEASE_GATES.md` and active T16 matrix |
| `Docs/roadmap/2026-07-01-parallel-work-dramaturgy-prd.md` | SUPERSEDE | Active plan, feature catalog, Office art bible |
| `Docs/roadmap/2026-07-01-universal-work-dramaturgy-iteration-plan.md` | SUPERSEDE | Active plan, feature catalog, Office art bible |
| `Docs/roadmap/2026-07-02-dramaturgy-state-coverage.md` | SUPERSEDE | Active tasks and current Office harnesses |
| `Docs/roadmap/2026-07-02-production-work-dramaturgy-prd.md` | SUPERSEDE | Active tasks, feature catalog, Office art bible |
| `Docs/roadmap/2026-07-02-stage-preview-computer-use-prd.md` | SUPERSEDE | Active tasks, feature catalog, release gates |
| `Docs/roadmap/2026-07-03-agent-workspace-execution-plan.md` | SUPERSEDE | Active plan and engine-neutral workspace decision |
| `Docs/roadmap/2026-07-03-agent-workspace-requirements-package.md` | SUPERSEDE | Active plan and engine-neutral workspace decision |
| `Docs/roadmap/2026-07-03-stage-preview-computer-use-plan.md` | SUPERSEDE | Active tasks, feature catalog, release gates |
| `Docs/roadmap/2026-07-09-architecture-quality-refactor-pr-plan.md` | SUPERSEDE | Maintained architecture/codebase docs |
| `Docs/roadmap/2026-07-09-office-toy-performance-requirements.md` | SUPERSEDE | Active tasks, Office art bible, current harnesses |
| `Docs/roadmap/2026-07-09-office-toy-performance-execution-plan.md` | SUPERSEDE | Active tasks, Office art bible, current harnesses |
| `Docs/roadmap/plan-office-toy-performance-overhaul.md` | SUPERSEDE | Active tasks, Office art bible, current harnesses |
| `Docs/roadmap/2026-07-11-vibe-coding-company-roadmap.md` | SUPERSEDE | Active plan and engine-neutral ADR |
| `Docs/roadmap/2026-07-12-shell-ia-and-character-lane.md` | SUPERSEDE | Active tasks, V3 DNA, maintained docs |
| `Docs/design/offisim-activity-prototype.html` | SUPERSEDE | V3 DNA and current renderer/task evidence |
| `Docs/design/offisim-lifecycle-prototype.html` | SUPERSEDE | V3 DNA and current lifecycle/workspace task evidence |
| `Docs/design/offisim-market-prototype.html` | SUPERSEDE | V3 DNA and current Market task evidence |
| `Docs/design/offisim-personnel-prototype.html` | SUPERSEDE | V3 DNA and current Personnel task evidence |
| `Docs/design/offisim-settings-prototype.html` | SUPERSEDE | V3 DNA, engine-neutral ADR, and current Settings task evidence |
| `Docs/design/offisim-states-prototype.html` | SUPERSEDE | V3 DNA and current state-semantics task evidence |
| `Docs/design/offisim-workspace-prototype.html` | SUPERSEDE | V3 DNA and current workspace task evidence |

## Historical evidence and archives

| Path | Disposition | Why retained |
|---|---|---|
| `Docs/archive/2026-06-25-second-runtime-pilot-scorecard.md` | SUPERSEDE | Past NO-GO decision; banner now points to current shipped-engine truth |
| `Docs/archive/2026-06-26-verified-missions-remediation-roadmap.md` | SUPERSEDE | Audit/remediation provenance |
| `Docs/archive/2026-06-29-agent-harness-wave-status.md` | SUPERSEDE | Point-in-time implementation provenance |
| `Docs/live-verify-report-2026-06-30.md` | SUPERSEDE | Historical blind-test evidence, explicitly not current release proof |
| `Docs/live-verify-bugs-2026-06-30.md` | SUPERSEDE | Finding/root-cause/fix provenance |
| `Docs/live-verify-report-2026-07-12-shell-lane.md` | SUPERSEDE | Historical provider-timeout and shell-lane evidence |
| `Docs/evidence/**` images and JSON | RETAIN | Hashable release/design evidence; screenshots are not current truth by themselves |

## Delete and local cleanup decisions

| Candidate | Disposition | Evidence |
|---|---|---|
| Tracked docs | DELETE — none | Every candidate retained a current contract, unique decision, audit trail, fixture, or public/legal/security role |
| Tracked screenshots | DELETE — none | Referenced historical release/design evidence; acceptance explicitly requires preservation |
| `.playwright-mcp/`, `.playwright-cli/`, `feedbacks/`, `output/`, `.DS_Store`, `*.log` | DELETE when present | Ignored, reproducible local artifacts; none were tracked in this worktree at cleanup time |

Future cleanup must update this ledger and pass `pnpm check:docs-truth` before a
tracked document or evidence file is deleted or reclassified.
