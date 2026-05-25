import { resolveAsync } from '@/lib/platform.js';
import { useQuery } from '@tanstack/react-query';

/**
 * Workspace-suite view-models + fixtures + local query hooks.
 *
 * These models are owned by the Workspace surface and intentionally diverge from
 * the (legacy / incorrect) `@/data/types` `Approval` / `CalendarEvent` shapes:
 * the suite re-surfaces real product concepts — the four AI run-gates, the
 * NotificationCenter feed as a bot channel, deliverables-as-Docs, the employee
 * roster as Contacts, and the agenda of meetings / runs / ceremonies / deadlines.
 *
 * Employee identity is shared: callers join these by `employeeId` against
 * `useEmployees()`. Fixtures are resolved through `resolveAsync` so the query
 * keys + shapes form the seam for sandboxed Tauri commands later.
 */

/* ── Messenger conversation list ─────────────────────────────────────────── */

export type ConvKind = 'group' | 'direct' | 'system' | 'external';
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
  /** Files / Docs facet counts surfaced on the conv tabs. */
  fileCount?: number;
  docCount?: number;
  /** Composer mode chip default. */
  mode?: 'sop' | 'direct' | 'hil' | 'yolo';
}

/* ── Messenger message stream (group / direct) ───────────────────────────── */

export interface WsAttachment {
  id: string;
  name: string;
  meta: string;
}

export interface WsDeliverableCard {
  id: string;
  title: string;
  meta: string;
  format: string;
  contributorIds: string[];
}

export interface WsRunActivity {
  id: string;
  tool: string;
  detail: string;
  level: 'info' | 'success' | 'warning';
  repeat?: number;
}

export interface WsRunRecord {
  meta: string;
  costLabel: string;
  activity: WsRunActivity[];
}

export interface WsMessage {
  id: string;
  author: 'boss' | 'employee';
  employeeId: string | null;
  /** Role chip shown next to employee name. */
  role?: string;
  timeLabel: string;
  body: string;
  /** Show the collapsed "Reasoning" affordance above the bubble. */
  reasoning?: boolean;
  attachment?: WsAttachment;
  deliverable?: WsDeliverableCard;
}

export interface WsThread {
  daySep: string;
  messages: WsMessage[];
  run?: WsRunRecord;
}

/* ── System notification channel ─────────────────────────────────────────── */

export type SysLevel = 'info' | 'success' | 'warning' | 'error';
export type SysSource = 'runtime' | 'hr' | 'market' | 'install';

export interface SysAction {
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

/* ── Approvals (the four real AI run-gates) ──────────────────────────────── */

export type GateKind = 'permission' | 'plan' | 'ask' | 'install';
export type GateStatus = 'pending' | 'approved' | 'denied';
export type GrantScope = 'once' | 'thread' | 'session';

export interface ApprovalKV {
  label: string;
  value: string;
  mono?: boolean;
}

export interface WsApproval {
  id: string;
  kind: GateKind;
  status: GateStatus;
  /** List-row title + detail-head title. */
  title: string;
  requesterId: string;
  requesterRole: string;
  /** Originating thread name. */
  threadName: string;
  ageLabel: string;
  expiresLabel?: string;
  /** Structured "Request" KV rows. */
  request: ApprovalKV[];
  /** Optional command code block (permission gates). */
  command?: string;
  /** "Why it's asking" prose. */
  reason: string;
  /** Resolved grant scope (for resolved rows) / default for pending. */
  scope: GrantScope;
}

/* ── Docs (deliverables library) ─────────────────────────────────────────── */

export type DocFormat = 'DOCX' | 'MD' | 'CSV' | 'PPTX' | 'PDF' | 'TXT' | 'HTML';
export type DocKind = 'document' | 'file';

export interface WsDoc {
  id: string;
  title: string;
  kind: DocKind;
  format: DocFormat;
  /** Group the row sorts under (originating project / area). */
  group: string;
  contributorIds: string[];
  sizeLabel: string;
  updatedLabel: string;
  /** Source chat thread the artifact was produced in. */
  sourceThread: string;
  /** Rendered document body (document kind). */
  body?: { h1: string; sections: Array<{ h2?: string; p?: string; bullets?: string[] }> };
}

/* ── Contacts (the employee directory KV view) ───────────────────────────── */

export interface ContactDetail {
  /** Live presence statement, e.g. "Working now — Edge case review". */
  presence: Presence;
  presenceNote?: string;
  /** Zone label, e.g. "Engineering (workstation E-2)". */
  zone: string;
  model: string;
  expertise: string;
  tools: string;
  toolsNote?: string;
  decisionStyle: string;
  openChats: string;
  source: string;
  /** Group the contact sorts under (zone / discipline). */
  group: string;
}

/* ── Calendar agenda ─────────────────────────────────────────────────────── */

export type EventKind = 'meeting' | 'run' | 'ceremony' | 'deadline';

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

export interface WsActionItem {
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

export const SYSTEM_CONV_ID = 'sys-channel';

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
    fileCount: 6,
    docCount: 2,
    mode: 'sop',
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
    fileCount: 2,
    docCount: 1,
    mode: 'direct',
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
    fileCount: 1,
    docCount: 1,
    mode: 'direct',
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
    fileCount: 4,
    docCount: 3,
    mode: 'sop',
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
    fileCount: 3,
    docCount: 0,
    mode: 'direct',
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
    fileCount: 0,
    docCount: 0,
    mode: 'direct',
  },
];

