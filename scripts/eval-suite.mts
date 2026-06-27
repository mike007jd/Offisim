/**
 * Real-task agent UX eval suite (Epic H, H1) — the definition + scoring schema.
 *
 * Anthropic's agent-eval guidance: ground-truth from the environment (not the
 * agent's self-report), explicit human checkpoints, stop conditions, transparent
 * planning, and tool/ACI coverage. This module is the HEADLESS definition: the
 * task list, each task's deterministic ground-truth checks, human checkpoints,
 * and stop conditions, plus the structured ledger schema. H2 (live) drives the
 * release `.app` with Computer Use against this suite and emits an EvalLedger.
 *
 * Pure data + validators — no Pi, no host, no `.app`. The suite reuses the
 * already-shipped Mission evaluators for deterministic scoring at H2.
 */

export type EvalCategory =
  | 'research'
  | 'file-edit'
  | 'artifact'
  | 'approval'
  | 'abort'
  | 'delegation'
  | 'mission'
  | 'recovery';

/** A deterministic, environment-derived check (NOT the agent's self-report). */
export interface EvalGroundTruth {
  readonly kind:
    | 'file_exists'
    | 'file_content'
    | 'deliverable_row'
    | 'db_status'
    | 'approval_recorded'
    | 'run_status'
    | 'no_duplicate'
    | 'tool_called'
    | 'audit_row';
  readonly description: string;
}

export interface EvalTask {
  readonly id: string;
  readonly category: EvalCategory;
  readonly title: string;
  /** The natural-language task handed to the agent in the live run. */
  readonly prompt: string;
  /** Deterministic ground-truth checks — environment facts, not self-report. */
  readonly groundTruth: readonly EvalGroundTruth[];
  /** Points where a human must verify (a visual state, an approval decision). */
  readonly humanCheckpoints: readonly string[];
  /** When the driver must stop and mark the task failed/blocked. */
  readonly stopConditions: readonly string[];
  /** Every task in this suite needs the live `.app` + Computer Use (H2). */
  readonly requiresLive: true;
}

export type EvalOutcome = 'pass' | 'fail' | 'blocked' | 'skipped';

/** One task's structured result in the ledger. */
export interface EvalResult {
  readonly taskId: string;
  readonly outcome: EvalOutcome;
  /** Whether every deterministic ground-truth check passed. */
  readonly groundTruthMet: boolean;
  readonly evidence: readonly string[];
  readonly durationMs?: number;
  /** How many times the agent asked the operator (lower is better). */
  readonly askCount?: number;
  /** Was the produced artifact actually usable (human-judged at H2)? */
  readonly artifactUsable?: boolean;
  readonly notes?: string;
}

export interface EvalLedger {
  readonly suiteVersion: string;
  readonly results: readonly EvalResult[];
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly blocked: number;
    readonly skipped: number;
  };
}

export const EVAL_SUITE_VERSION = '1';

/**
 * The eval task list. One task per capability the harness ships, each anchored
 * to a deterministic ground-truth check so the score never depends on the agent
 * claiming success.
 */
