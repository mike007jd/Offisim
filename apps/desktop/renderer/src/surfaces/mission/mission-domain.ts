import type {
  MissionCriterionRow,
  MissionEvaluationRow,
  MissionRow,
} from '@offisim/core/browser';
import type { MissionStatus } from '@offisim/shared-types';

/**
 * Pure mission-view derivations (PRD §24.3 + §29 accessibility). No I/O — these
 * map repo rows to the presentation shapes the Mission Control view renders, and
 * are covered by `mission-domain.test.ts` (the status-tone map, the legal-
 * transition gate, and the "why isn't it complete" reasons are real logic).
 */

// ---------------------------------------------------------------------------
// Registered evaluator ids (MS-003 §20.2). The Composer's evaluator dropdown
// renders from this list; each carries the declarative config the evaluator
// reads, so the Composer can offer a sensible default config + field hint.
// ---------------------------------------------------------------------------

export type EvaluatorId =
  | 'command_exit_zero'
  | 'file_exists'
  | 'file_hash'
  | 'text_contains'
  | 'json_schema'
  | 'artifact_published'
  | 'git_diff_policy'
  | 'manual_approval'
  | 'llm_rubric_review';

export interface EvaluatorMeta {
  id: EvaluatorId;
  label: string;
  /** One-line description of what the evaluator checks. */
  blurb: string;
  /** A sensible starter config (serialized as the criterion's config JSON). */
  defaultConfig: Record<string, unknown>;
  /** Whether the evaluator is deterministic (advisory-only LLM reviewer is not). */
  deterministic: boolean;
}

export const EVALUATORS: readonly EvaluatorMeta[] = [
  {
    id: 'command_exit_zero',
    label: 'Command exits 0',
    blurb: 'Run a shell command in the workspace; exit code 0 passes.',
    defaultConfig: { command: 'npm test' },
    deterministic: true,
  },
  {
    id: 'file_exists',
    label: 'File exists',
    blurb: 'A file must exist at the given workspace path.',
    defaultConfig: { path: 'README.md' },
    deterministic: true,
  },
  {
    id: 'file_hash',
    label: 'File hash matches',
    blurb: 'A file at the path must match an exact SHA-256.',
    defaultConfig: { path: '', sha256: '' },
    deterministic: true,
  },
  {
    id: 'text_contains',
    label: 'Text contains',
    blurb: 'A file at the path must contain the given marker text.',
    defaultConfig: { path: '', needle: '' },
    deterministic: true,
  },
  {
    id: 'json_schema',
    label: 'JSON matches schema',
    blurb: 'A JSON file must satisfy a minimal type + required-keys schema.',
    defaultConfig: { path: '', schema: { type: 'object', required: [] } },
    deterministic: true,
  },
  {
    id: 'artifact_published',
    label: 'Artifact published',
    blurb: 'At least one deliverable (optionally of a kind) was published.',
    defaultConfig: {},
    deterministic: true,
  },
  {
    id: 'git_diff_policy',
    label: 'Git diff within policy',
    blurb: 'Every changed path must match one of the allowed globs.',
    defaultConfig: { allowedGlobs: ['src/**'] },
    deterministic: true,
  },
  {
    id: 'manual_approval',
    label: 'Manual approval',
    blurb: 'Blocks until a human records an approval decision.',
    defaultConfig: {},
    deterministic: true,
  },
  {
    id: 'llm_rubric_review',
    label: 'LLM rubric review (advisory)',
    blurb: 'Advisory-only model review — never a hard gate.',
    defaultConfig: {},
    deterministic: false,
  },
];

const EVALUATORS_BY_ID = new Map<string, EvaluatorMeta>(EVALUATORS.map((e) => [e.id, e]));

export function evaluatorLabel(evaluatorId: string): string {
  return EVALUATORS_BY_ID.get(evaluatorId)?.label ?? evaluatorId;
}

export function evaluatorMeta(evaluatorId: string): EvaluatorMeta | undefined {
  return EVALUATORS_BY_ID.get(evaluatorId);
}

// ---------------------------------------------------------------------------
// Status presentation (§29 — never color alone: every status carries a label +
// a non-color glyph token the view maps to an icon).
// ---------------------------------------------------------------------------

export type StatusTone = 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
/** Stable glyph token; the view maps it to a lucide icon so status is legible
 *  without color. */
export type StatusGlyph =
  | 'draft'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | 'waiting';

