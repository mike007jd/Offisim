import { useUiState } from '@/app/ui-state.js';
import { displayThreadTitle, isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import {
  loadProjectChatThreadRows,
  projectChatThreadRowsQueryKey,
  useProjects,
} from '@/data/queries.js';
import type { ChatToolCall, Employee } from '@/data/types.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import type { MeetingSessionRow } from '@offisim/core/browser';
import { useQuery } from '@tanstack/react-query';

/**
 * Workspace-suite view-models + local query hooks.
 *
 * These models are owned by the Workspace surface and intentionally diverge from
 * the (legacy / incorrect) `@/data/types` `Approval` / `CalendarEvent` shapes:
 * the suite re-surfaces real product concepts — the four AI run-gates, the
 * NotificationCenter feed as a bot channel, file attachments, the employee
 * roster as Contacts, and the agenda of meetings / runs / ceremonies / deadlines.
 *
 * Employee identity is shared: callers join these by `employeeId` against
 * `useEmployees()`.
 */

/* ── Messenger conversation list ─────────────────────────────────────────── */

type ConvKind = 'group' | 'direct' | 'system' | 'external';
export type Presence = 'working' | 'idle' | 'blocked' | 'offline';

export interface WsConversation {
  id: string;
  kind: ConvKind;
  /** Display title (group name / employee name / "System"). */
  title: string;
  /** Joined to `useEmployees()` for direct / external rows (avatar + presence). */
  employeeId: string | null;
  presence?: Presence;
  /** L2 snippet preview. */
  snippet: string;
  timeLabel: string;
  /** Unread count badge (omit / 0 = none). */
  unread?: number;
  /** Last message was read by the recipient (direct rows). */
  read?: boolean;
  /** Muted conversation (megaphone glyph instead of unread). */
  muted?: boolean;
  /** Section the row sorts into. */
  section?: 'pinned' | 'earlier';
  /** Header sub line + member/working counts (group). */
  members?: number;
  workingNow?: number;
}

/* ── Messenger message stream (group / direct) ───────────────────────────── */

export interface WsAttachment {
  id: string;
  name: string;
  meta: string;
}

interface WsDeliverableCard {
  id: string;
  title: string;
  meta: string;
  format: string;
  contributorIds: string[];
  /** Exportable artifact body. Omit when the thread only has metadata. */
  content?: string;
}

export interface WsMessage {
  id: string;
  author: 'boss' | 'employee';
  employeeId: string | null;
  /** Role chip shown next to employee name. */
  role?: string;
  timeLabel: string;
  /** Epoch ms the message was created. */
  at?: number;
  body: string;
  reasoning?: string;
  /** Live + in-session tool steps; not persisted (lost on reload by design). */
  toolCalls?: ChatToolCall[];
  attachment?: WsAttachment;
  deliverable?: WsDeliverableCard;
}

export interface WsThread {
  messages: WsMessage[];
}

/* ── Contacts (the employee directory KV view) ───────────────────────────── */

export interface ContactDetail {
  /** Live presence statement, e.g. "Working now — Edge case review". */
  presence: Presence;
  presenceNote?: string;
  /** Zone label, e.g. "Engineering (workstation E-2)". */
  zone: string;
  model?: string;
  expertise: string;
  tools: string;
  toolsNote?: string;
  decisionStyle: string;
  openChats: string;
  source: string;
  /** Group the contact sorts under (zone, or 'Unassigned'). */
  group: string;
}

/* ── Calendar agenda ─────────────────────────────────────────────────────── */

type EventKind = 'meeting' | 'run' | 'ceremony' | 'deadline';

export interface AgendaEvent {
  id: string;
  kind: EventKind;
  title: string;
  timeLabel: string;
  note: string;
}

export interface AgendaDay {
  id: string;
  weekday: string;
  date: string;
  today?: boolean;
  events: AgendaEvent[];
}

/* ── Meetings + action items ─────────────────────────────────────────────── */

interface WsActionItem {
  id: string;
  text: string;
  ownerId: string | null;
  done: boolean;
}

export interface WsMeeting {
  id: string;
  title: string;
  status: 'live' | 'upcoming' | 'ended';
  /** Sub line, e.g. "Today 09:30 · 12 min · 4 attendees · ended". */
  sub: string;
  timeLabel: string;
  attendeeIds: string[];
  threadId: string;
  actionItems: WsActionItem[];
}

/* ── Query hooks ─────────────────────────────────────────────────── */

/**
 * Real conversation list = the active project's non-archived chat_threads
 * (employee_id set => direct, null => group). No presence/unread/snippet beyond
 * the real summary — those have no backing column.
 */
export function useWsConversations() {
  const projectId = useUiState((s) => s.projectId);
  return useQuery({
    queryKey: projectChatThreadRowsQueryKey(projectId),
    queryFn: () => loadProjectChatThreadRows(projectId),
    select: (rows): WsConversation[] => {
      return rows.map((row) => ({
        id: row.thread_id,
        kind: row.employee_id ? 'direct' : 'group',
        title: displayThreadTitle(row.title),
        employeeId: row.employee_id ?? null,
        snippet: row.summary ?? '',
        timeLabel: Number.isFinite(Date.parse(row.updated_at))
          ? ageLabelFrom(Date.parse(row.updated_at), Date.now())
          : '',
      }));
    },
  });
}

export function useWsThread(conversationId: string | null) {
  return useQuery({
    queryKey: ['ws', 'thread', conversationId],
    queryFn: async (): Promise<WsThread | null> => {
      if (!conversationId) return null;
      const repos = await reposOrNull();
      if (!repos) return { messages: [] };
      // The message stream is the persisted agent_events feed rendered by
      // WorkspaceAssistantThread. Return an honest empty seed — no fabricated
      // messages on top of the real persisted ones.
      return { messages: [] };
    },
    enabled: conversationId !== null,
  });
}

function ageLabelFrom(createdAtMs: number, now: number): string {
  const diff = Math.max(0, now - createdAtMs);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}

/* ── Contacts detail real-bind (employee row + workstation zone + chat count) ─ */

interface WorkstationLabelRow {
  employee_id: string;
  zone_label: string | null;
}
interface DirectChatCountRow {
  employee_id: string;
  n: number;
}

/**
 * Real per-employee Contacts detail, derived from the employee row + the office
 * workstation it is seated at + a direct-chat count. No presumptuous default:
 * fields with no persisted source (tools / decision style / live working-or-
 * blocked presence) render an em dash.
 */
async function loadContactDetails(
  companyId: string | null,
  employees: readonly Employee[],
): Promise<Record<string, ContactDetail>> {
  if (employees.length === 0) return {};
  const db = await getTauriDb();
  const [wsRows, chatRows] = await Promise.all([
    db.select<WorkstationLabelRow[]>(
      `select e.employee_id as employee_id, w.label as zone_label
         from employees e
         left join workstations w on w.workstation_id = e.workstation_id
        where e.company_id = $1`,
      [companyId ?? ''],
    ),
    db.select<DirectChatCountRow[]>(
      `select ct.employee_id as employee_id, count(*) as n
         from chat_threads ct
         join projects p on p.project_id = ct.project_id
        where p.company_id = $1
          and ct.employee_id is not null
          and ct.archived_at is null
        group by ct.employee_id`,
      [companyId ?? ''],
    ),
  ]);
  const zoneByEmp = new Map<string, string>();
  for (const r of wsRows)
    if (r.zone_label?.trim()) zoneByEmp.set(r.employee_id, r.zone_label.trim());
  const chatByEmp = new Map<string, number>();
  for (const r of chatRows) chatByEmp.set(r.employee_id, Number(r.n) || 0);

  const out: Record<string, ContactDetail> = {};
  for (const e of employees) {
    const zone = zoneByEmp.get(e.id) ?? e.zoneLabel ?? '';
    const directChats = chatByEmp.get(e.id) ?? 0;
    const group = zone || 'Unassigned';
    out[e.id] = {
      presence: e.online ? 'idle' : 'offline',
      zone: zone || '—',
      model: e.modelLabel,
      expertise: e.expertise && e.expertise.length > 0 ? e.expertise.join(' · ') : '—',
      tools: '—',
      decisionStyle: '—',
      openChats: directChats === 1 ? '1 direct' : `${directChats} direct`,
      source:
        e.kind === 'external'
          ? e.brandLabel
            ? `External · ${e.brandLabel} (A2A)`
            : 'External (A2A)'
          : 'Internal employee',
      group,
    };
  }
  return out;
}

export function useWsContactDetails(employees: readonly Employee[] = []) {
  const companyId = useUiState((s) => s.companyId);
  const employeeIds = employees.map((employee) => employee.id).join('|');
  return useQuery({
    queryKey: ['ws', 'contact-details', companyId, employeeIds],
    queryFn: async (): Promise<Record<string, ContactDetail>> => {
      if (!isTauriRuntime()) return {};
      return loadContactDetails(companyId, employees);
    },
  });
}

/* ── Calendar / Meetings real-bind (meeting_sessions) ────────────────────── */

/** DB status -> the VM's 3 buckets. running = live; scheduled = upcoming;
 *  completed/cancelled/paused = ended. */
function mapMeetingStatus(dbStatus: string): WsMeeting['status'] {
  if (dbStatus === 'running') return 'live';
  if (dbStatus === 'scheduled') return 'upcoming';
  return 'ended';
}

const MEETING_DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const MEETING_TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
const AGENDA_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

/** Parse summary_json.participants (string[] of employee ids), written only on
 *  completed meetings. Anything else -> []. No invented ids. */
function parseAttendeeIds(summaryJson: string | null): string[] {
  if (!summaryJson) return [];
  try {
    const parsed = JSON.parse(summaryJson) as { participants?: unknown };
    if (!Array.isArray(parsed?.participants)) return [];
    return parsed.participants.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

function meetingRowToVm(row: MeetingSessionRow): WsMeeting {
  const created = new Date(row.created_at);
  const valid = !Number.isNaN(created.getTime());
  const status = mapMeetingStatus(row.status);
  const timeLabel = valid
    ? `${MEETING_DATE_FMT.format(created)} · ${MEETING_TIME_FMT.format(created)}`
    : '—';
  return {
    id: row.meeting_id,
    title: row.topic,
    status,
    // Honest sub line from real fields only — no fabricated "12 min · 4 attendees".
    sub: valid ? `${timeLabel} · ${status}` : status,
    timeLabel,
    attendeeIds: parseAttendeeIds(row.summary_json),
    threadId: row.thread_id ?? '',
    // No action-items column / no action-items in summary_json -> always empty.
    actionItems: [],
  };
}

export function useWsMeetings() {
  const companyId = useUiState((s) => s.companyId);
  return useQuery<MeetingSessionRow[], Error, WsMeeting[]>({
    queryKey: ['ws', 'meeting-rows', companyId],
    queryFn: async (): Promise<MeetingSessionRow[]> => {
      const repos = await reposOrNull();
      if (!repos) return [];
      if (!companyId) return [];
      return repos.meetings.findByCompany(companyId);
    },
    select: (rows) => rows.map(meetingRowToVm),
  });
}

/** Project real meeting_sessions into the multi-day AgendaDay structure (one
 *  AgendaEvent per meeting). No calendar/events table exists, so meetings are
 *  the only real agenda we can show — not invented slots. */
function meetingsToAgenda(rows: MeetingSessionRow[]): AgendaDay[] {
  const todayKey = new Date().toDateString();
  const byDay = new Map<string, { date: Date; events: AgendaEvent[] }>();
  for (const row of rows) {
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toDateString();
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = { date: d, events: [] };
      byDay.set(key, bucket);
    }
    bucket.events.push({
      id: `mtg-ev-${row.meeting_id}`,
      kind: 'meeting',
      title: row.topic,
      timeLabel: MEETING_TIME_FMT.format(d),
      note: mapMeetingStatus(row.status),
    });
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ date, events }) => ({
      id: `agd-${date.toISOString().slice(0, 10)}`,
      weekday: AGENDA_WEEKDAY_FMT.format(date),
      date: MEETING_DATE_FMT.format(date),
      today: date.toDateString() === todayKey,
      events: events.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel)),
    }));
}

