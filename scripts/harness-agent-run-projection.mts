/**
 * Semantic event contract gate (Phase 1).
 *
 * Proves that a neutral {@link AgentRunEvent} stream — and nothing else — can
 * reconstruct the run tree, current employee states, the tool/activity timeline
 * (with a tool-fact-derived ActivityKind), artifacts, approvals, and the
 * terminal status, via the pure `projectAgentRun` reducer. Also locks the
 * "team-conversation root is an invisible director, never a fabricated actor"
 * invariant and the determinism of the projection.
 *
 * Pure Node via tsx against shared-types source — no DOM, no renderer, no Pi.
 */
import {
  type ActivityKind,
  type AgentRunEvent,
  classifyToolActivity,
  parseToolRichDetail,
  projectAgentRun,
} from '../packages/shared-types/src/index.js';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const THREAD = 'thread-1';
const ROOT = 'root-1';

interface Scope {
  runId: string;
  parentRunId?: string;
  employeeId?: string;
  relation?: AgentRunEvent['relation'];
  workKind?: AgentRunEvent['workKind'];
}

function started(s: Scope, objective: string): AgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'run.started',
    payload: { objective, access: 'write' },
  };
}
function finished(
  s: Scope,
  status: 'completed' | 'failed' | 'cancelled',
  summary?: string,
): AgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type:
      status === 'completed'
        ? 'run.completed'
        : status === 'failed'
          ? 'run.failed'
          : 'run.cancelled',
    payload: { status, ...(summary ? { summary } : {}) },
  };
}
function tool(s: Scope, toolName: string, activityKind?: ActivityKind): AgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'tool.started',
    payload: {
      toolCallId: `${s.runId}:${toolName}`,
      toolName,
      status: 'started',
      ...(activityKind ? { activityKind } : {}),
    },
  };
}
function artifact(s: Scope, title: string): AgentRunEvent {
  return { threadId: THREAD, rootRunId: ROOT, ...s, type: 'artifact.created', payload: { title } };
}
function approval(s: Scope, title: string): AgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'approval.requested',
    payload: { uiRequestId: `${s.runId}:appr`, title },
  };
}

console.log('agent-run-projection gate');

// ── activityKind classification (tool facts only) ───────────────────────────
console.log('\n[classify] tool-name → activity kind');
const CLASSIFY: Array<[string, ActivityKind]> = [
  ['read_file', 'read'],
  ['project_read_file_preview', 'read'],
  ['write_file', 'write'],
  ['apply_patch', 'edit'],
  ['str_replace_edit', 'edit'],
  ['grep', 'search'],
  ['project_list_dir', 'search'],
  ['bash', 'shell'],
  ['run_tests', 'test'],
  ['build_bundle', 'build'],
  ['readFileSync', 'read'], // camelCase split
  ['run_tests_and_build', 'test'], // collision: test wins over build/shell (order)
  ['some_unknown_tool', 'inspect'],
  // Whole-token matching: these must NOT false-match short substrings.
  ['budget_report', 'inspect'], // not 'read' via "get"
  ['rebuild_status', 'inspect'], // not 'build' via substring (token is "rebuild")
  ['calls_metric', 'inspect'], // not 'search' via "ls"
];
for (const [name, kind] of CLASSIFY) {
  check(
    `classify ${name} → ${kind}`,
    classifyToolActivity(name) === kind,
    classifyToolActivity(name),
  );
}

