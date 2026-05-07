import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCENARIOS_DIR = resolve(ROOT, 'packages/core/harness/scenarios');

export const REPLAY_SCENARIO_IDS = [
  'boss-summary-empty-with-stale-plan-does-not-mark-complete',
  'boss-summary-pending-plan-with-output-does-not-complete',
  'boss-summary-idle-no-plan-does-not-mark-complete',
  'boss-summary-management-deliverable-shape',
  'boss-summary-missing-artifact-incomplete',
  'boss-summary-single-empty-output-completes',
  'completion-without-taskrunid-defaults-to-blocked',
  'completion-chinese-artifact-task-blocks-without-evidence',
  'completion-failed-write-tool-evidence-blocks',
  'completion-failed-bash-string-evidence-blocks',
  'completion-verifier-persists-blocked-status',
  'dag-output-attribution',
  'direct-mode-skips-boss-chain',
  'gateway-lane-yolo-has-fs-shell-tools',
  'gateway-lane-attachments-system-preface',
  'historical-thread-attachments-readable',
  'kanban-card-state-transitions',
  'kanban-rejects-illegal-transition',
  'mode-kanban-matrix',
  'permission-ask-approved-blocks-and-then-executes',
  'permission-ask-denied-does-not-execute',
  'pm-heartbeat-flags-blocked-task',
  'pm-planner-clears-stale-dispatch-state',
  'plan-review-cancel-terminates',
  'plan-review-approve-survives-restore',
  'orchestration-project-thread-scopes-runtime-context',
  'routing-accepts-verb-object-imperative',
  'routing-rejects-bare-noun-prose',
  'routing-rejects-chinese-narrative-prose',
  'manager-rerouted-event-fires',
  'manager-whole-team-dispatches-all-employees',
  'employee-inherits-unified-model-setting',
  'employee-invalid-model-override-fails-before-work',
  'employee-profile-model-preference-used',
  'sanitize-rebind-uses-recommended-order',
  'skill-create-real-tool-call',
  'skill-create-target-employee-mismatch',
  'sdk-lane-attachments-short-circuit-before-model',
  'sdk-lane-yolo-attachments-short-circuit-before-model',
  'boss-tool-routing-sync-from-claude-code-web',
  'step-advance-segregates-blocked-from-completed',
  'tool-kit-without-builtins-omits-fs-shell',
  'yolo-attachment-only-reads-current-turn-refs',
  'yolo-mode-skips-boss-chain',
];

export const SOAK_SCENARIO_IDS = ['yolo-80-turn-multi-file-refactor'];

export function loadHarnessScenarios(ids = REPLAY_SCENARIO_IDS) {
  return ids.map((id) => JSON.parse(readFileSync(resolve(SCENARIOS_DIR, `${id}.json`), 'utf8')));
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseDurationMs(value) {
  if (!value) return undefined;
  const raw = String(value).trim();
  const match = raw.match(/^(\d+)(ms|s|m|h)?$/u);
  if (!match) throw new Error(`Invalid duration "${raw}"`);
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? 'ms';
  if (unit === 'h') return amount * 3_600_000;
  if (unit === 'm') return amount * 60_000;
  if (unit === 's') return amount * 1_000;
  return amount;
}
