import type {
  ChatMessage,
  ChatThread,
  Company,
  Deliverable,
  Employee,
  FileNode,
  OfficeSceneLayout,
  Project,
  Skill,
  UnfinishedThread,
  UsagePoint,
} from './types.js';
import { UI_DATA_COLORS } from './color-palette.js';

const HOUR = 3_600_000;
const now = Date.UTC(2026, 4, 25, 9, 0, 0);

export const companies: Company[] = [
  {
    id: 'co-northwind',
    name: 'Northwind Studio',
    initials: 'NW',
    accentA: UI_DATA_COLORS.blue4,
    accentB: UI_DATA_COLORS.blue5,
    templateLabel: 'Content Studio',
  },
  {
    id: 'co-atlas',
    name: 'Atlas Robotics',
    initials: 'AR',
    accentA: UI_DATA_COLORS.violet,
    accentB: UI_DATA_COLORS.violet2,
    templateLabel: 'AI Startup',
  },
  {
    id: 'co-harbor',
    name: 'Harbor Foods',
    initials: 'HF',
    accentA: UI_DATA_COLORS.green,
    accentB: UI_DATA_COLORS.green2,
    templateLabel: 'Agency Lite',
  },
];

export const projects: Project[] = [
  {
    id: 'pj-relay',
    companyId: 'co-northwind',
    name: 'Relay Launch',
    workspaceRoot: '/Users/you/code/relay',
    branch: 'main',
  },
  {
    id: 'pj-ledger',
    companyId: 'co-northwind',
    name: 'Ledger Migration',
    workspaceRoot: '/Users/you/code/ledger',
    branch: 'feat/import',
  },
  {
    id: 'pj-fleet',
    companyId: 'co-atlas',
    name: 'Fleet Console',
    workspaceRoot: null,
    branch: null,
  },
];

export const employees: Employee[] = [
  {
    id: 'emp-mara',
    name: 'Mara Quinn',
    role: 'Engineering Lead',
    kind: 'internal',
    online: true,
    presence: 'working',
    avatarA: UI_DATA_COLORS.blue4,
    avatarB: UI_DATA_COLORS.blue5,
    discipline: 'Backend systems',
    modelLabel: 'Runtime default',
    skillCount: 6,
    appearance: { hairStyle: 'short', clothingColor: UI_DATA_COLORS.blue },
    zoneLabel: 'Engineering Bay',
    deskLabel: 'Desk 1',
    expertise: ['API design', 'TypeScript', 'Data modeling'],
  },
  {
    id: 'emp-devin',
    name: 'Devin Park',
    role: 'Product Designer',
    kind: 'internal',
    online: true,
    presence: 'working',
    avatarA: UI_DATA_COLORS.violet,
    avatarB: UI_DATA_COLORS.violet2,
    discipline: 'Interface & flows',
    modelLabel: 'Runtime default',
    skillCount: 4,
    appearance: { hairStyle: 'long', clothingColor: UI_DATA_COLORS.violet },
    zoneLabel: 'Design Studio',
    deskLabel: 'Desk 2',
    expertise: ['Product UI', 'Flows', 'Prototyping'],
  },
  {
    id: 'emp-sela',
    name: 'Sela Ortiz',
    role: 'QA Analyst',
    kind: 'internal',
    online: false,
    presence: 'idle',
    avatarA: UI_DATA_COLORS.green,
    avatarB: UI_DATA_COLORS.green2,
    discipline: 'Test & verification',
    modelLabel: 'Runtime default',
    skillCount: 5,
    appearance: { hairStyle: 'bob', clothingColor: UI_DATA_COLORS.green },
    zoneLabel: 'Engineering Bay',
    deskLabel: 'Desk 3',
    expertise: ['Test plans', 'Repro', 'Evidence'],
  },
  {
    id: 'emp-orion',
    name: 'Orion Audit',
    role: 'Security Review',
    kind: 'external',
    brandLabel: 'A2A',
    online: true,
    presence: 'blocked',
    avatarA: UI_DATA_COLORS.slateA,
    avatarB: UI_DATA_COLORS.slateB,
    discipline: 'Static analysis',
    modelLabel: 'Remote agent',
    skillCount: 2,
    zoneLabel: 'Meeting',
    expertise: ['Static analysis', 'Threat modeling'],
  },
];