export function useWsAgenda() {
  const companyId = useUiState((s) => s.companyId);
  return useQuery<MeetingSessionRow[], Error, AgendaDay[]>({
    queryKey: ['ws', 'meeting-rows', companyId],
    queryFn: async (): Promise<MeetingSessionRow[]> => {
      const repos = await reposOrNull();
      if (!repos) return [];
      if (!companyId) return [];
      return repos.meetings.findByCompany(companyId);
    },
    select: (rows) => meetingsToAgenda(rows),
  });
}

/* ── Kanban board (conversations as work cards) ──────────────────────────── */

/**
 * The project a per-project workspace app operates on: the explicitly-selected
 * project, or the company's first project as a fallback. Shared so the Workplace
 * launcher tile and the Kanban board it opens can never name different projects.
 */
export function useActiveProject(companyId: string) {
  const projectId = useUiState((s) => s.projectId);
  const projects = useProjects(companyId);
  return projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0] ?? null;
}

/**
 * The board's columns. `todo` / `done` are *durable* (derived from each
 * conversation's `archived_at`); `active` / `waiting` are *live* overlays the
 * board computes from the run store for the single in-flight thread — Offisim
 * has no persisted multi-thread task lifecycle, so the conversation is the unit
 * of work and its live run-state is the only honest "in motion" signal.
 */
