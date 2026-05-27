import { isTauriRuntime } from '@/data/adapters.js';
import { resolveAsync } from '@/lib/platform.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import { useQuery } from '@tanstack/react-query';
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
 * Activity-surface data model.
 *
 * The shared `data/types.ts` `ActivityEvent` is a flat presentation row. The
 * Activity Log surface needs a richer topic-based event model (the same shape
 * the runtime `EventBus` broadcasts) so it can derive level, domain icon,
 * display label, time grouping and reroute collapsing the way the prototype
 * specifies. That model lives here, local to the surface, and never mutates the
 * shared flat type.
 */

export type ActivityDomainColor =
  | 'default'
  | 'hr'
  | 'mcp'
  | 'knowledge'
  | 'memory'
  | 'skill'
  | 'handoff'
  | 'meeting';

export type ActivityLevel = 'info' | 'warning' | 'error';

/** A JSON-ish payload value the detail panel renders recursively. */
export type ActivityPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ActivityPayloadValue[]
  | { [key: string]: ActivityPayloadValue };

export interface ActivityEntity {
  label: string;
  type?: string;
  id?: string;
}

/** One topic-based runtime event, as surfaced by the Activity Log. */
export interface ActivityRecord {
  /** Stable per-row id (`getEventId = at-type-entityId`). */
  id: string;
  /** Dotted topic, e.g. `deliverable.persisted`, `task.assignment.rerouted`. */
  type: string;
  /** Epoch ms. */
  at: number;
  /** Optional entity the event is about. */
  entity?: ActivityEntity;
  /** Structured payload (recursively rendered in the detail panel). */
  payload?: Record<string, ActivityPayloadValue>;
  /** Resolved actor label used by the actor filter / search. */
  actor?: string;
}

interface RuntimeEventDbRow {
  event_id: string;
  event_type: string;
  severity: string;
  payload_json: string | null;
  created_at: string;
  thread_id: string | null;
}

interface AgentEventDbRow {
  event_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
  thread_id: string;
  agent_name: string;
}

interface McpAuditDbRow {
  audit_id: string;
  thread_id: string;
  employee_id: string;
  server_name: string;
  tool_name: string;
  arguments_json: string;
  result_json: string | null;
  error: string | null;
  latency_ms: number;
  approved_by: string;
  created_at: string;
}

function parsePayload(json: string | null | undefined): Record<string, ActivityPayloadValue> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, ActivityPayloadValue>)
      : { value: String(parsed) };
  } catch {
    return { raw: json };
  }
}

function toEventTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function entityFromPayload(
  payload: Record<string, ActivityPayloadValue>,
  fallback: ActivityEntity,
): ActivityEntity {
  const label =
    (typeof payload.message === 'string' && payload.message) ||
    (typeof payload.name === 'string' && payload.name) ||
    (typeof payload.employeeName === 'string' && payload.employeeName) ||
    fallback.label;
  return {
    ...fallback,
    label,
  };
}