const threadsById: Record<string, WsThread> = {
  'th-team': {
    daySep: 'Today',
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
        reasoning: true,
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
          meta: '3.2 KB · Text · shared to Files',
        },
      },
      {
        id: 't-m4',
        author: 'employee',
        employeeId: 'emp-orion',
        role: 'manager',
        timeLabel: '14:32',
        body: "Fixture parser verified ✅ — wrote up the report. It's pinned under Docs for this thread.",
        deliverable: {
          id: 't-d1',
          title: 'Fixture Verification Report',
          meta: '2.4 KB · 1m',
          format: 'DOCX',
          contributorIds: ['emp-orion', 'emp-devin'],
        },
      },
    ],
    run: {
      meta: '5 / 7 steps · 1 blocked',
      costLabel: '$0.06',
      activity: [
        {
          id: 't-av1',
          tool: 'bash',
          detail: 'Devin completed "Provision sandbox"',
          level: 'success',
        },
        {
          id: 't-av2',
          tool: 'bash',
          detail: 'Mara started "Edge case review"',
          level: 'info',
          repeat: 3,
        },
        {
          id: 't-av3',
          tool: 'alert',
          detail: 'Step 6 blocked — awaiting your approval (see Approvals)',
          level: 'warning',
        },
      ],
    },
  },
  'th-mara': {
    daySep: 'Today',
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
        reasoning: true,
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
    run: { meta: '2 / 3 steps', costLabel: '$0.02', activity: [] },
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

const approvals: WsApproval[] = [
  {
    id: 'gate-perm',
    kind: 'permission',
    status: 'pending',
    title: 'Run bash outside workspace root',
    requesterId: 'emp-mara',
    requesterRole: 'developer',
    threadName: 'Relay Launch · edge cases',
    ageLabel: '2m',
    expiresLabel: 'expires in 5m',
    request: [
      { label: 'Tool', value: 'bash · builtin sandbox', mono: true },
      { label: 'Decision', value: 'policy = ask (source: runtime)' },
      { label: 'Risk class', value: 'medium — writes outside the bound folder' },
      { label: 'Employee', value: 'Mara Quinn (developer)' },
      { label: 'Thread', value: 'Relay Launch · edge cases' },
    ],
    command: 'rm -rf ./.cache && pnpm clean\n# clears turbo cache + node_modules in the project',
    reason:
      'The path ./.cache resolves above the workspace root bound to this project, so the builtin sandbox cannot auto-allow it. Cache rebuild is cheap and the command is scoped to the project folder.',
    scope: 'thread',
  },
  {
    id: 'gate-plan',
    kind: 'plan',
    status: 'pending',
    title: 'Approve 7-step plan for "Attachment pipeline"',
    requesterId: 'emp-orion',
    requesterRole: 'manager',
    threadName: 'Relay Launch · Team',
    ageLabel: '8m',
    request: [
      { label: 'Steps', value: '7 (3 done · 1 blocked · 3 queued)' },
      { label: 'Owners', value: 'Devin · Mara · Sela' },
      { label: 'Est. cost', value: '$0.11' },
      { label: 'Thread', value: 'Relay Launch · Team' },
    ],
    reason:
      'The manager assembled a multi-step plan that spans three employees and exceeds the auto-approve cost threshold for this session. Review the step breakdown and approve, reject, or modify before the team executes.',
    scope: 'session',
  },
  {
    id: 'gate-ask',
    kind: 'ask',
    status: 'pending',
    title: 'Which export format should the report ship as?',
    requesterId: 'emp-sela',
    requesterRole: 'writer',
    threadName: 'Relay Launch · spec',
    ageLabel: '15m',
    request: [
      { label: 'Options', value: 'DOCX · PDF · HTML' },
      { label: 'Default', value: 'DOCX' },
      { label: 'Employee', value: 'Sela Ortiz (writer)' },
      { label: 'Thread', value: 'Relay Launch · spec' },
    ],
    reason:
      'The writer reached a branch in the plan that needs a human decision: the verification report can ship in several formats and the choice affects downstream distribution. Pick an option or reply with a freeform answer.',
    scope: 'once',
  },
  {
    id: 'gate-install',
    kind: 'install',
    status: 'approved',
    title: 'Install skill "PDF Table Extractor"',
    requesterId: 'emp-mara',
    requesterRole: 'developer',
    threadName: 'Relay Launch · Team',
    ageLabel: '1h',
    request: [
      { label: 'Skill', value: 'PDF Table Extractor v1.4.2' },
      { label: 'Permissions', value: 'read_file · network (fetch)' },
      { label: 'Assets', value: '2 bundled scripts · 1 model ref' },
      { label: 'Source', value: 'Market · atlas' },
    ],
    reason:
      'Installing a skill grants its declared permissions and bundled assets to your employees’ tool pool. Review the disclosure, then Install, Fork, or Edit before it becomes available.',
    scope: 'session',
  },
];

const docs: WsDoc[] = [
  {
    id: 'doc-roadmap',
    title: 'Relay Roadmap Outline',
    kind: 'document',
    format: 'DOCX',
    group: 'Relay Launch',
    contributorIds: ['emp-mara', 'emp-devin', 'emp-sela', 'emp-orion'],
    sizeLabel: '8.1 KB',
    updatedLabel: '2m ago',
    sourceThread: 'Relay Launch · Team',
    body: {
      h1: 'Relay Roadmap',
      sections: [
        {
          p: 'Goals for the quarter, distilled from the launch kickoff. Owners are AI employees; the boss approves scope changes.',
        },
        {
          h2: 'Workstreams',
          bullets: [
            'Ship the doc-engine verify flow (owner: Devin)',
            'Harden the attachment pipeline — caps, MIME, non-UTF-8 (owner: Mara)',
            'Close the UX / IA debt batch (owner: Sela)',
          ],
        },
        {
          h2: 'Milestones',
          p: 'Week 1 — sandbox + parser verified. Week 2 — pipeline hardened. Week 3 — launch review & sign-off.',
        },
      ],
    },
  },
  {
    id: 'doc-fixture',
    title: 'Fixture Verification Report',
    kind: 'document',
    format: 'MD',
    group: 'Relay Launch',
    contributorIds: ['emp-orion', 'emp-devin'],
    sizeLabel: '2.4 KB',
    updatedLabel: '1h ago',
    sourceThread: 'Relay Launch · Team',
    body: {
      h1: 'Fixture Verification Report',
      sections: [
        {
          p: 'The fixture parser was run against the deterministic harness sandbox and verified green.',
        },
        {
          h2: 'Results',
          bullets: [
            'Empty files handled — no panic',
            '8 MB cap enforced at the sandbox boundary',
            'Non-UTF-8 input rejected with a clear error',
          ],
        },
      ],
    },
  },
  {
    id: 'doc-metrics',
    title: 'Launch metrics',
    kind: 'file',
    format: 'CSV',
    group: 'Relay Launch',
    contributorIds: ['emp-sela'],
    sizeLabel: '1.2 KB',
    updatedLabel: '3h ago',
    sourceThread: 'Relay Launch · spec',
  },
  {
    id: 'doc-deck',
    title: 'Pitch deck v2',
    kind: 'file',
    format: 'PPTX',
    group: 'Relay Launch',
    contributorIds: ['emp-sela', 'emp-orion'],
    sizeLabel: '4.6 MB',
    updatedLabel: 'Mon',
    sourceThread: 'Design Review',
  },
  {
    id: 'doc-runbook',
    title: 'DevOps runbook',
    kind: 'document',
    format: 'PDF',
    group: 'Onboarding',
    contributorIds: ['emp-devin'],
    sizeLabel: '320 KB',
    updatedLabel: 'Tue',
    sourceThread: 'Onboarding',
    body: {
      h1: 'DevOps runbook',
      sections: [{ p: 'How to provision the deterministic harness sandbox and roll a release.' }],
    },
  },
  {
    id: 'doc-log',
    title: 'sandbox-bootstrap.log',
    kind: 'file',
    format: 'TXT',
    group: 'Onboarding',
    contributorIds: ['emp-devin'],
    sizeLabel: '3.2 KB',
    updatedLabel: 'Tue',
    sourceThread: 'Relay Launch · Team',
  },
];

/** Contact KV detail keyed by employee id (joined against `useEmployees()`). */
const contactDetails: Record<string, ContactDetail> = {
  'emp-mara': {
    presence: 'working',
    presenceNote: '“Edge case review”',
    zone: 'Engineering (workstation E-2)',
    model: 'MiniMax · M2.7 · Med',
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
    model: 'MiniMax · M2.7 · Med',
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
    model: 'MiniMax · M2.7 · Med',
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
    model: 'MiniMax · M2.7 · High',
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
        note: 'auto-scheduled SOP',
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

export function useWsConversations() {
  return useQuery({
    queryKey: ['ws', 'conversations'],
    queryFn: () => resolveAsync(conversations),
  });
}

export function useWsThread(conversationId: string | null) {
  return useQuery({
    queryKey: ['ws', 'thread', conversationId],
    queryFn: () =>
      resolveAsync<WsThread | null>(conversationId ? (threadsById[conversationId] ?? null) : null),
    enabled: conversationId !== null,
  });
}

export function useWsSystemCards() {
  return useQuery({ queryKey: ['ws', 'system'], queryFn: () => resolveAsync(systemCards) });
}

export function useWsApprovals() {
  return useQuery({ queryKey: ['ws', 'approvals'], queryFn: () => resolveAsync(approvals) });
}

export function useWsDocs() {
  return useQuery({ queryKey: ['ws', 'docs'], queryFn: () => resolveAsync(docs) });
}

export function useWsContactDetails() {
  return useQuery({
    queryKey: ['ws', 'contact-details'],
    queryFn: () => resolveAsync(contactDetails),
  });
}

export function useWsAgenda() {
  return useQuery({ queryKey: ['ws', 'agenda'], queryFn: () => resolveAsync(agenda) });
}

export function useWsMeetings() {
  return useQuery({ queryKey: ['ws', 'meetings'], queryFn: () => resolveAsync(meetings) });
}

/* ── Shared label maps ───────────────────────────────────────────────────── */

export const GATE_LABEL: Record<GateKind, string> = {
  permission: 'Permission',
  plan: 'Plan review',
  ask: 'Question',
  install: 'Install',
};

export const GATE_HEAD_LABEL: Record<GateKind, string> = {
  permission: 'Permission gate',
  plan: 'Plan review',
  ask: 'Agent question',
  install: 'Skill install',
};

export const MODE_LABEL: Record<NonNullable<WsConversation['mode']>, string> = {
  sop: 'SOP',
  direct: 'Direct',
  hil: 'HIL',
  yolo: 'YOLO',
};
