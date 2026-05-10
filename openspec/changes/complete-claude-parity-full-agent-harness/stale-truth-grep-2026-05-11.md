# Stale Truth Grep Report - 2026-05-11

Change: `complete-claude-parity-full-agent-harness`

## Command

`rg -n "promoted Codex|Codex full-agent profile promotion|only promoted SDK-native|promoted SDK-native|full-agent text/native success|Final release \\.app UI proves promoted|full-power-promoted|Satisfied for promoted" openspec/changes/complete-claude-parity-full-agent-harness openspec/harness-capability-map.md openspec/provider-lane-matrix.md -S`

Run time: 2026-05-11 Pacific/Auckland, after the review-fix release `.app` rebuild and Computer Use verification.

## Findings

| Source | Verdict | Action |
| --- | --- | --- |
| `codex-native-event-bridge-probe-2026-05-10.md` | Stale conclusion claimed promoted Codex full-agent evidence. | Added a 2026-05-11 correction and changed the decision to event-bridge evidence only. Current release status is blocked by selected-model compatibility. |
| `archive-gate-audit-2026-05-10.md` | Stale rows claimed Codex full-agent promotion and archive readiness on that basis. | Added a 2026-05-11 correction and rewrote the affected rows. Archive readiness now means default route verified and SDK-native full-agent profiles fail closed. |
| `release-app-verify-2026-05-10.md` | Historical prompt/task rows still contain `Codex full-agent text/native success`. | Kept as historical evidence because the file now starts with a correction saying the promotion conclusion is superseded by `review-fix-evidence-2026-05-11.md`. |
| `openspec/harness-capability-map.md` | Current text says no SDK-native full-agent profile is promoted and records the 2026-05-11 release blocker. | No change required. |
| `openspec/provider-lane-matrix.md` | Current text says no `sdk-native-full-power` employee profile is promoted and names the selected-model blocker. | No change required. |

## Residual Rule

Historical evidence may mention the old release prompt or bundle, but any current product, archive, or UI claim must use the 2026-05-11 status: Codex full-agent is blocked until a Codex-supported selected model or dedicated Codex model selector passes release `.app` evidence.
