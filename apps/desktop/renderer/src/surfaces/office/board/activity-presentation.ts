import type { ActivityRecord } from '@/data/board/activity-data.js';
import { escapeRegExp } from '@/lib/utils.js';
import {
  Activity,
  ArrowRightLeft,
  BookOpen,
  Lightbulb,
  type LucideIcon,
  Plug,
  Puzzle,
  UserCheck,
  Users,
} from 'lucide-react';

/**
 * Board-only mappings from activity data to icons, levels, labels, grouping, and relative time.
 */

type ActivityDomainColor =
  | 'default'
  | 'hr'
  | 'mcp'
  | 'knowledge'
  | 'memory'
  | 'skill'
  | 'handoff'
  | 'meeting';

export type ActivityLevel = 'info' | 'warning' | 'error';

/** Keep project file labels readable and prevent an unexpected absolute path
 * from leaking the local workspace location into Timeline. */
export function checkpointPathForDisplay(path: string, workspaceRoot: string): string {
  const normalized = path.replaceAll('\\', '/');
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/$/, '');
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  if (!normalized.startsWith('/')) return normalized.replace(/^\.\//, '');
  return normalized.split('/').filter(Boolean).at(-1) ?? 'Changed file';
}

export interface DomainIcon {
  icon: LucideIcon;
  color: ActivityDomainColor;
}

const DOMAIN_ICON_TABLE: ReadonlyArray<{ prefix: string; icon: DomainIcon }> = [
  { prefix: 'hr.', icon: { icon: UserCheck, color: 'hr' } },
  { prefix: 'mcp.', icon: { icon: Plug, color: 'mcp' } },
  { prefix: 'knowledge.', icon: { icon: BookOpen, color: 'knowledge' } },
  { prefix: 'memory.', icon: { icon: Lightbulb, color: 'memory' } },
  { prefix: 'skill.', icon: { icon: Puzzle, color: 'skill' } },
  { prefix: 'handoff.', icon: { icon: ArrowRightLeft, color: 'handoff' } },
  { prefix: 'meeting.', icon: { icon: Users, color: 'meeting' } },
  { prefix: 'direct.chat.', icon: { icon: Users, color: 'meeting' } },
];

/** Pick the icon + colour for a topic by its prefix (default = Activity). */
export function domainIcon(type: string): DomainIcon {
  for (const entry of DOMAIN_ICON_TABLE) {
    if (type.startsWith(entry.prefix)) return entry.icon;
  }
  return { icon: Activity, color: 'default' };
}

/* ── Level derivation ────────────────────────────────────────────────────── */

const ERROR_TOKENS = ['failed', 'error', 'rolled_back', 'rollback'];
const WARNING_TOKENS = ['blocked', 'warning', 'rejected', 'aborted', 'rerouted'];

/** Derive level from the topic only. */
export function getEventLevel(type: string): ActivityLevel {
  const lower = type.toLowerCase();
  if (ERROR_TOKENS.some((token) => lower.includes(token))) return 'error';
  if (WARNING_TOKENS.some((token) => lower.includes(token))) return 'warning';
  return 'info';
}

/* ── Display label ───────────────────────────────────────────────────────── */

const KNOWN_TOPIC_LABELS: Record<string, string> = {
  'agent.action': 'Employee completed an action',
  'agent.decision': 'Employee recorded a decision',
  'agent.workspace_chat.message': 'Sent a message in the workspace',
  'agent.direct_chat.message': 'Sent a message',
  'agent.conversation.run.tool': 'Ran a tool',
  'agent.conversation.compact.completed': 'Compacted the conversation',
  'agent.conversation.synopsis.updated': 'Updated the conversation summary',
  'agent.workspace.lease.snapshot': 'saved workspace progress',
  'agent.workspace.lease.action': 'reviewed workspace changes',
  'workspace.checkpoint': 'saved a change checkpoint',
  'workspace.checkpoint.rollback': 'rolled back workspace changes',
  'agent.mission.resumed': 'Resumed a mission',
  'agent.mission.status.changed': 'Mission status changed',
  'agent.mission.evaluation.submitted': 'Submitted a mission evaluation',
  'agent.company.created': 'Created the company',
  'boss.route.decided': 'Boss routed the task',
  'pm-preflight-cancelled': 'Preflight was cancelled',
};

const WORKSPACE_SNAPSHOT_LABELS: Record<string, string> = {
  acquired: 'started an isolated workspace',
  verifying: 'checked workspace changes',
  verified: 'verified workspace changes',
  repairing: 'repaired workspace changes',
  verification_terminated: 'recorded the verification result',
};

const WORKSPACE_ACTION_LABELS: Record<string, string> = {
  merge_completed: 'merged the workspace changes',
  discard_completed: 'discarded the workspace changes',
  changes_requested: 'sent the workspace changes back for revision',
};