export interface MissionStatusView {
  label: string;
  tone: StatusTone;
  glyph: StatusGlyph;
  /** Whether the mission is in a live, work-in-progress phase (animated pill). */
  active: boolean;
}

const STATUS_VIEW: Readonly<Record<MissionStatus, MissionStatusView>> = {
  draft: { label: 'Draft', tone: 'muted', glyph: 'draft', active: false },
  ready: { label: 'Ready', tone: 'accent', glyph: 'ready', active: false },
  running: { label: 'Running', tone: 'accent', glyph: 'running', active: true },
  verifying: { label: 'Verifying', tone: 'accent', glyph: 'verifying', active: true },
  repairing: { label: 'Repairing', tone: 'warn', glyph: 'running', active: true },
  awaiting_user: { label: 'Awaiting you', tone: 'warn', glyph: 'waiting', active: false },
  interrupted: { label: 'Interrupted', tone: 'warn', glyph: 'waiting', active: false },
  ready_to_resume: { label: 'Ready to resume', tone: 'accent', glyph: 'ready', active: false },
  blocked: { label: 'Blocked', tone: 'danger', glyph: 'blocked', active: false },
  failed: { label: 'Failed', tone: 'danger', glyph: 'failed', active: false },
  completed: { label: 'Completed', tone: 'ok', glyph: 'completed', active: false },
  paused: { label: 'Paused', tone: 'muted', glyph: 'paused', active: false },
  cancelled: { label: 'Cancelled', tone: 'muted', glyph: 'cancelled', active: false },
};