// ── Scenario: team plan + 3 parallel children, in flight ────────────────────
console.log('\n[parallel] team root + 3 parallel children running');
{
  const stream: AgentRunEvent[] = [
    started({ runId: ROOT, workKind: 'plan' }, 'Ship the feature'),
    started(
      {
        runId: 'c1',
        parentRunId: ROOT,
        employeeId: 'alex',
        relation: 'delegate',
        workKind: 'implement',
      },
      'Backend',
    ),
    started(
      {
        runId: 'c2',
        parentRunId: ROOT,
        employeeId: 'maya',
        relation: 'delegate',
        workKind: 'design',
      },
      'Frontend',
    ),
    started(
      {
        runId: 'c3',
        parentRunId: ROOT,
        employeeId: 'kai',
        relation: 'delegate',
        workKind: 'implement',
      },
      'Glue',
    ),
    tool({ runId: 'c1', employeeId: 'alex' }, 'bash'),
    tool({ runId: 'c2', employeeId: 'maya' }, 'read_file'),
    artifact({ runId: 'c1', employeeId: 'alex' }, 'api.ts'),
  ];
  const p = projectAgentRun(stream);
  check('root is the only forest root', p.rootRunIds.length === 1 && p.rootRunIds[0] === ROOT);
  check('root has 3 children', (p.runsById[ROOT]?.childRunIds.length ?? 0) === 3);
  check('root carries workKind=plan', p.runsById[ROOT]?.workKind === 'plan');
  check('director root is NOT an actor', !p.employeeStates.some((e) => e.runId === ROOT));
  check('3 employees working', p.employeeStates.filter((e) => e.state === 'working').length === 3);
  check(
    'alex is an actor',
    p.employeeStates.some((e) => e.employeeId === 'alex' && e.state === 'working'),
  );
  check(
    'activity timeline has 2 tool entries in order',
    p.activity.length === 2 && p.activity[0]?.index === 0,
  );
  check(
    'bash classified as shell',
    p.activity.find((a) => a.toolName === 'bash')?.activityKind === 'shell',
  );
  check(
    'read_file classified as read',
    p.activity.find((a) => a.toolName === 'read_file')?.activityKind === 'read',
  );
  check(
    '1 artifact attributed to alex',
    p.artifacts.length === 1 && p.artifacts[0]?.employeeId === 'alex',
  );
  check('no terminal status while running', p.terminalStatus === null);
}

// ── Scenario: worker → reviewer → revise (nested, depth 2) ───────────────────
console.log('\n[review] nested delegation depth 2');
{
  const stream: AgentRunEvent[] = [
    started({ runId: ROOT }, 'Build + review'),
    started(
      {
        runId: 'w',
        parentRunId: ROOT,
        employeeId: 'kai',
        relation: 'delegate',
        workKind: 'implement',
      },
      'Write code',
    ),
    started(
      { runId: 'r', parentRunId: 'w', employeeId: 'raj', relation: 'review', workKind: 'review' },
      'Review code',
    ),
    finished({ runId: 'r', employeeId: 'raj' }, 'completed', 'LGTM with nits'),
  ];
  const p = projectAgentRun(stream);
  check('w grafts under root', p.runsById[ROOT]?.childRunIds.includes('w') === true);
  check('r grafts under w (depth 2)', p.runsById.w?.childRunIds.includes('r') === true);
  check('reviewer relation=review', p.runsById.r?.relation === 'review');
  check(
    'completed reviewer is idle (not an actor)',
    !p.employeeStates.some((e) => e.runId === 'r'),
  );
  check(
    'worker still working',
    p.employeeStates.some((e) => e.employeeId === 'kai' && e.state === 'working'),
  );
  check('reviewer summary captured', p.runsById.r?.summary === 'LGTM with nits');
}

// ── Scenario: approval wait ─────────────────────────────────────────────────
console.log('\n[approval] employee waiting on approval');
{
  const stream: AgentRunEvent[] = [
    started({ runId: ROOT, employeeId: 'alex' }, 'Dangerous task'),
    tool({ runId: ROOT, employeeId: 'alex' }, 'bash'),
    approval({ runId: ROOT, employeeId: 'alex' }, 'Approve rm -rf?'),
  ];
  const p = projectAgentRun(stream);
  check(
    'approval recorded',
    p.approvals.length === 1 && p.approvals[0]?.title === 'Approve rm -rf?',
  );
  check(
    'employee is waiting (not working)',
    p.employeeStates.some((e) => e.employeeId === 'alex' && e.state === 'waiting'),
  );
}

// ── Scenario: child failure + retry ─────────────────────────────────────────
console.log('\n[failure] child fails, retry child runs');
{
  const stream: AgentRunEvent[] = [
    started({ runId: ROOT }, 'Task'),
    started(
      { runId: 'a', parentRunId: ROOT, employeeId: 'kai', relation: 'delegate' },
      'Attempt 1',
    ),
    finished({ runId: 'a', employeeId: 'kai' }, 'failed', 'boom'),
    started(
      { runId: 'b', parentRunId: ROOT, employeeId: 'kai', relation: 'delegate' },
      'Attempt 2',
    ),
  ];
  const p = projectAgentRun(stream);
  check('failed attempt status=failed', p.runsById.a?.status === 'failed');
  check('failed attempt not an actor', !p.employeeStates.some((e) => e.runId === 'a'));
  check(
    'retry attempt working',
    p.employeeStates.some((e) => e.runId === 'b' && e.state === 'working'),
  );
  check('root has both attempts as children', (p.runsById[ROOT]?.childRunIds.length ?? 0) === 2);
}