/** Topic words that read as acronyms — naive Title-Case would render "Mcp". */
const TOPIC_ACRONYMS = new Set(['mcp', 'llm', 'hr', 'a2a', 'api', 'pdf']);

function titleFromTopic(type: string): string {
  if (KNOWN_TOPIC_LABELS[type]) return KNOWN_TOPIC_LABELS[type];

  const words = type
    .replace(/^agent[._-]/, '')
    .replace(/^boss[._-]/, 'boss ')
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .trim()
    .split(/\s+/);
  if (words.length === 0) return type;
  return words
    .map((word) =>
      TOPIC_ACRONYMS.has(word) ? word.toUpperCase() : word[0]?.toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** Raw machine-syntax payload messages (dotted-topic prefixes, " — " metadata
 *  joins, "x: a → b" pipes) read as log lines, not sentences. Rows fall back to
 *  the topic title and let the entity suffix carry the specifics. */
function isMachineFormattedMessage(message: string): boolean {
  if (/^[a-z][\w-]*(?:\.[\w-]+)+/.test(message)) return true;
  if (message.includes(' — ')) return true;
  return /^[^:\n]+: [^\n]*→/.test(message);
}

/** Resolve the human label shown on a row. Dedicated formatters win, then the
 *  payload message/name fields, then a topic-derived fallback. */
function getDisplayLabel(record: ActivityRecord): string {
  const { type, payload } = record;

  if (type === 'workspace.checkpoint') {
    const step = typeof payload?.step === 'number' ? payload.step : null;
    const changedPaths = Array.isArray(payload?.changedPaths) ? payload.changedPaths : [];
    const role = typeof payload?.employeeRole === 'string' ? payload.employeeRole : null;
    const fileLabel = `${changedPaths.length} ${changedPaths.length === 1 ? 'file' : 'files'}`;
    return [role, 'saved a change checkpoint', step === null ? null : `Step ${step}`, fileLabel]
      .filter(Boolean)
      .join(' · ');
  }
  if (type === 'workspace.checkpoint.rollback') {
    const step = typeof payload?.targetStep === 'number' ? payload.targetStep : null;
    return step === null ? 'rolled back workspace changes' : `rolled back to Step ${step}`;
  }
  if (type === 'agent.workspace.lease.snapshot') {
    const role = typeof payload?.employeeRole === 'string' ? payload.employeeRole : null;
    const phase = typeof payload?.phase === 'string' ? payload.phase : null;
    const action = phase?.startsWith('released')
      ? 'finished the isolated workspace'
      : (phase && WORKSPACE_SNAPSHOT_LABELS[phase]) || 'saved workspace progress';
    return role ? `${role} · ${action}` : action;
  }
  if (type === 'agent.workspace.lease.action') {
    const action = typeof payload?.action === 'string' ? payload.action : null;
    return (action && WORKSPACE_ACTION_LABELS[action]) || 'reviewed workspace changes';
  }
  if (type === 'agent.conversation.run.tool') {
    const toolName = typeof payload?.toolName === 'string' ? payload.toolName : null;
    const failed = payload?.status === 'failed';
    const action =
      toolName === 'read'
        ? 'read a project file'
        : toolName === 'write' || toolName === 'edit'
          ? 'update a project file'
          : toolName === 'bash'
            ? 'run a workspace command'
            : toolName === 'delegate'
              ? 'delegate work to an employee'
              : 'use a workspace tool';
    return failed ? `tried to ${action}` : action.replace(/^./, (letter) => letter.toUpperCase());
  }

  if (type === 'task.assignment.rerouted') {
    const reason = (payload?.reason as string) ?? 'unspecified';
    return `Task assignment rerouted: ${reason}`;
  }
  if (type === 'skill.install.outcome') {
    const action = (payload?.action as string) ?? 'installed';
    const who = (payload?.employeeName as string) ?? (payload?.actor as string);
    return who ? `Skill ${action} by ${who}` : `Skill ${action}`;
  }
  if (type === 'agent.error') {
    if (payload?.message === 'pm-preflight-cancelled') return 'Preflight was cancelled';
    return 'Employee hit an error';
  }
  if (type === 'plan.step.advanced') {
    const from = typeof payload?.from === 'string' ? payload.from : null;
    const to = typeof payload?.to === 'string' ? payload.to : null;
    return from && to ? `Plan step advanced: ${from} → ${to}` : 'Plan step advanced';
  }
  if (type === 'handoff.completed') {
    // No actor in the label — getDisplaySummary leads with WHO (the `from` side).
    const to = typeof payload?.to === 'string' ? payload.to : null;
    return to ? `Handed off to ${to}` : 'Handoff completed';
  }
  // Deliverable names live on the entity; the row suffixes them already.
  if (type === 'deliverable.created') return 'Deliverable created';
  if (type === 'deliverable.persisted') return 'Deliverable saved';
  if (type.startsWith('deliverable.export.')) {
    const outcome = type.slice('deliverable.export.'.length).replaceAll(/[._-]+/g, ' ');
    return outcome === 'completed' ? 'Deliverable exported' : `Deliverable export ${outcome}`;
  }
  if (KNOWN_TOPIC_LABELS[type]) return KNOWN_TOPIC_LABELS[type];

  if (payload) {
    const message = payload.message ?? payload.nodeName ?? payload.employeeName ?? payload.name;
    if (typeof message === 'string' && message.length > 0 && !isMachineFormattedMessage(message)) {
      return message;
    }
  }
  return titleFromTopic(type);
}

/** Row headline: lead with WHO when we know it — "Maya Lin · completed an action". */
export function getDisplaySummary(record: ActivityRecord): { actor: string | null; label: string } {
  const label = getDisplayLabel(record);
  const actor = record.actor ?? null;
  if (!actor) return { actor: null, label };
  // Some labels already name the actor (e.g. "Skill installed by Maya Chen") — don't
  // repeat it. Word-boundary match so short actors ("Sam") don't hit substrings ("Sample").
  if (new RegExp(`\\b${escapeRegExp(actor)}\\b`, 'i').test(label)) return { actor: null, label };
  // Strip the generic "Employee " / "Agent " prefix when an actor name replaces it.
  const trimmed = label.replace(/^(?:Agent|Employee)\s+/i, '');
  return { actor, label: trimmed };
}

/* ── Time grouping ───────────────────────────────────────────────────────── */

type TimeBucketKey = 'today' | 'yesterday' | 'this-week' | 'this-month' | 'older';

export interface TimeGroup {
  key: TimeBucketKey;
  label: string;
  records: ActivityRecord[];
}

const BUCKET_LABEL: Record<TimeBucketKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This Week',
  'this-month': 'This Month',
  older: 'Older',
};

const BUCKET_ORDER: TimeBucketKey[] = ['today', 'yesterday', 'this-week', 'this-month', 'older'];

function bucketFor(at: number, now: number): TimeBucketKey {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart.getTime() - 24 * 60 * 60 * 1000;

  // Monday 00:00 of the current week.
  const weekStart = new Date(todayStart);
  const dow = (weekStart.getDay() + 6) % 7; // 0 = Monday
  weekStart.setDate(weekStart.getDate() - dow);

  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  if (at >= todayStart.getTime()) return 'today';
  if (at >= yesterdayStart) return 'yesterday';
  if (at >= weekStart.getTime()) return 'this-week';
  if (at >= monthStart.getTime()) return 'this-month';
  return 'older';
}

/** Group records into the 5 time buckets, sorted desc within each; empty
 *  buckets are dropped. */
export function groupByTime(records: ActivityRecord[], now: number = Date.now()): TimeGroup[] {
  const buckets = new Map<TimeBucketKey, ActivityRecord[]>();
  for (const record of records) {
    const key = bucketFor(record.at, now);
    const list = buckets.get(key);
    if (list) list.push(record);
    else buckets.set(key, [record]);
  }
  const groups: TimeGroup[] = [];
  for (const key of BUCKET_ORDER) {
    const list = buckets.get(key);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => b.at - a.at);
    groups.push({ key, label: BUCKET_LABEL[key], records: list });
  }
  return groups;
}

