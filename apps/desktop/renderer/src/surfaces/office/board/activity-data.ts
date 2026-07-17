import { isTauriRuntime } from '@/data/adapters.js';
import {
  type WorkspaceCheckpointRollbackRow,
  type WorkspaceCheckpointRow,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import { escapeRegExp, titleizeSlug } from '@/lib/utils.js';
import { useInfiniteQuery } from '@tanstack/react-query';
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
 * Office Board Timeline data model.
 *
 * The shared `data/types.ts` `ActivityEvent` is a flat presentation row. The
 * The Board Timeline needs a richer topic-based event model (the same shape
 * the runtime `EventBus` broadcasts) so it can derive level, domain icon,
 * display label, time grouping and reroute collapsing the way the prototype
 * specifies. That model lives with its Office owner and never mutates the
 * shared flat type.
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

/** A JSON-ish payload value the detail panel renders recursively. */
export type ActivityPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ActivityPayloadValue[]
  | { [key: string]: ActivityPayloadValue };

interface ActivityEntity {
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
  checkpoint?: WorkspaceCheckpointRow;
  rollback?: WorkspaceCheckpointRollbackRow;
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

interface ActivityActorDbRow {
  actor_id: string;
  employee_name: string;
  role_slug: string;
}

interface ActivityActor {
  name: string;
  role: string;
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
  approval_status: string;
  approved_by: string | null;
  created_at: string;
}

export interface MeetingActivityDbRow {
  meeting_id: string;
  thread_id: string | null;
  topic: string;
  status: string;
  summary_json: string | null;
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

function stringField(
  payload: Record<string, ActivityPayloadValue>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstLine(value: string | null): string | null {
  if (!value) return null;
  const line = value.split(/\r?\n/).find((part) => part.trim());
  return line?.trim() ?? null;
}

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

function commandFromMcpArguments(args: Record<string, ActivityPayloadValue>): string | null {
  return stringField(args, ['command', 'cmd', 'script', 'input', 'query', 'path']);
}

/* ── AC2: MCP arg/result secret redaction + size cap ─────────────────────────
 * MCP `arguments`/`result` JSON can carry whatever a tool was handed — including
 * provider keys, bearer tokens, and large blobs. Before that data enters the UI
 * payload (and the copy-to-clipboard / detail panel that renders it), strip
 * obvious secrets and cap the serialized size so the detail panel can never leak
 * a credential or choke on a megabyte of tool output. */

/** Hard cap on the serialized size of a sanitized MCP arg/result value. */
export const MAX_MCP_VALUE_CHARS = 4000;

const SECRET_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  // Provider secret/restricted keys: sk-…, rk-… (>=16 chars after the prefix).
  /\b[sr]k-[A-Za-z0-9_-]{16,}/g,
  // GitHub PATs / OAuth tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 20+ chars.
  /\bgh[pohsr]_[A-Za-z0-9]{20,}/g,
  // GitHub fine-grained PAT: github_pat_ + 20+ chars.
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // Slack tokens: xoxb-/xoxa-/xoxp-/xoxr-/xoxs-…
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // JWTs: three base64url segments joined by dots, leading `ey…`.
  /\bey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

// https://user:pass@host → https://[REDACTED]@host (keep scheme + host).
const URL_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

// key: value / key=value where the key names a credential. Capture the key +
// separator so we keep the field name and only mask the value.
const SECRET_ASSIGNMENT_RE =
  /\b(authorization|bearer|token|api[_-]?key|secret|password|access[_-]?token)(\s*[:=]\s*)("?)([^"\s,;}]+)\3/gi;

// An object key that names a credential — its VALUE is masked whole, regardless
// of the value's shape, so a secret in a `password`/`token`/… field is caught
// even when it's a plain word, a bare hex/base64 string, or a number that no
// token pattern would match.
const SECRET_KEY_NAME_RE =
  /^(?:authorization|bearer|tokens?|api[_-]?keys?|secrets?|passwo?r?d|access[_-]?tokens?|client[_-]?secrets?|private[_-]?keys?|credentials?)$/i;

/** Replace provider/secret tokens, URL creds, and key:value secrets in a string. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(URL_CREDENTIALS_RE, '$1[REDACTED]@');
  out = out.replace(SECRET_ASSIGNMENT_RE, '$1$2[REDACTED]');
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

/** Recursively redact string leaves of a structured value (objects/arrays
 *  recurse; non-strings pass through untouched) so JSON shape is preserved. */
function redactStructured(value: ActivityPayloadValue): ActivityPayloadValue {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactStructured(item));
  if (value && typeof value === 'object') {
    const out: { [key: string]: ActivityPayloadValue } = {};
    for (const [key, child] of Object.entries(value)) {
      // Redact the key itself (a secret can be used as a dynamic key), and mask
      // the whole value when the key names a credential.
      out[redactSecrets(key)] = SECRET_KEY_NAME_RE.test(key)
        ? '[REDACTED]'
        : redactStructured(child);
    }
    return out;
  }
  return value;
}

/** Redact secrets recursively, then cap by serialized size. Returns the redacted
 *  structured value when it fits, or a capped string marker when it doesn't —
 *  capping a string (never a half-serialized object) keeps the UI render safe. */
export function sanitizeMcpActivityValue(value: ActivityPayloadValue): ActivityPayloadValue {
  const redacted = redactStructured(value);
  const serialized = JSON.stringify(redacted) ?? 'null';
  if (serialized.length <= MAX_MCP_VALUE_CHARS) return redacted;
  const head = serialized.slice(0, MAX_MCP_VALUE_CHARS);
  const dropped = serialized.length - MAX_MCP_VALUE_CHARS;
  return `${head}… [truncated ${dropped} chars]`;
}

/* ── AC1: cursor-paginated activity loader ───────────────────────────────────
 * `created_at` is an ISO-8601 TEXT column, so lexicographic `<` is a valid time
 * cursor. Each of the three sources pages independently; a single merged page
 * is the newest `pageSize` rows across them, and `nextCursor` is the oldest
 * `created_at` still in the page — unless every source returned `< pageSize`
 * rows (then there is provably nothing older and the cursor is null). */

const ACTIVITY_PAGE_SIZE = 200;

/** One mapped record paired with its raw `created_at` cursor string. */
interface ActivityCursorRow {
  record: ActivityRecord;
  /** Raw `created_at` TEXT value — the lexicographic cursor. */
  createdAt: string;
}

/** A single source's page: its mapped rows plus whether it hit the page limit. */
export interface ActivitySourcePage {
  rows: ActivityCursorRow[];
  /** True when this source returned a full page (more rows may exist below). */
  saturated: boolean;
}

export interface ActivityPage {
  records: ActivityRecord[];
  /** Oldest `created_at` cursor to fetch the next page, or null at the end. */
  nextCursor: string | null;
}

/**
 * Pure merge of per-source pages into one descending-time page with a cursor.
 * `nextCursor` is null only when NO source was saturated (nothing older exists);
 * otherwise it is the oldest `created_at` present in this merged page, which the
 * next round feeds back as `created_at < cursor` to each source.
 */
export function mergeActivityPage(sources: ActivitySourcePage[], _pageSize: number): ActivityPage {
  const all = sources.flatMap((source) => source.rows);
  all.sort((a, b) => b.record.at - a.record.at);
  const records = all.map((row) => row.record);
  const anySaturated = sources.some((source) => source.saturated);
  if (!anySaturated || all.length === 0) {
    return { records, nextCursor: null };
  }
  // Oldest cursor across the merged rows (string lexicographic min).
  let oldest = all[0]?.createdAt ?? null;
  for (const row of all) {
    if (oldest === null || row.createdAt < oldest) oldest = row.createdAt;
  }
  return { records, nextCursor: oldest };
}

function runtimeRecordFromRow(row: RuntimeEventDbRow): ActivityRecord {
  const payload = parsePayload(row.payload_json);
  return {
    id: row.event_id,
    type: row.event_type,
    at: toEventTime(row.created_at),
    actor: typeof payload.actor === 'string' ? displayActorName(payload.actor) : 'Offisim',
    entity: entityFromPayload(payload, {
      label: row.event_type,
      type: 'runtime-event',
      id: row.thread_id ?? row.event_id,
    }),
    payload: { ...payload, severity: row.severity, threadId: row.thread_id ?? null },
  };
}

/** System actor slugs mapped to product vocabulary. Real employee names pass
 *  through untouched — this never fabricates a person. */
const ACTOR_DISPLAY_NAMES: Record<string, string> = {
  'pi-agent': 'Assistant',
  'desktop-provider': 'Assistant',
  api: 'Assistant',
  'workspace-lease-review': 'You',
  runtime: 'Offisim',
  boss: 'You',
};

export function displayActorName(actor: string): string {
  const knownName = ACTOR_DISPLAY_NAMES[actor];
  if (knownName) return knownName;
  if (/^(?:(?:run|attempt)-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(actor)) {
    return 'Employee';
  }
  return actor;
}

function agentRecordFromRow(
  row: AgentEventDbRow,
  actorDirectory: ReadonlyMap<string, ActivityActor>,
): ActivityRecord {
  const payload = parsePayload(row.payload_json);
  const resolvedActor = actorDirectory.get(row.agent_name);
  return {
    id: row.event_id,
    type: `agent.${row.event_type}`,
    at: toEventTime(row.created_at),
    actor: resolvedActor?.name ?? displayActorName(row.agent_name),
    entity: entityFromPayload(payload, {
      label: row.agent_name,
      type: 'agent-event',
      id: row.thread_id,
    }),
    payload: {
      ...payload,
      threadId: row.thread_id,
      agentName: row.agent_name,
      employeeRole: resolvedActor?.role,
    },
  };
}

function checkpointRecordFromRow(
  row: WorkspaceCheckpointRow,
  actorDirectory: ReadonlyMap<string, ActivityActor>,
): ActivityRecord {
  const resolvedActor = actorDirectory.get(row.runId);
  return {
    id: `checkpoint-${row.checkpointId}`,
    type: 'workspace.checkpoint',
    at: toEventTime(row.createdAt),
    actor: resolvedActor?.name ?? 'Employee',
    entity: { label: `Step ${row.step}`, type: 'workspace-checkpoint', id: row.checkpointId },
    payload: {
      checkpointId: row.checkpointId,
      leaseId: row.leaseId,
      projectId: row.projectId,
      runId: row.runId,
      rootRunId: row.rootRunId,
      step: row.step,
      triggerTool: row.triggerTool,
      changedPaths: row.changedPaths,
      employeeRole: resolvedActor?.role,
    },
    checkpoint: row,
  };
}

function rollbackRecordFromRow(row: WorkspaceCheckpointRollbackRow): ActivityRecord {
  return {
    id: `rollback-${row.rollbackId}`,
    type: 'workspace.checkpoint.rollback',
    at: toEventTime(row.rolledBackAt),
    actor: row.actor,
    entity: {
      label: `Step ${row.targetStep}`,
      type: 'workspace-checkpoint-rollback',
      id: row.rollbackId,
    },
    payload: {
      rollbackId: row.rollbackId,
      leaseId: row.leaseId,
      checkpointId: row.checkpointId,
      projectId: row.projectId,
      targetStep: row.targetStep,
      targetRef: row.targetRef,
      changedPaths: row.changedPaths,
    },
    rollback: row,
  };
}

function mcpRecordFromRow(
  row: McpAuditDbRow,
  actorDirectory: ReadonlyMap<string, ActivityActor>,
): ActivityRecord {
  const args = parsePayload(row.arguments_json);
  const result = parsePayload(row.result_json);
  // Run the same redaction over the derived command/error strings so the row
  // headline can't leak a secret that the structured sanitize would have caught.
  const rawCommand = commandFromMcpArguments(args);
  const command = rawCommand ? redactSecrets(rawCommand) : rawCommand;
  const rawError = firstLine(row.error);
  const errorSummary = rawError ? redactSecrets(rawError) : rawError;
  const failureLabel = errorSummary
    ? `${row.tool_name} failed: ${errorSummary}`
    : `${row.tool_name} failed`;
  return {
    id: row.audit_id,
    type: row.error ? 'mcp.tool.error' : 'mcp.tool.invoked',
    at: toEventTime(row.created_at),
    actor: actorDirectory.get(row.employee_id)?.name ?? displayActorName(row.employee_id),
    entity: {
      label: row.error
        ? `${row.tool_name} failed · ${row.server_name}`
        : `${row.server_name} · ${row.tool_name}`,
      type: 'mcp-tool',
      id: row.audit_id,
    },
    payload: {
      message: row.error ? failureLabel : `MCP ${row.tool_name} invoked on ${row.server_name}`,
      command,
      errorSummary,
      threadId: row.thread_id,
      employeeId: row.employee_id,
      server: row.server_name,
      tool: row.tool_name,
      latencyMs: row.latency_ms,
      approvalStatus: row.approval_status,
      approvedBy: row.approved_by,
      arguments: sanitizeMcpActivityValue(args),
      result: sanitizeMcpActivityValue(result),
      error: row.error ? redactSecrets(row.error) : row.error,
    },
  };
}

/** Preserve the meeting title and wall-clock label when projecting the old
 * Calendar source into the company timeline. */
export function meetingRecordFromRow(row: MeetingActivityDbRow): ActivityRecord {
  const at = toEventTime(row.created_at);
  const date = new Date(at);
  const timeLabel = Number.isFinite(date.getTime())
    ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown time';
  return {
    id: `meeting-${row.meeting_id}`,
    type: `meeting.${row.status}`,
    at,
    entity: { label: row.topic, type: 'meeting', id: row.meeting_id },
    payload: {
      message: `${row.topic} · ${timeLabel} · ${row.status}`,
      title: row.topic,
      timeLabel,
      status: row.status,
      threadId: row.thread_id,
      summary: parsePayload(row.summary_json),
    },
  };
}

/**
 * AC1: cursor-paginated activity loader. Each of the three sources is fetched
 * with the same `created_at < cursor` predicate (when a cursor is given) and the
 * same `pageSize` limit, then merged into one descending-time page with the
 * cursor for the next round.
 */
async function loadActivityPage(
  companyId: string,
  projectIds: readonly string[],
  options: { before?: string; pageSize?: number } = {},
): Promise<ActivityPage> {
  const pageSize = options.pageSize ?? ACTIVITY_PAGE_SIZE;
  const before = options.before ?? null;
  const db = await getTauriDb();

  // Each query takes (companyId, cursor-or-sentinel, pageSize). A null cursor is
  // passed as a value that sorts after any real ISO timestamp so the predicate
  // `created_at < cursor` is a no-op on the first page.
  const cursor = before ?? '~';
  const [runtimeRows, agentRows, mcpRows, meetingRows, checkpointTimelines] = await Promise.all([
    db.select<RuntimeEventDbRow[]>(
      `select event_id, event_type, severity, payload_json, created_at, thread_id
       from runtime_events
       where company_id = $1 and created_at < $2
         and event_type not in ('workspace.checkpoint', 'workspace.checkpoint.rollback')
       order by created_at desc
       limit $3`,
      [companyId, cursor, pageSize],
    ),
    db.select<AgentEventDbRow[]>(
      `select event_id, event_type, payload_json, created_at, thread_id, agent_name
       from agent_events
       where company_id = $1 and created_at < $2
         and event_type not in ('workspace.checkpoint', 'workspace.checkpoint.rollback')
       order by created_at desc
       limit $3`,
      [companyId, cursor, pageSize],
    ),
    db.select<McpAuditDbRow[]>(
      `select a.audit_id, a.thread_id, a.employee_id, a.server_name, a.tool_name,
              a.arguments_json, a.result_json, a.error, a.latency_ms,
              a.approval_status, a.approved_by, a.created_at
       from mcp_audit_log a
       join graph_threads t on t.thread_id = a.thread_id
       where t.company_id = $1 and a.created_at < $2
       order by a.created_at desc
       limit $3`,
      [companyId, cursor, pageSize],
    ),
    db.select<MeetingActivityDbRow[]>(
      `select meeting_id, thread_id, topic, status, summary_json, created_at
       from meeting_sessions
       where company_id = $1 and created_at < $2
       order by created_at desc
       limit $3`,
      [companyId, cursor, pageSize],
    ),
    Promise.all(
      projectIds.map((projectId) =>
        invokeCommand('workspace_checkpoint_timeline', { projectId }).catch(() => ({
          checkpoints: [],
          rollbacks: [],
        })),
      ),
    ),
  ]);

  const actorIds = Array.from(
    new Set([
      ...agentRows.map((row) => row.agent_name),
      ...mcpRows.map((row) => row.employee_id),
      ...checkpointTimelines
        .flatMap((timeline) => timeline.checkpoints)
        .filter((checkpoint) => checkpoint.createdAt < cursor)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, pageSize)
        .map((checkpoint) => checkpoint.runId),
    ]),
  );
  const actorDirectory = new Map<string, ActivityActor>();
  if (actorIds.length > 0) {
    const placeholders = actorIds.map((_, index) => `$${index + 2}`).join(', ');
    const [employeeActors, runActors] = await Promise.all([
      db.select<ActivityActorDbRow[]>(
        `select employee_id as actor_id, name as employee_name, role_slug
         from employees
         where company_id = $1 and employee_id in (${placeholders})`,
        [companyId, ...actorIds],
      ),
      db.select<ActivityActorDbRow[]>(
        `select ar.run_id as actor_id, e.name as employee_name, e.role_slug
         from agent_runs ar
         join employees e on e.employee_id = ar.employee_id
         where ar.company_id = $1 and ar.run_id in (${placeholders})`,
        [companyId, ...actorIds],
      ),
    ]);
    for (const row of [...employeeActors, ...runActors]) {
      actorDirectory.set(row.actor_id, {
        name: row.employee_name,
        role: titleizeSlug(row.role_slug),
      });
    }
  }

  const checkpointRows = checkpointTimelines
    .flatMap((timeline) => [
      ...timeline.checkpoints.map((row) => ({
        record: checkpointRecordFromRow(row, actorDirectory),
        createdAt: row.createdAt,
      })),
      ...timeline.rollbacks.map((row) => ({
        record: rollbackRecordFromRow(row),
        createdAt: row.rolledBackAt,
      })),
    ])
    .filter((row) => row.createdAt < cursor)
    .sort((a, b) => b.record.at - a.record.at);

  return mergeActivityPage(
    [
      {
        rows: runtimeRows.map((row) => ({
          record: runtimeRecordFromRow(row),
          createdAt: row.created_at,
        })),
        saturated: runtimeRows.length >= pageSize,
      },
      {
        rows: agentRows.map((row) => ({
          record: agentRecordFromRow(row, actorDirectory),
          createdAt: row.created_at,
        })),
        saturated: agentRows.length >= pageSize,
      },
      {
        rows: mcpRows.map((row) => ({
          record: mcpRecordFromRow(row, actorDirectory),
          createdAt: row.created_at,
        })),
        saturated: mcpRows.length >= pageSize,
      },
      {
        rows: meetingRows.map((row) => ({
          record: meetingRecordFromRow(row),
          createdAt: row.created_at,
        })),
        saturated: meetingRows.length >= pageSize,
      },
      {
        rows: checkpointRows.slice(0, pageSize),
        saturated: checkpointRows.length > pageSize,
      },
    ],
    pageSize,
  );
}

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

/* ── Timestamp formatting ────────────────────────────────────────────────── */

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

/* ── Query hook ──────────────────────────────────────────────────────────── */

/**
 * AC1: cursor-paginated activity feed. Page 0 fetches the newest rows; "Load
 * older" walks `nextCursor` back through history so the Board timeline reaches
 * rows past the per-source page wall.
 */
export function useActivityRecords(companyId: string, projectIds: readonly string[] = []) {
  return useInfiniteQuery<ActivityPage>({
    queryKey: ['activity-records', companyId, [...projectIds].sort()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      isTauriRuntime()
        ? loadActivityPage(companyId, projectIds, {
            before: (pageParam as string | null) ?? undefined,
          })
        : ({ records: [], nextCursor: null } satisfies ActivityPage),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