// ── Scenario: terminal status (completed / cancelled) ────────────────────────
console.log('\n[terminal] root terminal status');
{
  const completed = projectAgentRun([
    started({ runId: ROOT, employeeId: 'alex' }, 'Solo'),
    artifact({ runId: ROOT, employeeId: 'alex' }, 'report.md'),
    finished({ runId: ROOT, employeeId: 'alex' }, 'completed', 'done'),
  ]);
  check('completed root → terminalStatus completed', completed.terminalStatus === 'completed');
  check('completed root has no active actors', completed.employeeStates.length === 0);
  check('artifact survived to terminal', completed.artifacts.length === 1);

  const cancelled = projectAgentRun([
    started({ runId: ROOT, employeeId: 'alex' }, 'Solo'),
    finished({ runId: ROOT, employeeId: 'alex' }, 'cancelled'),
  ]);
  check('cancelled root → terminalStatus cancelled', cancelled.terminalStatus === 'cancelled');
}

// ── Scenario: explicit activityKind overrides classification ────────────────
console.log('\n[override] explicit activityKind wins over name classification');
{
  const p = projectAgentRun([
    started({ runId: ROOT, employeeId: 'alex' }, 'x'),
    tool({ runId: ROOT, employeeId: 'alex' }, 'bash', 'build'),
  ]);
  check('explicit activityKind=build used (not shell)', p.activity[0]?.activityKind === 'build');
}