export const threads: ChatThread[] = [
  {
    id: 'th-team',
    projectId: 'pj-relay',
    title: 'Relay Launch · Team',
    subtitle: '4 members',
    scope: 'team',
    employeeId: null,
    updatedAt: now - HOUR * 0.4,
    runState: 'running',
  },
  {
    id: 'th-mara',
    projectId: 'pj-relay',
    title: 'Mara Quinn',
    subtitle: 'Engineering Lead',
    scope: 'direct',
    employeeId: 'emp-mara',
    updatedAt: now - HOUR * 1.6,
    runState: 'done',
  },
  {
    id: 'th-devin',
    projectId: 'pj-relay',
    title: 'Devin Park',
    subtitle: 'Product Designer',
    scope: 'direct',
    employeeId: 'emp-devin',
    updatedAt: now - HOUR * 5,
    runState: 'idle',
  },
  {
    id: 'th-audit',
    projectId: 'pj-relay',
    title: 'Orion Audit',
    subtitle: 'Security Review',
    scope: 'direct',
    employeeId: 'emp-orion',
    updatedAt: now - HOUR * 26,
    runState: 'error',
  },
];

export const messages: Record<string, ChatMessage[]> = {
  'th-team': [
    {
      id: 'm1',
      threadId: 'th-team',
      author: 'boss',
      employeeId: null,
      body: 'Ship the Relay onboarding flow this sprint. Mara owns the API, Devin the screens, Sela verifies.',
      at: now - HOUR * 3,
    },
    {
      id: 'm2',
      threadId: 'th-team',
      author: 'employee',
      employeeId: 'emp-mara',
      body: 'Taking the session endpoints. I drafted the contract and connected the first handler against the sandbox.',
      at: now - HOUR * 2.4,
      runRecord: {
        id: 'rr1',
        title: 'Implement session contract',
        meta: '3 tools · 1m 12s',
        costLabel: '$0.0184',
        steps: [
          { id: 's1', label: 'read', detail: 'src/api/session.ts', state: 'done' },
          { id: 's2', label: 'edit', detail: 'added POST /session handler', state: 'done' },
          { id: 's3', label: 'bash', detail: 'pnpm typecheck', state: 'done' },
        ],
        activity: [
          { id: 'av1', tool: 'read', detail: 'src/api/session.ts', state: 'done' },
          { id: 'av2', tool: 'edit', detail: 'added POST /session handler', state: 'done' },
          { id: 'av3', tool: 'bash', detail: 'pnpm typecheck — passed', state: 'done', repeat: 2 },
        ],
        plan: [
          {
            id: 'pl1',
            label: 'Draft session contract',
            assigneeId: 'emp-mara',
            roleLabel: 'Engineering Lead',
            costLabel: '$0.0092',
            state: 'done',
          },
          {
            id: 'pl2',
            label: 'Wire handler against sandbox',
            assigneeId: 'emp-mara',
            roleLabel: 'Engineering Lead',
            costLabel: '$0.0092',
            state: 'done',
          },
        ],
      },
    },
    {
      id: 'm3',
      threadId: 'th-team',
      author: 'employee',
      employeeId: 'emp-devin',
      body: 'Onboarding screens are in review. Attaching the flow spec for the empty and error states.',
      at: now - HOUR * 0.5,
      attachments: [{ id: 'a1', name: 'onboarding-flow.fig', sizeLabel: '2.4 MB', ext: 'fig' }],
    },
  ],
  'th-mara': [
    {
      id: 'mm1',
      threadId: 'th-mara',
      author: 'boss',
      employeeId: null,
      body: 'Can you confirm the session token TTL matches the spec?',
      at: now - HOUR * 2,
    },
    {
      id: 'mm2',
      threadId: 'th-mara',
      author: 'employee',
      employeeId: 'emp-mara',
      body: 'Confirmed — TTL is 30 minutes with sliding renewal. Updated the contract test to assert it.',
      at: now - HOUR * 1.6,
    },
  ],
  'th-devin': [],
  'th-audit': [
    {
      id: 'ma1',
      threadId: 'th-audit',
      author: 'system',
      employeeId: null,
      body: 'Remote agent transport returned an authorization error before the run could start.',
      at: now - HOUR * 26,
    },
  ],
};

export const deliverables: Deliverable[] = [
  {
    id: 'dl1',
    name: 'session.ts',
    kind: 'code',
    contributorIds: ['emp-mara'],
    format: 'TS',
    preview:
      'export async function createSession(req: SessionRequest): Promise<Session> {\n  const ttl = 30 * 60_000; // 30m sliding\n  return persist({ ...req, ttl });\n}',
  },
  {
    id: 'dl2',
    name: 'onboarding-flow.fig',
    kind: 'design',
    contributorIds: ['emp-devin', 'emp-mara'],
    format: 'FIG',
    preview: 'Empty · Loading · Error · Success states for the Relay onboarding flow.',
  },
  {
    id: 'dl3',
    name: 'verify-report.md',
    kind: 'report',
    contributorIds: ['emp-sela', 'emp-devin', 'emp-mara'],
    format: 'MD',
    preview:
      '# Verification report\n\n- TTL asserted at 30m sliding renewal\n- 2 onboarding edge cases reproduced and fixed',
  },
];