async function loadRuntimeActivityRecords(companyId: string): Promise<ActivityRecord[]> {
  const db = await getTauriDb();
  const [runtimeRows, agentRows, mcpRows] = await Promise.all([
    db.select<RuntimeEventDbRow[]>(
      `select event_id, event_type, severity, payload_json, created_at, thread_id
       from runtime_events
       where company_id = $1
       order by created_at desc
       limit 200`,
      [companyId],
    ),
    db.select<AgentEventDbRow[]>(
      `select event_id, event_type, payload_json, created_at, thread_id, agent_name
       from agent_events
       where company_id = $1
       order by created_at desc
       limit 200`,
      [companyId],
    ),
    db.select<McpAuditDbRow[]>(
      `select a.audit_id, a.thread_id, a.employee_id, a.server_name, a.tool_name,
              a.arguments_json, a.result_json, a.error, a.latency_ms, a.approved_by, a.created_at
       from mcp_audit_log a
       join graph_threads t on t.thread_id = a.thread_id
       where t.company_id = $1
       order by a.created_at desc
       limit 200`,
      [companyId],
    ),
  ]);

  const runtimeRecords: ActivityRecord[] = runtimeRows.map((row) => {
    const payload = parsePayload(row.payload_json);
    return {
      id: row.event_id,
      type: row.event_type,
      at: toEventTime(row.created_at),
      actor: typeof payload.actor === 'string' ? payload.actor : 'runtime',
      entity: entityFromPayload(payload, {
        label: row.event_type,
        type: 'runtime-event',
        id: row.thread_id ?? row.event_id,
      }),
      payload: { ...payload, severity: row.severity, threadId: row.thread_id ?? null },
    };
  });

  const agentRecords: ActivityRecord[] = agentRows.map((row) => {
    const payload = parsePayload(row.payload_json);
    return {
      id: row.event_id,
      type: `agent.${row.event_type}`,
      at: toEventTime(row.created_at),
      actor: row.agent_name,
      entity: entityFromPayload(payload, {
        label: row.agent_name,
        type: 'agent-event',
        id: row.thread_id,
      }),
      payload: { ...payload, threadId: row.thread_id, agentName: row.agent_name },
    };
  });

  const mcpRecords: ActivityRecord[] = mcpRows.map((row) => {
    const args = parsePayload(row.arguments_json);
    const result = parsePayload(row.result_json);
    return {
      id: row.audit_id,
      type: row.error ? 'mcp.tool.error' : 'mcp.tool.invoked',
      at: toEventTime(row.created_at),
      actor: row.employee_id,
      entity: {
        label: `${row.server_name} · ${row.tool_name}`,
        type: 'mcp-tool',
        id: row.audit_id,
      },
      payload: {
        message: row.error
          ? `MCP ${row.tool_name} failed on ${row.server_name}`
          : `MCP ${row.tool_name} invoked on ${row.server_name}`,
        threadId: row.thread_id,
        employeeId: row.employee_id,
        server: row.server_name,
        tool: row.tool_name,
        latencyMs: row.latency_ms,
        approvedBy: row.approved_by,
        arguments: args,
        result,
        error: row.error,
      },
    };
  });

  return [...runtimeRecords, ...agentRecords, ...mcpRecords].sort((a, b) => b.at - a.at);
}

/* ── Date presets ────────────────────────────────────────────────────────── */

export type DatePreset = 'today' | '7d' | '30d' | 'all';

export const DATE_PRESETS: ReadonlyArray<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

/* ── Event type options ──────────────────────────────────────────────────── */

export interface EventTypeOption {
  /** Stable filter value (also the select option value). */
  value: string;
  label: string;
}

/** The 18 named event-type filters (label → topic prefixes). `all` is implicit. */
export const ALL_EVENT_TYPES: ReadonlyArray<EventTypeOption> = [
  { value: 'node', label: 'Node' },
  { value: 'plan', label: 'Plan' },
  { value: 'task', label: 'Task' },
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'employee', label: 'Employee' },
  { value: 'install', label: 'Install' },
  { value: 'skill', label: 'Skill' },
  { value: 'llm', label: 'LLM' },
  { value: 'interaction', label: 'Interaction' },
  { value: 'error', label: 'Error' },
  { value: 'mcp', label: 'MCP' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'hr', label: 'HR' },
  { value: 'memory', label: 'Memory' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'git', label: 'Git' },
  { value: 'attachment', label: 'Attachment' },
];

/** Each filter value maps to the topic prefixes it accepts. */
const TYPE_PREFIX_MAP: Record<string, string[]> = {
  node: ['graph.node.', 'graph.'],
  plan: ['plan.'],
  task: ['task.'],
  deliverable: ['deliverable.'],
  employee: ['employee.'],
  install: ['install.'],
  skill: ['skill.'],
  llm: ['llm.', 'cost.'],
  interaction: ['interaction.', 'chat.', 'direct.chat.'],
  error: ['error.'],
  mcp: ['mcp.'],
  knowledge: ['knowledge.'],
  meeting: ['meeting.', 'direct.chat.'],
  hr: ['hr.'],
  memory: ['memory.'],
  infrastructure: ['rack.', 'slot.', 'binding.', 'cost.'],
  git: ['git.'],
  attachment: ['attachment.'],
};

