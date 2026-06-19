import { useUiState } from '@/app/ui-state.js';
import { displayThreadTitle, isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import { loadProjectChatThreadRows, projectChatThreadRowsQueryKey } from '@/data/queries.js';
import type { ChatToolCall, Employee } from '@/data/types.js';
import { resolveAsync } from '@/lib/platform.js';
import { getTauriDb } from '@/lib/tauri-db.js';
import type { MeetingSessionRow } from '@offisim/core/browser';
import { useQuery } from '@tanstack/react-query';

/**
 * Workspace-suite view-models + fixtures + local query hooks.
 *
 * These models are owned by the Workspace surface and intentionally diverge from
 * the (legacy / incorrect) `@/data/types` `Approval` / `CalendarEvent` shapes:
 * the suite re-surfaces real product concepts — the four AI run-gates, the
 * NotificationCenter feed as a bot channel, file attachments, the employee
 * roster as Contacts, and the agenda of meetings / runs / ceremonies / deadlines.
 *
 * Employee identity is shared: callers join these by `employeeId` against
 * `useEmployees()`. Fixtures are resolved through `resolveAsync` so the query
 * keys + shapes form the seam for sandboxed Tauri commands later.
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
  /** Epoch ms the message was created. Set on persisted rows; fixtures omit it. */
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

/* ── System notification channel ─────────────────────────────────────────── */

export type SysLevel = 'info' | 'success' | 'warning' | 'error';
export type SysSource = 'runtime' | 'hr' | 'market' | 'install';

interface SysAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface SysCard {
  id: string;
  level: SysLevel;
  source: SysSource;
  title: string;
  timeLabel: string;
  message: string;
  actions: SysAction[];
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

/* ════════════════ Fixtures ════════════════ */
/* Employee ids are the shared roster from fixtures.ts:
 *   emp-mara (Engineering Lead), emp-devin (Product Designer),
 *   emp-sela (QA Analyst), emp-orion (Security Review · external). */

const SYSTEM_CONV_ID = 'sys-channel';

const conversations: WsConversation[] = [
  {
    id: 'th-team',
    kind: 'group',
    title: 'Relay Launch · Team',
    employeeId: null,
    snippet: 'Mara: Session contract verified ✅',
    timeLabel: '14:32',
    unread: 3,
    section: 'pinned',
    members: 4,
    workingNow: 2,
  },
  {
    id: 'th-mara',
    kind: 'direct',
    title: 'Mara Quinn',
    employeeId: 'emp-mara',
    presence: 'working',
    snippet: 'On it — reviewing the edge cases now',
    timeLabel: '14:30',
    unread: 1,
  },
  {
    id: SYSTEM_CONV_ID,
    kind: 'system',
    title: 'System',
    employeeId: null,
    snippet: 'HR assessment complete · 3 roles recommended',
    timeLabel: '14:18',
    unread: 2,
  },
  {
    id: 'th-devin',
    kind: 'direct',
    title: 'Devin Park',
    employeeId: 'emp-devin',
    presence: 'idle',
    snippet: 'Sandbox is ready whenever you are',
    timeLabel: '13:55',
    read: true,
  },
  {
    id: 'th-design',
    kind: 'group',
    title: 'Design Review',
    employeeId: null,
    snippet: 'Devin: pushed v3 of the spec sheet',
    timeLabel: 'Mon',
    members: 3,
    workingNow: 0,
  },
  {
    id: 'th-audit',
    kind: 'external',
    title: 'Orion Audit',
    employeeId: 'emp-orion',
    presence: 'working',
    snippet: 'Outsourced render batch delivered',
    timeLabel: 'Mon',
    muted: true,
  },
  {
    id: 'th-sela',
    kind: 'direct',
    title: 'Sela Ortiz',
    employeeId: 'emp-sela',
    presence: 'offline',
    snippet: 'Thanks! Closing this one out 🎉',
    timeLabel: 'Sun',
    section: 'earlier',
    read: true,
  },
];

const threadsById: Record<string, WsThread> = {
  'th-team': {
    messages: [
      {
        id: 't-m1',
        author: 'boss',
        employeeId: null,
        timeLabel: '14:05',
        body: 'Kick off the Relay launch checklist — verify the doc-engine export flow and harden the attachment pipeline. Loop in whoever you need.',
      },
      {
        id: 't-m2',
        author: 'employee',
        employeeId: 'emp-orion',
        role: 'manager',
        timeLabel: '14:06',
        body: "Got it. Breaking this into a 7-step plan and assigning Devin (sandbox), Mara (edge cases) and Sela (spec). I'll report back as steps land.",
      },
      {
        id: 't-m3',
        author: 'employee',
        employeeId: 'emp-devin',
        role: 'devops',
        timeLabel: '14:24',
        body: 'Provisioned the deterministic harness sandbox — green. Handing the parser off to Mara.',
        attachment: {
          id: 't-a1',
          name: 'sandbox-bootstrap.log',
          meta: '3.2 KB · Text attachment',
        },
      },
      {
        id: 't-m4',
        author: 'employee',
        employeeId: 'emp-orion',
        role: 'manager',
        timeLabel: '14:32',
        body: 'Fixture parser verified ✅ — wrote up the report. The artifact is attached to this thread.',
        deliverable: {
          id: 't-d1',
          title: 'Fixture Verification Report',
          meta: '2.4 KB · 1m',
          format: 'MD',
          contributorIds: ['emp-orion', 'emp-devin'],
          content: [
            '# Fixture Verification Report',
            '',
            '## Scope',
            '- Verified the Relay launch fixture parser against the deterministic harness sandbox.',
            '- Confirmed the attachment metadata path resolves into this Workspace thread.',
            '- Checked the remaining sign-off block before the doc-engine export handoff.',
            '',
            '## Result',
            '- Parser fixture set: pass',
            '- Attachment pipeline: pass',
            '- Export handoff: blocked until the bound project workspace is available',
            '',
            '## Owners',
            '- Orion Audit: verification lead',
            '- Devin Park: sandbox bootstrap',
          ].join('\n'),
        },
      },
    ],
  },
  'th-mara': {
    messages: [
      {
        id: 'd-m1',
        author: 'boss',
        employeeId: null,
        timeLabel: '14:20',
        body: 'Can you double-check the boundary cases on the markdown attachment parser before we ship?',
      },
      {
        id: 'd-m2',
        author: 'employee',
        employeeId: 'emp-mara',
        role: 'developer',
        timeLabel: '14:22',
        body: "On it. Running the parser against empty files, 8 MB caps and non-UTF-8 input. Will flag anything that needs a tool I don't have.",
      },
      {
        id: 'd-m3',
        author: 'employee',
        employeeId: 'emp-mara',
        role: 'developer',
        timeLabel: '14:30',
        body: 'Three pass, one needs your call: reading ./.cache is outside the workspace root. I requested approval — it’s in Approvals.',
      },
    ],
  },
};

const systemCards: SysCard[] = [
  {
    id: 'sys-1',
    level: 'success',
    source: 'hr',
    title: 'Assessment complete',
    timeLabel: '14:18',
    message:
      'HR Bot finished assessing the Relay Launch needs and recommends 3 roles: QA Engineer, Tech Writer, Release Manager.',
    actions: [
      { id: 'sys-1-a', label: 'Review roles', primary: true },
      { id: 'sys-1-b', label: 'Dismiss' },
    ],
  },
  {
    id: 'sys-2',
    level: 'info',
    source: 'market',
    title: 'Skill installed',
    timeLabel: '13:40',
    message:
      '“PDF Table Extractor” was installed and is now available to your employees’ tool pool.',
    actions: [{ id: 'sys-2-a', label: 'Open in Market' }],
  },
  {
    id: 'sys-3',
    level: 'warning',
    source: 'runtime',
    title: 'Vault sync failed',
    timeLabel: '12:02',
    message:
      "Couldn't sync Sela Ortiz's employee markdown to the vault — retried twice. Her latest persona edits may be unsaved.",
    actions: [
      { id: 'sys-3-a', label: 'Retry sync' },
      { id: 'sys-3-b', label: 'View employee' },
    ],
  },
  {
    id: 'sys-4',
    level: 'error',
    source: 'runtime',
    title: 'Run halted',
    timeLabel: '11:31',
    message:
      '​A step in “Attachment pipeline” errored after 3 retries (provider timeout). The run is paused for your decision.',
    actions: [
      { id: 'sys-4-a', label: 'Open run', primary: true },
      { id: 'sys-4-b', label: 'Retry' },
    ],
  },
  {
    id: 'sys-5',
    level: 'info',
    source: 'install',
    title: 'Employee onboarded',
    timeLabel: 'Mon',
    message: 'Devin Park (devops) finished onboarding and was seated in the DevOps zone.',
    actions: [],
  },
];

/** Contact KV detail keyed by employee id (joined against `useEmployees()`). */
const contactDetails: Record<string, ContactDetail> = {
  'emp-mara': {
    presence: 'working',
    presenceNote: '“Edge case review”',
    zone: 'Engineering (workstation E-2)',
    expertise: 'parsers · edge cases · TypeScript',
    tools: 'read_file · write_file · bash',
    toolsNote: '(ask for out-of-root)',
    decisionStyle: 'analytical · balanced risk',
    openChats: '1 direct · 2 group',
    source: 'Internal employee',
    group: 'Engineering',
  },
  'emp-devin': {
    presence: 'idle',
    zone: 'DevOps (workstation D-1)',
    expertise: 'sandboxes · CI · provisioning',
    tools: 'read_file · write_file · bash',
    decisionStyle: 'pragmatic · low risk',
    openChats: '1 direct · 1 group',
    source: 'Internal employee',
    group: 'Engineering',
  },
  'emp-sela': {
    presence: 'offline',
    zone: 'Design (workstation S-1)',
    expertise: 'specs · writing · launch metrics',
    tools: 'read_file · write_file',
    decisionStyle: 'thorough · detail-first',
    openChats: '0 direct · 1 group',
    source: 'Internal employee',
    group: 'Design',
  },
  'emp-orion': {
    presence: 'working',
    presenceNote: 'managing the Relay run',
    zone: 'Management (workstation M-1)',
    expertise: 'planning · routing · static analysis',
    tools: 'plan · delegate · read_file',
    decisionStyle: 'decisive · risk-aware',
    openChats: '1 direct · 3 group',
    source: 'External · brand (A2A · render)',
    group: 'External · brand',
  },
};

const agenda: AgendaDay[] = [
  {
    id: 'd-thu',
    weekday: 'Thu',
    date: 'May 23',
    today: true,
    events: [
      {
        id: 'ev-standup',
        kind: 'meeting',
        title: 'Relay Launch standup',
        timeLabel: '09:30',
        note: '4 attendees · daily ceremony',
      },
      {
        id: 'ev-run',
        kind: 'run',
        title: 'Run · Attachment pipeline',
        timeLabel: '11:00',
        note: '7 steps · live now',
      },
      {
        id: 'ev-deadline',
        kind: 'deadline',
        title: 'Pitch deck due',
        timeLabel: '17:00',
        note: 'owner Sela',
      },
    ],
  },
  {
    id: 'd-fri',
    weekday: 'Fri',
    date: 'May 24',
    events: [
      {
        id: 'ev-design',
        kind: 'meeting',
        title: 'Design review',
        timeLabel: '14:00',
        note: 'Sela, Orion',
      },
      {
        id: 'ev-signoff',
        kind: 'ceremony',
        title: 'Launch sign-off ceremony',
        timeLabel: '16:00',
        note: 'boss + managers',
      },
    ],
  },
  {
    id: 'd-mon',
    weekday: 'Mon',
    date: 'May 27',
    events: [
      {
        id: 'ev-retro',
        kind: 'run',
        title: 'Weekly retro run',
        timeLabel: '10:00',
        note: 'auto-scheduled run',
      },
    ],
  },
];

const meetings: WsMeeting[] = [
  {
    id: 'mtg-standup',
    title: 'Relay Launch standup',
    status: 'ended',
    sub: 'Today 09:30 · 12 min · 4 attendees · ended',
    timeLabel: 'Today · 09:30',
    attendeeIds: ['emp-mara', 'emp-devin', 'emp-sela', 'emp-orion'],
    threadId: 'th-team',
    actionItems: [
      { id: 'ai-1', text: 'Provision the harness sandbox', ownerId: 'emp-devin', done: true },
      { id: 'ai-2', text: 'Review parser boundary cases', ownerId: 'emp-mara', done: false },
      { id: 'ai-3', text: 'Draft pitch deck v2', ownerId: 'emp-sela', done: false },
      { id: 'ai-4', text: 'Approve out-of-root bash for Mara', ownerId: null, done: false },
    ],
  },
  {
    id: 'mtg-design',
    title: 'Design review',
    status: 'upcoming',
    sub: 'Fri 14:00 · 30 min · 2 attendees · upcoming',
    timeLabel: 'Fri · 14:00',
    attendeeIds: ['emp-sela', 'emp-orion'],
    threadId: 'th-design',
    actionItems: [
      { id: 'ai-5', text: 'Walk through v3 spec sheet', ownerId: 'emp-sela', done: false },
      { id: 'ai-6', text: 'Confirm export format decision', ownerId: 'emp-orion', done: false },
    ],
  },
  {
    id: 'mtg-signoff',
    title: 'Launch sign-off ceremony',
    status: 'upcoming',
    sub: 'Fri 16:00 · 15 min · boss + managers',
    timeLabel: 'Fri · 16:00',
    attendeeIds: ['emp-orion', 'emp-mara'],
    threadId: 'th-team',
    actionItems: [{ id: 'ai-7', text: 'Confirm all gates resolved', ownerId: null, done: false }],
  },
];

/* ── Query hooks (fixture seam) ──────────────────────────────────────────── */

/**
 * Real conversation list = the active project's non-archived chat_threads
 * (employee_id set => direct, null => group). Browser preview (no repos) keeps
 * the demo fixture so the surface renders; release shows an honest empty list
 * when the project has no threads. No presence/unread/snippet beyond the real
 * summary — those have no backing column.
 */
export function useWsConversations() {
  const projectId = useUiState((s) => s.projectId);
  return useQuery({
    queryKey: projectChatThreadRowsQueryKey(projectId),
    queryFn: () => loadProjectChatThreadRows(projectId),
    select: (rows): WsConversation[] => {
      if (!isTauriRuntime()) return conversations;
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
      if (!repos) return threadsById[conversationId] ?? null; // browser preview seed
      // Release: the message stream is the persisted agent_events feed rendered
      // by WorkspaceAssistantThread. Return an honest empty seed — no fabricated
      // messages on top of the real persisted ones.
      return { messages: [] };
    },
    enabled: conversationId !== null,
  });
}

export function useWsSystemCards() {
  return useQuery({
    queryKey: ['ws', 'system'],
    queryFn: async (): Promise<SysCard[]> => {
      // The real conversation list (chat_threads) produces no `system` row, so
      // the System channel never opens in release — runtime / HR / market /
      // install events live in the Activity Log. Return [] in release; keep the
      // demo fixture for browser preview.
      if (isTauriRuntime()) return [];
      return resolveAsync(systemCards);
    },
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

const DAY_LABEL_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Day separator label for a message timestamp: Today / Yesterday / "Jun 8". */
export function dayLabelFrom(atMs: number, now: number): string {
  const d = new Date(atMs);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return 'Today';
  // Local-calendar yesterday (midnight minus a day), not now-24h: a flat
  // 86400000ms offset lands on the wrong date across DST transitions.
  const yest = new Date(now);
  yest.setHours(0, 0, 0, 0);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return DAY_LABEL_FMT.format(d);
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
      // Browser preview (no Tauri runtime / repos): keep the demo fixture.
      if (!isTauriRuntime()) return resolveAsync(contactDetails);
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
    select: (rows) => (isTauriRuntime() ? rows.map(meetingRowToVm) : meetings),
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
    select: (rows) => (isTauriRuntime() ? meetingsToAgenda(rows) : agenda),
  });
}