export const EVAL_SUITE: readonly EvalTask[] = [
  {
    id: 'research-web',
    category: 'research',
    title: 'Web research → cited summary',
    prompt: 'Research the current stable Tauri 2 release and summarize the top 3 breaking changes with sources.',
    groundTruth: [
      { kind: 'tool_called', description: 'a web/MCP read tool was invoked at least once' },
      { kind: 'file_content', description: 'the reply names a concrete version + cites ≥1 source URL' },
    ],
    humanCheckpoints: ['the cited facts are accurate and the sources resolve'],
    stopConditions: ['no web/read tool available', 'reply fabricates a version with no source'],
    requiresLive: true,
  },
  {
    id: 'file-edit',
    category: 'file-edit',
    title: 'Edit a workspace file',
    prompt: 'Add a one-line MIT license header to src/index.ts in the active project.',
    groundTruth: [
      { kind: 'file_content', description: 'src/index.ts now starts with the license header' },
      { kind: 'tool_called', description: 'an edit/write tool ran against the workspace path' },
    ],
    humanCheckpoints: ['the file diff is correct and nothing unrelated changed'],
    stopConditions: ['edit escapes the workspace jail', 'file untouched after the run'],
    requiresLive: true,
  },
  {
    id: 'artifact-publish',
    category: 'artifact',
    title: 'Publish a deliverable',
    prompt: 'Write a short release-notes draft and publish it as a deliverable.',
    groundTruth: [
      { kind: 'deliverable_row', description: 'a deliverables row exists with a non-null content_hash' },
      { kind: 'file_exists', description: 'the published artifact file is readable under the workspace' },
    ],
    humanCheckpoints: ['the deliverable appears in the Outputs panel and opens'],
    stopConditions: ['publish path is out-of-workspace (rejected, no row)', 'no deliverable row written'],
    requiresLive: true,
  },
  {
    id: 'ask-approval',
    category: 'approval',
    title: 'Ask-mode approval on a destructive command',
    prompt: 'In Ask mode, delete a scratch file with rm and proceed only after I approve.',
    groundTruth: [
      { kind: 'approval_recorded', description: 'an approval interaction was surfaced and answered' },
      { kind: 'db_status', description: 'the command ran only after Approve, not on Reject' },
    ],
    humanCheckpoints: ['the approval bar shows the exact command before running'],
    stopConditions: ['command runs without pausing for approval'],
    requiresLive: true,
  },
  {
    id: 'abort-run',
    category: 'abort',
    title: 'Abort a running task',
    prompt: 'Start a long task, then I will abort it mid-run.',
    groundTruth: [
      { kind: 'run_status', description: 'the run row resolves to cancelled (not running, not completed)' },
      { kind: 'no_duplicate', description: 'no orphan child run is left running after the abort' },
    ],
    humanCheckpoints: ['the UI returns to idle promptly after abort'],
    stopConditions: ['run stays running after abort', 'abort throws'],
    requiresLive: true,
  },
  {
    id: 'delegation-parallel',
    category: 'delegation',
    title: 'Parallel read delegation',
    prompt: 'Delegate three independent research subtasks to teammates in parallel and synthesize.',
    groundTruth: [
      { kind: 'run_status', description: 'three child runs completed under one root' },
      { kind: 'db_status', description: 'root usage aggregates the children without double-count' },
    ],
    humanCheckpoints: ['the run tree shows three concurrent children then a synthesis'],
    stopConditions: ['a parallel WRITE delegation is attempted (must be refused)'],
    requiresLive: true,
  },
  {
    id: 'mission-evaluation',
    category: 'mission',
    title: 'Mission with a deterministic gate',
    prompt: 'Run a mission whose criterion is command_exit_zero on the test suite.',
    groundTruth: [
      { kind: 'db_status', description: 'the mission completes ONLY when the command actually exits 0' },
      { kind: 'no_duplicate', description: 'an agent self-claim of PASS does not complete a failing gate' },
    ],
    humanCheckpoints: ['the mission status reflects the real command result'],
    stopConditions: ['mission completes while the gate command fails'],
    requiresLive: true,
  },
  {
    id: 'restart-recovery',
    category: 'recovery',
    title: 'Crash → restart → resume (Epic A)',
    prompt: 'Start a run, kill the app mid-run, restart, and recover from the recovery card.',
    groundTruth: [
      { kind: 'run_status', description: 'the dangling root is interrupted on restart (not stuck running)' },
      { kind: 'no_duplicate', description: 'Resume continues without a duplicate deliverable' },
    ],
    humanCheckpoints: ['the recovery card appears with Resume / Discard / View-partial'],
    stopConditions: ['run stays running after restart', 'Resume duplicates a deliverable'],
    requiresLive: true,
  },
];

/**
 * Validate the suite is well-formed: unique ids, every category covered, and
 * every task carries ≥1 ground-truth check + ≥1 stop condition (no self-report-
 * only task). Returns the list of problems (empty when the suite is sound).
 */
export function validateEvalSuite(suite: readonly EvalTask[] = EVAL_SUITE): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const task of suite) {
    if (ids.has(task.id)) problems.push(`duplicate task id "${task.id}"`);
    ids.add(task.id);
    if (task.groundTruth.length === 0) problems.push(`task "${task.id}" has no ground-truth check`);
    if (task.stopConditions.length === 0) problems.push(`task "${task.id}" has no stop condition`);
    if (task.humanCheckpoints.length === 0) {
      problems.push(`task "${task.id}" has no human checkpoint`);
    }
  }
  const categories = new Set(suite.map((t) => t.category));
  const required: EvalCategory[] = [
    'research',
    'file-edit',
    'artifact',
    'approval',
    'abort',
    'delegation',
    'mission',
    'recovery',
  ];
  for (const cat of required) {
    if (!categories.has(cat)) problems.push(`missing eval category "${cat}"`);
  }
  return problems;
}

/** Summarize a set of results into a ledger (the structured H2 output shape). */
export function summarizeLedger(results: readonly EvalResult[]): EvalLedger {
  return {
    suiteVersion: EVAL_SUITE_VERSION,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.outcome === 'pass').length,
      failed: results.filter((r) => r.outcome === 'fail').length,
      blocked: results.filter((r) => r.outcome === 'blocked').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
    },
  };
}
