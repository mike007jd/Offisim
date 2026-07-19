import { isTauriRuntime } from '@/data/adapters.js';
import { queryKeys } from '@/data/query-keys.js';
import { redactSecrets } from '@/data/redact-secrets.js';
import {
  type WorkspaceCheckpointRollbackRow,
  type WorkspaceCheckpointRow,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import { titleizeSlug } from '@/lib/utils.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import { WORKSPACE_DIAGNOSTICS_UPDATED_EVENT } from '@offisim/shared-types';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Board activity data model and query layer.
 *
 * The shared `data/types.ts` `ActivityEvent` is a flat presentation row. The
 * The Board Timeline consumes a richer topic-based event model (the same shape
 * the runtime `EventBus` broadcasts) so it can derive level, domain icon,
 * display label, time grouping and reroute collapsing in its presentation layer.
 * This data model remains engine-neutral and never mutates the shared flat type.
 */

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

// An object key that names a credential — its VALUE is masked whole, regardless
// of the value's shape, so a secret in a `password`/`token`/… field is caught
// even when it's a plain word, a bare hex/base64 string, or a number that no
// token pattern would match.
const SECRET_KEY_NAME_RE =
  /^(?:authorization|bearer|tokens?|api[_-]?keys?|secrets?|passwo?r?d|access[_-]?tokens?|client[_-]?secrets?|private[_-]?keys?|credentials?)$/i;

export { redactSecrets } from '@/data/redact-secrets.js';

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

/**
 * AC1: cursor-paginated activity feed. Page 0 fetches the newest rows; "Load
 * older" walks `nextCursor` back through history so the Board timeline reaches
 * rows past the per-source page wall.
 */
export function useActivityRecords(companyId: string, projectIds: readonly string[] = []) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      runtimeEventBus.on(WORKSPACE_DIAGNOSTICS_UPDATED_EVENT, (event) => {
        if (event.companyId === companyId) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.activityRecordsCompany(companyId),
          });
        }
      }),
    [companyId, queryClient],
  );
  return useInfiniteQuery<ActivityPage>({
    queryKey: queryKeys.activityRecords(companyId, projectIds),
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