export type BoardColumn = 'todo' | 'active' | 'waiting' | 'done';

export interface WsBoardCard {
  threadId: string;
  employeeId: string | null;
  title: string;
  updatedAtMs: number;
  /** `archived_at` is set — the boss has filed this conversation as done. */
  archived: boolean;
  /** Relative age of the last activity ("3h", "2d"). */
  ageLabel: string;
}

interface BoardThreadRow {
  thread_id: string;
  employee_id: string | null;
  title: string | null;
  updated_at: string;
  archived_at: string | null;
}

/**
 * Every conversation in the active project as a board card, newest first.
 * `archived` splits To do vs Done; the live In progress / Waiting columns are
 * an overlay the KanbanApp applies from the run store. Mirrors the raw-SQL seam
 * `loadProjectChatThreadRows` uses (chat_threads is the source of truth; the
 * repo's `listByProject` hides archived rows, so the board reads the table
 * directly to keep its Done column).
 */
export function useWsBoard(projectId: string | null) {
  return useQuery<WsBoardCard[]>({
    queryKey: ['ws', 'board', projectId],
    queryFn: async (): Promise<WsBoardCard[]> => {
      if (!isTauriRuntime()) return [];
      if (!projectId) return [];
      const db = await getTauriDb();
      const rows = await db.select<BoardThreadRow[]>(
        `select thread_id, employee_id, title, updated_at, archived_at
           from chat_threads
          where project_id = $1
          order by updated_at desc`,
        [projectId],
      );
      const now = Date.now();
      return rows.map((row) => {
        const ms = Date.parse(row.updated_at);
        return {
          threadId: row.thread_id,
          employeeId: row.employee_id ?? null,
          title: displayThreadTitle(row.title),
          updatedAtMs: Number.isFinite(ms) ? ms : 0,
          archived: row.archived_at != null,
          ageLabel: Number.isFinite(ms) ? ageLabelFrom(ms, now) : '',
        };
      });
    },
    // No poll: like the other useWs* hooks, the board refetches on mount (every
    // time it is opened from the launcher) and after archive/unarchive. The
    // active/waiting columns track the run store live, so nothing in-flight is
    // missed between opens.
  });
}