/* ── Reroute collapse ────────────────────────────────────────────────────── */

/** A flattened, optionally collapsed timeline row. */
export interface TimelineRow {
  record: ActivityRecord;
  /** When >1, this row is a collapsed run of consecutive reroutes. */
  collapsedCount?: number;
}

function rerouteSignature(record: ActivityRecord): string {
  const p = record.payload ?? {};
  return `${p.source ?? ''}|${p.reason ?? ''}|${p.taskRunId ?? ''}`;
}

/** Fold runs of 3+ consecutive `task.assignment.rerouted` events that share
 *  source|reason|taskRunId into a single ×N row. Runs <3 stay expanded. */
export function collapseReroutes(records: ActivityRecord[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < records.length) {
    const record = records[i];
    if (!record) {
      i += 1;
      continue;
    }
    if (record.type === 'task.assignment.rerouted') {
      const signature = rerouteSignature(record);
      let j = i + 1;
      while (j < records.length) {
        const next = records[j];
        if (
          !next ||
          next.type !== 'task.assignment.rerouted' ||
          rerouteSignature(next) !== signature
        ) {
          break;
        }
        j += 1;
      }
      const runLength = j - i;
      if (runLength >= 3) {
        rows.push({ record, collapsedCount: runLength });
        i = j;
        continue;
      }
    }
    rows.push({ record });
    i += 1;
  }
  return rows;
}
