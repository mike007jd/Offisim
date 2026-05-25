import type {
  ActivityEvent,
  ChatMessage,
  ChatThread,
  Company,
  Deliverable,
  Employee,
  FileNode,
  Listing,
  Project,
  RunCost,
  Skill,
  Sop,
  SopStage,
  UsagePoint,
} from './types.js';

const HOUR = 3_600_000;
const now = Date.UTC(2026, 4, 25, 9, 0, 0);

export const companies: Company[] = [
  {
    id: 'co-northwind',
    name: 'Northwind Studio',
    initials: 'NW',
    accentA: '#6a8dff',
    accentB: '#3a5fd0',
  },
  {
    id: 'co-atlas',
    name: 'Atlas Robotics',
    initials: 'AR',
    accentA: '#7c4ddb',
    accentB: '#5b2fb0',
  },
  { id: 'co-harbor', name: 'Harbor Foods', initials: 'HF', accentA: '#1aa46a', accentB: '#0f7a4d' },
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
    avatarA: '#6a8dff',
    avatarB: '#3a5fd0',
    discipline: 'Backend systems',
    modelLabel: 'MiniMax-M2.7',
    skillCount: 6,
  },
  {
    id: 'emp-devin',
    name: 'Devin Park',
    role: 'Product Designer',
    kind: 'internal',
    online: true,
    avatarA: '#7c4ddb',
    avatarB: '#5b2fb0',
    discipline: 'Interface & flows',
    modelLabel: 'MiniMax-M2.7',
    skillCount: 4,
  },
  {
    id: 'emp-sela',
    name: 'Sela Ortiz',
    role: 'QA Analyst',
    kind: 'internal',
    online: false,
    avatarA: '#1aa46a',
    avatarB: '#0f7a4d',
    discipline: 'Test & verification',
    modelLabel: 'MiniMax-M2.7',
    skillCount: 5,
  },
  {
    id: 'emp-orion',
    name: 'Orion Audit',
    role: 'Security Review',
    kind: 'external',
    brandLabel: 'A2A',
    online: true,
    avatarA: '#586273',
    avatarB: '#353c49',
    discipline: 'Static analysis',
    modelLabel: 'Remote agent',
    skillCount: 2,
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
      body: 'Taking the session endpoints. I drafted the contract and wired the first handler against the sandbox.',
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
  { id: 'dl1', name: 'session.ts', kind: 'code', contributorIds: ['emp-mara'] },
  { id: 'dl2', name: 'onboarding-flow.fig', kind: 'design', contributorIds: ['emp-devin'] },
  { id: 'dl3', name: 'verify-report.md', kind: 'report', contributorIds: ['emp-sela'] },
];

export const sops: Sop[] = [
  {
    id: 'sop-ship',
    name: 'Ship a Feature',
    summary: 'Plan, implement, verify, and hand off a scoped feature end to end.',
    status: 'active',
    stageCount: 5,
    roleCount: 3,
    lastRunLabel: '2h ago',
    runState: 'running',
  },
  {
    id: 'sop-triage',
    name: 'Incident Triage',
    summary: 'Reproduce, isolate, and patch a production incident with a written postmortem.',
    status: 'active',
    stageCount: 4,
    roleCount: 2,
    lastRunLabel: 'Yesterday',
    runState: 'idle',
  },
  {
    id: 'sop-research',
    name: 'Market Research',
    summary: 'Survey a problem space and produce a comparison brief with recommendations.',
    status: 'draft',
    stageCount: 6,
    roleCount: 2,
    lastRunLabel: 'Never run',
    runState: 'idle',
  },
];

export const sopStages: Record<string, SopStage[]> = {
  'sop-ship': [
    { id: 'st1', name: 'Plan', role: 'Engineering Lead', state: 'done' },
    { id: 'st2', name: 'Implement', role: 'Engineering Lead', state: 'running' },
    { id: 'st3', name: 'Design review', role: 'Product Designer', state: 'pending' },
    { id: 'st4', name: 'Verify', role: 'QA Analyst', state: 'pending' },
    { id: 'st5', name: 'Hand off', role: 'Engineering Lead', state: 'pending' },
  ],
  'sop-triage': [
    { id: 'tt1', name: 'Reproduce', role: 'QA Analyst', state: 'done' },
    { id: 'tt2', name: 'Isolate', role: 'Engineering Lead', state: 'done' },
    { id: 'tt3', name: 'Patch', role: 'Engineering Lead', state: 'pending' },
    { id: 'tt4', name: 'Postmortem', role: 'Engineering Lead', state: 'pending' },
  ],
  'sop-research': [
    { id: 'rr1', name: 'Survey', role: 'Product Designer', state: 'pending' },
    { id: 'rr2', name: 'Compare', role: 'Product Designer', state: 'pending' },
    { id: 'rr3', name: 'Recommend', role: 'Engineering Lead', state: 'pending' },
  ],
};

