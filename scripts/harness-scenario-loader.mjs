import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCENARIOS_DIR = resolve(ROOT, 'packages/core/harness/scenarios');

export const REPLAY_SCENARIO_IDS = [
  'completion-verifier-persists-blocked-status',
  'dag-output-attribution',
  'direct-mode-skips-boss-chain',
  'kanban-card-state-transitions',
  'mode-kanban-matrix',
  'permission-ask-approved-blocks-and-then-executes',
  'permission-ask-denied-does-not-execute',
  'pm-planner-clears-stale-dispatch-state',
  'plan-review-cancel-terminates',
  'plan-review-approve-survives-restore',
  'skill-create-real-tool-call',
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