// ── Scenario: out-of-order arrival (child + tool before run.started) ────────
console.log('\n[out-of-order] grafting without in-order events');
{
  // A tool event for c1 arrives before c1's run.started; c1's run.started
  // arrives before the parent ROOT's run.started. The tree must still rebuild.
  const stream: AgentRunEvent[] = [
    tool({ runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' }, 'bash'),
    started(
      { runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' },
      'Backend',
    ),
    started({ runId: ROOT }, 'Root'),
  ];
  const p = projectAgentRun(stream);
  check(
    'child grafts under root despite out-of-order',
    p.runsById[ROOT]?.childRunIds.includes('c1') === true,
  );
  check(
    'child scope seeded from first (tool) event',
    p.runsById.c1?.employeeId === 'alex' && p.runsById.c1?.relation === 'delegate',
  );
  check('later run.started fills objective', p.runsById.c1?.objective === 'Backend');
  check(
    'pre-start tool still recorded',
    p.activity.some((a) => a.runId === 'c1' && a.toolName === 'bash'),
  );
  check('root is the forest root', p.rootRunIds.length === 1 && p.rootRunIds[0] === ROOT);
}

// ── Scenario: children-only stream (root run.started never emitted) ──────────
console.log('\n[no-root] director root absent from the event stream');
{
  // Real shape: the root agent keeps its own stream, so AgentRunEvents carry
  // only the delegated children. rootRunId is known but has no node.
  const stream: AgentRunEvent[] = [
    started({ runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' }, 'A'),
    started({ runId: 'c2', parentRunId: ROOT, employeeId: 'maya', relation: 'delegate' }, 'B'),
    tool({ runId: 'c1', employeeId: 'alex' }, 'write_file'),
  ];
  const p = projectAgentRun(stream);
  check('rootRunId known from child scope', p.rootRunId === ROOT);
  check('no fabricated root node', p.runsById[ROOT] === undefined);
  check(
    'children are forest roots (parent absent)',
    p.rootRunIds.length === 2 && p.rootRunIds.includes('c1'),
  );
  check('both children are actors', p.employeeStates.length === 2);
  check('terminalStatus null when root run absent', p.terminalStatus === null);
}

// ── D1: rich tool detail by family ──────────────────────────────────────────
// Inject-proof: break the family map (e.g. make 'shell' → 'file' in toolFamily)
// → the terminal checks below fail; or drop the projection's richDetail field →
// the projection checks fail. Both prove the rich detail is load-bearing.
console.log('\n[D1] rich tool detail parsed by family');
{
  const term = parseToolRichDetail(
    'bash',
    JSON.stringify({ input: { command: 'ls -la' }, exitCode: 0 }),
  );
  check(
    'terminal: command + exitCode parsed',
    term.family === 'terminal' && term.command === 'ls -la' && term.exitCode === 0,
  );
  const file = parseToolRichDetail('write_file', JSON.stringify({ file_path: 'src/a.ts' }));
  check('file: path resolved from file_path', file.family === 'file' && file.path === 'src/a.ts');
  const search = parseToolRichDetail('grep', JSON.stringify({ pattern: 'TODO', matches: [1, 2, 3] }));
  check(
    'search: query + hitCount from matches[]',
    search.family === 'search' && search.query === 'TODO' && search.hitCount === 3,
  );
  const browser = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({
      content: [
        { type: 'text', text: 'Title: Example Domain\nhttps://example.com' },
        { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
      ],
    }),
  );
  check(
    'browser: MCP image content yields URL/title/screenshot',
    browser.family === 'browser' &&
      browser.url === 'https://example.com' &&
      browser.title === 'Example Domain' &&
      browser.screenshot?.mimeType === 'image/png' &&
      browser.screenshot.dataRef === 'data:image/png;base64,aGVsbG8=',
  );
  const textOnlyMcp = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({ content: [{ type: 'text', text: 'https://example.com' }] }),
  );
  check('browser: text-only MCP detail degrades generic', textOnlyMcp.family === 'generic');
  const gen = parseToolRichDetail('think', 'not json');
  check('generic: unparseable detail degrades to generic family', gen.family === 'generic');
  const empty = parseToolRichDetail('bash', undefined);
  check(
    'terminal: missing detail → empty fields, never throws',
    empty.family === 'terminal' && empty.command === undefined && empty.exitCode === undefined,
  );

  // The richDetail flows onto every ActivityEntry through the projection.
  const toolEv = (toolName: string, detail: string): AgentRunEvent => ({
    threadId: THREAD,
    rootRunId: ROOT,
    runId: 'c1',
    employeeId: 'alex',
    type: 'tool.completed',
    payload: { toolCallId: `c1:${toolName}`, toolName, status: 'completed', detail },
  });
  const p = projectAgentRun([
    started({ runId: ROOT, workKind: 'plan' }, 'x'),
    started({ runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' }, 'a'),
    toolEv('bash', JSON.stringify({ command: 'pnpm test', exitCode: 1 })),
    toolEv('grep', JSON.stringify({ query: 'foo', count: 7 })),
    toolEv(
      'mcp_call',
      JSON.stringify({
        result: {
          content: [
            { type: 'text', text: 'Title: Example Domain\nhttps://example.com' },
            { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
          ],
        },
      }),
    ),
  ]);
  const bashRd = p.activity.find((a) => a.toolName === 'bash')?.richDetail;
  check(
    'projection: bash activity carries terminal richDetail',
    bashRd?.family === 'terminal' && bashRd.exitCode === 1,
  );
  const grepRd = p.activity.find((a) => a.toolName === 'grep')?.richDetail;
  check(
    'projection: grep activity carries search richDetail',
    grepRd?.family === 'search' && grepRd.hitCount === 7,
  );
  const browserRd = p.activity.find((a) => a.toolName === 'mcp_call')?.richDetail;
  check(
    'projection: mcp_call browser result carries browser richDetail',
    browserRd?.family === 'browser' && browserRd.title === 'Example Domain',
  );
}

// ── Determinism ─────────────────────────────────────────────────────────────
console.log('\n[determinism] same stream → byte-identical projection');
{
  const stream: AgentRunEvent[] = [
    started({ runId: ROOT, workKind: 'plan' }, 'x'),
    started({ runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' }, 'a'),
    tool({ runId: 'c1', employeeId: 'alex' }, 'grep'),
    artifact({ runId: 'c1', employeeId: 'alex' }, 'out.txt'),
  ];
  const a = JSON.stringify(projectAgentRun(stream));
  const b = JSON.stringify(projectAgentRun(stream));
  check('two runs produce identical projection', a === b);
}

console.log(`\nagent-run-projection: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`agent-run-projection gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('agent-run-projection gate PASSED');