export const listings: Listing[] = [
  {
    id: 'ls-react-eng',
    kind: 'employee',
    name: 'Senior React Engineer',
    summary: 'Implements dense product UIs with strict design-system adherence.',
    creator: 'northwind',
    rating: 4.8,
    installs: 3214,
    version: '2.1.0',
    tags: ['frontend', 'react', 'design-system'],
  },
  {
    id: 'ls-pdf-skill',
    kind: 'skill',
    name: 'PDF Extraction',
    summary: 'Parse, chunk, and summarize PDFs with citation-safe references.',
    creator: 'atlas',
    rating: 4.6,
    installs: 8190,
    version: '1.4.2',
    tags: ['documents', 'parsing'],
  },
  {
    id: 'ls-ship-sop',
    kind: 'sop',
    name: 'Ship a Feature',
    summary: 'Battle-tested five-stage delivery pipeline with verification gates.',
    creator: 'northwind',
    rating: 4.9,
    installs: 1502,
    version: '3.0.0',
    tags: ['delivery', 'process'],
  },
  {
    id: 'ls-studio-template',
    kind: 'template',
    name: 'Product Studio',
    summary: 'A five-role company template for shipping software products.',
    creator: 'harbor',
    rating: 4.5,
    installs: 642,
    version: '1.0.0',
    tags: ['company', 'template'],
  },
  {
    id: 'ls-open-office',
    kind: 'layout',
    name: 'Open Office',
    summary: 'Compact floor layout tuned for small teams and high visibility.',
    creator: 'atlas',
    rating: 4.3,
    installs: 980,
    version: '1.2.0',
    tags: ['office', 'layout'],
  },
  {
    id: 'ls-desk-prefab',
    kind: 'prefab',
    name: 'Standing Desk Cluster',
    summary: 'Reusable desk cluster prefab with seating and props.',
    creator: 'harbor',
    rating: 4.1,
    installs: 410,
    version: '1.0.1',
    tags: ['prefab', 'furniture'],
  },
  {
    id: 'ls-launch-bundle',
    kind: 'bundle',
    name: 'Launch Kit',
    summary: 'Template, SOPs, and skills bundled for a product launch.',
    creator: 'northwind',
    rating: 4.7,
    installs: 256,
    version: '2.0.0',
    tags: ['bundle', 'launch'],
  },
];

export const activityEvents: ActivityEvent[] = [
  {
    id: 'ev1',
    at: now - HOUR * 0.2,
    level: 'ok',
    source: 'Mara Quinn',
    title: 'Run completed',
    detail: 'Implement session contract · 3 tools · $0.0184',
  },
  {
    id: 'ev2',
    at: now - HOUR * 0.5,
    level: 'info',
    source: 'Devin Park',
    title: 'Deliverable attached',
    detail: 'onboarding-flow.fig added to Relay Launch · Team',
  },
  {
    id: 'ev3',
    at: now - HOUR * 1.2,
    level: 'warn',
    source: 'Runtime',
    title: 'Context window near limit',
    detail: 'Thread Relay Launch · Team reached 82% of model context',
  },
  {
    id: 'ev4',
    at: now - HOUR * 26,
    level: 'error',
    source: 'Orion Audit',
    title: 'Transport authorization failed',
    detail: 'Remote agent returned 401 before run start',
  },
];

export const runCost: RunCost = { tokens: 48210, costLabel: '$0.41', live: true };

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
    { name: 'src', kind: 'dir', depth: 0 },
    { name: 'api', kind: 'dir', depth: 1 },
    { name: 'session.ts', kind: 'file', depth: 2 },
    { name: 'router.ts', kind: 'file', depth: 2 },
    { name: 'ui', kind: 'dir', depth: 1 },
    { name: 'onboarding.tsx', kind: 'file', depth: 2 },
    { name: 'README.md', kind: 'file', depth: 0 },
    { name: 'package.json', kind: 'file', depth: 0 },
  ],
  'pj-ledger': [
    { name: 'migrations', kind: 'dir', depth: 0 },
    { name: '0001_init.sql', kind: 'file', depth: 1 },
    { name: 'import.ts', kind: 'file', depth: 0 },
  ],
};