/* ── Domain icon ─────────────────────────────────────────────────────────── */

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

function titleFromTopic(type: string): string {
  return type.replaceAll('.', ' / ');
}

/** Resolve the human label shown on a row. Dedicated formatters win, then the
 *  payload message/name fields, then a topic-derived fallback. */
export function getDisplayLabel(record: ActivityRecord): string {
  const { type, payload } = record;

  if (type === 'task.assignment.rerouted') {
    const reason = (payload?.reason as string) ?? 'unspecified';
    return `task assignment rerouted → ${reason}`;
  }
  if (type === 'skill.install.outcome') {
    const action = (payload?.action as string) ?? 'installed';
    const who = (payload?.employeeName as string) ?? (payload?.actor as string);
    return who
      ? `skill.install.outcome — ${action} by ${who}`
      : `skill.install.outcome — ${action}`;
  }

  if (payload) {
    const message = payload.message ?? payload.nodeName ?? payload.employeeName ?? payload.name;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return titleFromTopic(type);
}

/* ── Filter pipeline ─────────────────────────────────────────────────────── */

export interface ActivityFilters {
  datePreset: DatePreset;
  /** Selected event type filter value, or 'all'. */
  eventType: string;
  /** Selected actor filter value, or 'all'. */
  actor: string;
  search: string;
}

function datePresetCutoff(preset: DatePreset, now: number): number {
  const day = 24 * 60 * 60 * 1000;
  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (preset === '7d') return now - 7 * day;
  if (preset === '30d') return now - 30 * day;
  return Number.NEGATIVE_INFINITY;
}

function matchesType(type: string, filter: string): boolean {
  if (filter === 'all') return true;
  const prefixes = TYPE_PREFIX_MAP[filter];
  if (!prefixes) return type.startsWith(`${filter}.`);
  return prefixes.some((p) => type.startsWith(p));
}

/** Apply the date → type → actor → search pipeline. */
export function filterRecords(
  records: ActivityRecord[],
  filters: ActivityFilters,
  now: number = Date.now(),
): ActivityRecord[] {
  const cutoff = datePresetCutoff(filters.datePreset, now);
  const search = filters.search.trim().toLowerCase();
  return records.filter((record) => {
    if (record.at < cutoff) return false;
    if (!matchesType(record.type, filters.eventType)) return false;
    if (filters.actor !== 'all' && record.actor !== filters.actor) return false;
    if (search) {
      const haystack =
        `${record.type} ${getDisplayLabel(record)} ${record.entity?.type ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/** Distinct, sorted actor filter options derived from the events. */
export function getAvailableActorFilters(records: ActivityRecord[]): EventTypeOption[] {
  const seen = new Set<string>();
  for (const record of records) {
    if (record.actor) seen.add(record.actor);
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
}

/* ── Time grouping ───────────────────────────────────────────────────────── */

export type TimeBucketKey = 'today' | 'yesterday' | 'this-week' | 'this-month' | 'older';

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

/* ── Timestamp formatting ────────────────────────────────────────────────── */

const fullTimestampFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Absolute timestamp for the detail panel. */
export function formatFullTimestamp(at: number): string {
  return fullTimestampFmt.format(at);
}

/** Relative "2m ago" timestamp for the row. */
export function formatRelativeTimestamp(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

/* ── Level → detail badge tone ───────────────────────────────────────────── */

export const LEVEL_BADGE_LABEL: Record<ActivityLevel, string> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIN = 60 * 1000;

function buildFixtures(now: number): ActivityRecord[] {
  const rows: ActivityRecord[] = [
    {
      id: 'evt-meeting-q3',
      type: 'meeting.started',
      at: now - 20 * 1000,
      entity: { label: 'Q3 launch microsite', type: 'meeting', id: 'mtg_77f2' },
      actor: 'Boss',
      payload: {
        message: 'Plan the Q3 launch microsite',
        attendees: ['Maya Chen', 'Diego Santos', 'Aria Kim'],
        agenda: 'kickoff',
      },
    },
    {
      id: 'evt-plan-step',
      type: 'plan.step.advanced',
      at: now - 1 * MIN,
      entity: { label: 'Q3 microsite plan', type: 'plan', id: 'pln_30a1' },
      actor: 'Boss',
      payload: { message: 'plan / step: drafting → review', from: 'drafting', to: 'review' },
    },
    {
      id: 'evt-emp-maya-hero',
      type: 'employee.run.progress',
      at: now - 2 * MIN,
      entity: { label: 'Maya Chen', type: 'employee', id: 'emp_4f1a' },
      actor: 'Maya Chen',
      payload: { message: 'Maya Chen — building hero section', employeeName: 'Maya Chen' },
    },
    {
      id: 'evt-reroute-1',
      type: 'task.assignment.rerouted',
      at: now - 5 * MIN,
      entity: { label: 'task-871', type: 'task', id: 'tsk_871' },
      actor: 'Boss',
      payload: { source: 'manager', reason: 'requires-local-tools', taskRunId: 'run_19' },
    },
    {
      id: 'evt-reroute-2',
      type: 'task.assignment.rerouted',
      at: now - 5 * MIN - 2 * 1000,
      entity: { label: 'task-871', type: 'task', id: 'tsk_871' },
      actor: 'Boss',
      payload: { source: 'manager', reason: 'requires-local-tools', taskRunId: 'run_19' },
    },
    {
      id: 'evt-reroute-3',
      type: 'task.assignment.rerouted',
      at: now - 5 * MIN - 4 * 1000,
      entity: { label: 'task-871', type: 'task', id: 'tsk_871' },
      actor: 'Boss',
      payload: { source: 'manager', reason: 'requires-local-tools', taskRunId: 'run_19' },
    },
    {
      id: 'evt-reroute-4',
      type: 'task.assignment.rerouted',
      at: now - 5 * MIN - 6 * 1000,
      entity: { label: 'task-871', type: 'task', id: 'tsk_871' },
      actor: 'Boss',
      payload: { source: 'manager', reason: 'requires-local-tools', taskRunId: 'run_19' },
    },
    {
      id: 'evt-skill-install',
      type: 'skill.installed',
      at: now - 11 * MIN,
      entity: { label: 'Competitive Teardown', type: 'skill', id: 'skl_ct01' },
      actor: 'Maya Chen',
      payload: { message: 'Skill installed — Competitive Teardown', source: 'market' },
    },
    {
      id: 'evt-mcp-connected',
      type: 'mcp.server.connected',
      at: now - 14 * MIN,
      entity: { label: 'filesystem', type: 'mcp-server', id: 'mcp_fs' },
      actor: 'Boss',
      payload: { message: 'MCP server connected — filesystem', transport: 'stdio', tools: 6 },
    },
    {
      id: 'evt-export-failed',
      type: 'deliverable.export.failed',
      at: now - 22 * MIN,
      entity: { label: 'launch-deck.pdf', type: 'deliverable', id: 'dlv_pdf02' },
      actor: 'Diego Santos',
      payload: {
        message: 'deliverable export failed — pdf encoder timeout',
        encoder: 'pdf',
        timeoutMs: 30000,
        draftKey: null,
      },
    },
    {
      id: 'evt-knowledge-indexed',
      type: 'knowledge.pack.indexed',
      at: now - 31 * MIN,
      entity: { label: 'brand guidelines', type: 'knowledge-pack', id: 'kp_brand' },
      actor: 'Aria Kim',
      payload: { message: 'Knowledge pack indexed — brand guidelines', chunks: 142 },
    },
    {
      id: 'evt-handoff',
      type: 'handoff.completed',
      at: now - 44 * MIN,
      entity: { label: 'design review', type: 'handoff', id: 'hnd_91' },
      actor: 'Maya Chen',
      payload: {
        message: 'handoff: Maya Chen → Aria Kim (design review)',
        from: 'Maya Chen',
        to: 'Aria Kim',
      },
    },
    {
      id: 'evt-deliverable-created',
      type: 'deliverable.created',
      at: now - 50 * MIN,
      entity: { label: 'launch-brief.md', type: 'deliverable', id: 'dlv_9c2f71' },
      actor: 'Maya Chen',
      payload: { message: 'deliverable.created — launch-brief.md', name: 'launch-brief.md' },
    },
    {
      id: 'evt-deliverable-persisted',
      type: 'deliverable.persisted',
      at: now - 51 * MIN,
      entity: { label: 'launch-brief.md', type: 'deliverable', id: 'dlv_9c2f71' },
      actor: 'Maya Chen',
      payload: {
        name: 'launch-brief.md',
        bytes: 8244,
        employeeName: 'Maya Chen',
        draftKey: null,
        contributors: [
          'Maya Chen',
          'Diego Santos',
          'Aria Kim',
          'Noah Patel',
          'Boss',
          'Manager',
          'PM',
        ],
        artifact: {
          mimeType: 'text/markdown',
          roles: ['pm', 'designer', 'developer'],
        },
        diagnostics: {},
      },
    },
    // ── Yesterday ──
    {
      id: 'evt-hr-hire',
      type: 'hr.employee.hired',
      at: now - 1 * DAY - 2 * HOUR,
      entity: { label: 'Noah Patel', type: 'employee', id: 'emp_noah' },
      actor: 'Boss',
      payload: { message: 'HR — Noah Patel hired (QA)', role: 'QA', employeeName: 'Noah Patel' },
    },
    {
      id: 'evt-memory-reinforced',
      type: 'memory.reinforced',
      at: now - 1 * DAY - 3 * HOUR,
      entity: { label: 'PR style', type: 'memory', id: 'mem_pr01' },
      actor: 'Maya Chen',
      payload: { message: 'Memory reinforced — prefers terse PR descriptions', weight: 0.8 },
    },
    {
      id: 'evt-cost-recorded',
      type: 'cost.recorded',
      at: now - 1 * DAY - 5 * HOUR,
      entity: { label: 'Runtime default model', type: 'model', id: 'mdl_default' },
      actor: 'employee:emp_4f1a',
      payload: {
        message: 'cost recorded by the configured runtime provider',
        model: 'Runtime default',
        usd: 0.0142,
      },
    },
    // ── This Week ──
    {
      id: 'evt-skill-forked',
      type: 'skill.install.outcome',
      at: now - 3 * DAY,
      entity: { label: 'Competitive Teardown', type: 'skill', id: 'skl_ct01' },
      actor: 'Maya Chen',
      payload: { action: 'forked', employeeName: 'Maya Chen' },
    },
    {
      id: 'evt-mcp-tool',
      type: 'mcp.tool.invoked',
      at: now - 3 * DAY - 4 * HOUR,
      entity: { label: 'read_file', type: 'mcp-tool', id: 'tool_read' },
      actor: 'Diego Santos',
      payload: { message: 'mcp.tool.invoked — read_file', server: 'filesystem' },
    },
    // ── This Month ──
    {
      id: 'evt-install-completed',
      type: 'install.completed',
      at: now - 12 * DAY,
      entity: { label: 'Hermes A2A peer', type: 'install', id: 'ins_hermes' },
      actor: 'Boss',
      payload: { message: 'install.completed — Hermes A2A peer', kind: 'external-employee' },
    },
    // ── Older ──
    {
      id: 'evt-company-created',
      type: 'company.created',
      at: now - 40 * DAY,
      entity: { label: 'Acme Studio', type: 'company', id: 'co_acme' },
      actor: 'Boss',
      payload: { message: 'company.created — Acme Studio', template: 'design-studio' },
    },
  ];
  return rows;
}

/* ── Query hook ──────────────────────────────────────────────────────────── */

export function useActivityRecords(companyId: string) {
  return useQuery({
    queryKey: ['activity-records', companyId],
    queryFn: () =>
      isTauriRuntime()
        ? loadRuntimeActivityRecords(companyId)
        : resolveAsync(buildFixtures(Date.now())),
  });
}
