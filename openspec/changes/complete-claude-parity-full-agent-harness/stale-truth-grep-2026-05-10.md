# Stale Truth Grep Report

Command:

`rg -n "blocked full-agent|text-only preview|ordinary SDK lane|普通 SDK lane|sdk-native-full-power|full-agent targets blocked|full-agent product exposure remains blocked|stay unavailable until|release blocked|full-agent-blocked" AGENTS.md CLAUDE.md openspec/protocols-ledger.md openspec/provider-lane-matrix.md openspec/harness-capability-map.md openspec/specs openspec/changes/complete-claude-parity-full-agent-harness /Users/haoshengli/.codex/memories/extensions/ad_hoc/notes -S`

Run time: 2026-05-10T22:36:00 Pacific/Auckland.
Updated after final release `.app` local-tool verification: 2026-05-10T23:20:00 Pacific/Auckland.

## Findings

| Source | Verdict | Action |
| --- | --- | --- |
| `openspec/harness-capability-map.md` | Stale wording: "full-agent targets blocked" made unavailable profiles read like the final state. | Rewritten to `sdk-native-full-agent` implementation target language with capability matrix, evidence requirements, native/gateway activity envelope, completion evidence families, and release `.app` gate. |
| `openspec/provider-lane-matrix.md` | Partially stale wording: "full-agent product exposure remains blocked" was correct operationally but weak product framing. | Rewritten as "unavailable until" with required native/gateway, benchmark, credential-boundary, and release `.app` evidence. |
| `AGENTS.md` / `CLAUDE.md` | Acceptable boundary language: no ordinary SDK lane, default Offisim harness remains owner, SDK-native profile requires release evidence. | No change required beyond current wording. |
| `openspec/protocols-ledger.md` | Acceptable boundary language: provider transport is not runtime ownership; full-agent/gateway-bridged profile needs evidence. | No change required. |
| Active change proposal/design/specs/tasks/reference map | Intentional hits: the change explicitly names the old stale phrases so future work can remove their effect. The task taxonomy still contains `full-agent-blocked` as an allowed status label; it is not a completion claim. | Keep. |
| `model-bench-report-2026-05-10.json` | Intentional generated evidence: route ids still include `sdk-native-full-power`, and rows mark SDK-native / gateway-bridged routes unavailable with blockers. | Keep as benchmark evidence. |
| `release-app-verify-2026-05-10.md` | Final release evidence now verifies default `offisim-core` employee local-tool success, denied path, completion evidence, and cancellation propagation. It also records the full-agent release blocker. | Keep 10.3 checked. Keep 10.4 unchecked because no SDK-native or gateway-bridged full-agent profile is promoted in this build. |
| Memory correction notes | Intentional hits: notes supersede older stale framing and tell future agents not to stop at blocked/text-only state. | Keep. |

## Residual Rule

The remaining valid phrase is "unavailable until evidence passes." It is not a completion claim. Any archive attempt must still prove deterministic gates, benchmark coverage, release `.app` evidence, and unresolved blocker accounting.