/** Threads from a previous session that did not finish — drives the ResumeBar. */
export const unfinishedThreads: UnfinishedThread[] = [
  {
    threadId: 'th-team',
    companyId: 'co-northwind',
    projectId: 'pj-relay',
    name: 'Relay Launch · Team',
    state: 'running',
  },
  {
    threadId: 'th-audit',
    companyId: 'co-northwind',
    projectId: 'pj-relay',
    name: 'Orion Audit',
    state: 'blocked',
  },
];

export const officeScene: OfficeSceneLayout = {
  floorW: 16,
  floorD: 12,
  zones: [
    { id: 'z-work', label: 'Workspace', kind: 'workspace', cx: -3.4, cz: 0, w: 8, d: 9 },
    { id: 'z-meet', label: 'Meeting', kind: 'meeting', cx: 4.6, cz: -3, w: 6, d: 4 },
    { id: 'z-lounge', label: 'Lounge', kind: 'lounge', cx: 4.6, cz: 3, w: 6, d: 4 },
  ],
  placements: [
    { employeeId: 'emp-mara', x: -5, z: -2, rotation: 20 },
    { employeeId: 'emp-devin', x: -2, z: -2, rotation: -20 },
    { employeeId: 'emp-sela', x: -5, z: 2, rotation: 20 },
    { employeeId: 'emp-orion', x: 4.6, z: -3, rotation: 180 },
  ],
};

export const usageSeries: UsagePoint[] = [
  { label: 'Mon', runs: 8, cost: 0.62 },
  { label: 'Tue', runs: 14, cost: 1.08 },
  { label: 'Wed', runs: 11, cost: 0.74 },
  { label: 'Thu', runs: 19, cost: 1.46 },
  { label: 'Fri', runs: 16, cost: 1.12 },
  { label: 'Sat', runs: 5, cost: 0.31 },
  { label: 'Sun', runs: 9, cost: 0.58 },
];

export const employeeSkills: Record<string, Skill[]> = {
  'emp-mara': [
    {
      id: 'sk-ts',
      name: 'TypeScript Service Design',
      description: 'Designs typed service contracts and handlers.',
      scope: 'employee',
    },
    {
      id: 'sk-test',
      name: 'Contract Testing',
      description: 'Writes deterministic contract and replay checks.',
      scope: 'company',
    },
    {
      id: 'sk-shell',
      name: 'Sandboxed Shell',
      description: 'Runs build and verification commands in the workspace.',
      scope: 'global',
    },
  ],
  'emp-devin': [
    {
      id: 'sk-ui',
      name: 'Interface Composition',
      description: 'Builds dense product UIs against a design system.',
      scope: 'employee',
    },
    {
      id: 'sk-flow',
      name: 'Flow Mapping',
      description: 'Documents empty, error, and loading states.',
      scope: 'company',
    },
  ],
  'emp-sela': [
    {
      id: 'sk-verify',
      name: 'Verification Reports',
      description: 'Reproduces issues and writes evidence reports.',
      scope: 'employee',
    },
  ],
  'emp-orion': [
    {
      id: 'sk-static',
      name: 'Static Analysis',
      description: 'Scans diffs for security regressions.',
      scope: 'global',
    },
  ],
};

export const projectFiles: Record<string, FileNode[]> = {
  'pj-relay': [
    { name: 'src', path: 'src', kind: 'dir', depth: 0 },
    { name: 'api', path: 'src/api', kind: 'dir', depth: 1 },
    { name: 'session.ts', path: 'src/api/session.ts', kind: 'file', depth: 2 },
    { name: 'router.ts', path: 'src/api/router.ts', kind: 'file', depth: 2 },
    { name: 'ui', path: 'src/ui', kind: 'dir', depth: 1 },
    { name: 'onboarding.tsx', path: 'src/ui/onboarding.tsx', kind: 'file', depth: 2 },
    { name: 'README.md', path: 'README.md', kind: 'file', depth: 0 },
    { name: 'package.json', path: 'package.json', kind: 'file', depth: 0 },
  ],
  'pj-ledger': [
    { name: 'migrations', path: 'migrations', kind: 'dir', depth: 0 },
    { name: '0001_init.sql', path: 'migrations/0001_init.sql', kind: 'file', depth: 1 },
    { name: 'import.ts', path: 'import.ts', kind: 'file', depth: 0 },
  ],
};