export function missionStatusView(status: string): MissionStatusView {
  return (
    STATUS_VIEW[status as MissionStatus] ?? {
      label: status,
      tone: 'muted',
      glyph: 'draft',
      active: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Criterion status presentation (§17.2 statuses).
// ---------------------------------------------------------------------------

export type CriterionStatus = 'pending' | 'pass' | 'fail' | 'blocked' | 'error' | 'skip';

export interface CriterionStatusView {
  label: string;
  tone: StatusTone;
  glyph: 'pass' | 'fail' | 'blocked' | 'pending' | 'error' | 'skip';
}

const CRITERION_VIEW: Readonly<Record<CriterionStatus, CriterionStatusView>> = {
  pending: { label: 'Pending', tone: 'muted', glyph: 'pending' },
  pass: { label: 'Pass', tone: 'ok', glyph: 'pass' },
  fail: { label: 'Fail', tone: 'danger', glyph: 'fail' },
  blocked: { label: 'Blocked', tone: 'warn', glyph: 'blocked' },
  error: { label: 'Error', tone: 'warn', glyph: 'error' },
  skip: { label: 'Skipped', tone: 'muted', glyph: 'skip' },
};

export function criterionStatusView(status: string): CriterionStatusView {
  return CRITERION_VIEW[status as CriterionStatus] ?? CRITERION_VIEW.pending;
}

// ---------------------------------------------------------------------------
// Legal transitions (UX-006). Mirrors MissionService's ALLOWED_TRANSITIONS for
// the three player-facing controls so the UI disables an illegal control with a
// reason instead of letting the service throw. MissionService remains the
// enforcement boundary; this is the affordance gate.
// ---------------------------------------------------------------------------

export type MissionControl = 'pause' | 'resume' | 'cancel';

const PAUSABLE: ReadonlySet<MissionStatus> = new Set([
  'ready',
  'running',
  'verifying',
  'repairing',
  'awaiting_user',
  'blocked',
]);
const RESUMABLE: ReadonlySet<MissionStatus> = new Set(['paused']);
// Terminal states have no outgoing edge — cancel is illegal there too.
const CANCELLABLE: ReadonlySet<MissionStatus> = new Set([
  'draft',
  'ready',
  'running',
  'verifying',
  'repairing',
  'awaiting_user',
  'interrupted',
  'ready_to_resume',
  'blocked',
  'paused',
]);

export interface ControlAvailability {
  enabled: boolean;
  /** When disabled, a short reason for the affordance's title/tooltip. */
  reason?: string;
}

export function controlAvailability(
  control: MissionControl,
  status: string,
): ControlAvailability {
  const s = status as MissionStatus;
  switch (control) {
    case 'pause':
      return PAUSABLE.has(s)
        ? { enabled: true }
        : { enabled: false, reason: `Cannot pause from '${status}'` };
    case 'resume':
      return RESUMABLE.has(s)
        ? { enabled: true }
        : { enabled: false, reason: 'Resume is only available while paused' };
    case 'cancel':
      return CANCELLABLE.has(s)
        ? { enabled: true }
        : { enabled: false, reason: `'${status}' is terminal — nothing to cancel` };
    default: {
      const exhaustive: never = control;
      return { enabled: false, reason: String(exhaustive) };
    }
  }
}

// ---------------------------------------------------------------------------
// "Why isn't it complete yet" — derive from the failed/pending required
// criteria (PRD §24.3). A completed mission has no blockers.
// ---------------------------------------------------------------------------

export interface IncompletionReason {
  criterionId: string;
  description: string;
  status: CriterionStatus;
  /** The criterion's latest evaluation summary, when one exists. */
  latestSummary?: string;
}

export interface IncompletionSummary {
  complete: boolean;
  /** Required criteria that are not yet PASS (the actual blockers). */
  blockers: IncompletionReason[];
  /** Count of required criteria, and how many have passed. */
  requiredTotal: number;
  requiredPassed: number;
}

/**
 * Compute why a mission is not complete: the set of REQUIRED criteria that are
 * not yet `pass` (§18.1 — every required criterion must PASS to complete). An
 * optional criterion never blocks completion, so it is excluded. Pairs each
 * blocker with its latest evaluation summary (looked up via `last_evaluation_id`)
 * so a FAIL is locatable to its evidence.
 */
export function summarizeIncompletion(
  criteria: MissionCriterionRow[],
  evaluations: MissionEvaluationRow[],
): IncompletionSummary {
  const byId = new Map(evaluations.map((e) => [e.evaluation_id, e]));
  const required = criteria.filter((c) => c.required === 1);
  const blockers: IncompletionReason[] = [];
  let requiredPassed = 0;
  for (const c of required) {
    if (c.status === 'pass') {
      requiredPassed += 1;
      continue;
    }
    const latest = c.last_evaluation_id ? byId.get(c.last_evaluation_id) : undefined;
    blockers.push({
      criterionId: c.criterion_id,
      description: c.description,
      status: c.status as CriterionStatus,
      ...(latest ? { latestSummary: latest.summary } : {}),
    });
  }
  return {
    complete: blockers.length === 0 && required.length > 0,
    blockers,
    requiredTotal: required.length,
    requiredPassed,
  };
}

// ---------------------------------------------------------------------------
// Budget parsing (UX-005). The mission's budget_json is opaque to the schema;
// the loop's caps come from MissionLoopBudget, but a budget authored in the
// Composer is stored here. Parse leniently — a malformed blob yields an empty
// budget rather than throwing.
// ---------------------------------------------------------------------------

export interface MissionBudget {
  /** Optional token cap per mission, when authored. */
  tokenBudget?: number;
  /** Optional max repair attempts, when authored. */
  maxAttempts?: number;
}

export function parseMissionBudget(budgetJson: string): MissionBudget {
  try {
    const raw = JSON.parse(budgetJson || '{}') as Record<string, unknown>;
    const out: MissionBudget = {};
    if (typeof raw.tokenBudget === 'number' && Number.isFinite(raw.tokenBudget)) {
      out.tokenBudget = raw.tokenBudget;
    }
    if (typeof raw.maxAttempts === 'number' && Number.isFinite(raw.maxAttempts)) {
      out.maxAttempts = raw.maxAttempts;
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Evidence refs — the evaluation's evidence_refs_json is a string[] (§17.4).
// Parse leniently for display.
// ---------------------------------------------------------------------------

export function parseEvidenceRefs(evidenceRefsJson: string): string[] {
  try {
    const parsed = JSON.parse(evidenceRefsJson || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Latest evaluation per criterion (by `last_evaluation_id`), for the criteria list. */
export function latestEvaluationByCriterion(
  criteria: MissionCriterionRow[],
  evaluations: MissionEvaluationRow[],
): Map<string, MissionEvaluationRow> {
  const byId = new Map(evaluations.map((e) => [e.evaluation_id, e]));
  const out = new Map<string, MissionEvaluationRow>();
  for (const c of criteria) {
    if (c.last_evaluation_id) {
      const ev = byId.get(c.last_evaluation_id);
      if (ev) out.set(c.criterion_id, ev);
    }
  }
  return out;
}

export type { MissionRow };
