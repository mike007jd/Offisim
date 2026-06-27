/**
 * Loop graph projection + layout oracle (PR-09). Proves the PURE adapter + ELK
 * layout the read-only `LoopGraphPanel` renders, WITHOUT a DOM or React Flow
 * runtime: we import the adapter and layout modules directly and run ELK
 * headlessly via the node bundle (`elkjs/lib/elk.bundled.js`, worker-less ctor).
 *
 * Covers the PR-09 test matrix: straight sequence; feedback cycle / self loop;
 * retry + escalate; nested inline child graph; referenced subloop revision;
 * invalid/dangling ids (degrade, surface findings, never throw); expand/collapse
 * visible subset; drilldown/breadcrumb path; STABLE layout across identical IR;
 * async cancellation on rapid revision change; large-graph performance budget;
 * keyboard/a11y label data present.
 *
 * Style mirrors scripts/harness-loop-mission-adapter.mts. Pure Node via tsx; no
 * Pi, no renderer DOM. Scripts may NOT use Math.random / Date.now for variation —
 * everything here varies by index.
 */

import assert from 'node:assert/strict';
import ElkConstructor from 'elkjs/lib/elk.bundled.js';
import {
  type LoopGraphProjection,
  breadcrumbTrail,
  projectLoopGraph,
  selectVisibleSubset,
} from '../apps/desktop/renderer/src/surfaces/mission/loops/graph/loop-graph-adapter.ts';
import {
  type ElkLike,
  LayoutCancelledError,
  directionForWidth,
  layoutGraph,
} from '../apps/desktop/renderer/src/surfaces/mission/loops/graph/loop-graph-layout.ts';
import type {
  LoopEdge,
  LoopIR,
  LoopNode,
  LoopValidationFinding,
} from '../packages/shared-types/src/index.ts';

let passed = 0;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

// ---------------------------------------------------------------------------
// ELK factory (node bundle; worker-less constructor)
// ---------------------------------------------------------------------------

function makeElk(): ElkLike {
  // elkjs default export is a constructor; the node bundle runs worker-less.
  const Ctor = ElkConstructor as unknown as new () => ElkLike;
  return new Ctor();
}

// ---------------------------------------------------------------------------
// IR builders (deterministic; vary by index, never randomness)
// ---------------------------------------------------------------------------

function baseMetadata(): LoopIR['metadata'] {
  return { profileId: 'software-development', profileVersion: '2.2.0', compilerVersion: '1' };
}

function baseCompletion(): LoopIR['completion'] {
  return {
    outcome: 'The loop reaches a verified result',
    acceptance: [
      {
        id: 'a1',
        description: 'tests pass',
        oracle: 'deterministic',
        evaluatorId: 'command_exit_zero',
        required: true,
      },
      { id: 'a2', description: 'reviewer approves', oracle: 'review', required: false },
    ],
    exitStates: ['success', 'blocked-handoff'],
  };
}

function makeIR(overrides: Partial<LoopIR>): LoopIR {
  return {
    schemaVersion: '1',
    title: overrides.title ?? 'Test Loop',
    outcome: overrides.outcome ?? 'Get to done',
    inputs: overrides.inputs ?? [
      { id: 'in1', label: 'Repository', type: 'repo', required: true },
      { id: 'in2', label: 'Notes', type: 'text', required: false },
    ],
    outputs: overrides.outputs ?? [
      { id: 'out1', label: 'Merged change', type: 'artifact', required: true },
    ],
    parameters: overrides.parameters ?? [],
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    completion: overrides.completion ?? baseCompletion(),
    budget: overrides.budget ?? {
      tier: 'standard',
      maxConcurrentAgents: 3,
      maxTotalAgents: 8,
      maxRecursionDepth: 2,
      maxFixWavesPerGate: 3,
    },
    humanGates: overrides.humanGates ?? [],
    skillBindings: overrides.skillBindings ?? [
      { skillId: 'fleet-loop', skillVersion: '1.0.0', orderIndex: 1 },
      { skillId: 'reviewer', skillVersion: '0.3.0', orderIndex: 0 },
    ],
    profileData: overrides.profileData,
    metadata: overrides.metadata ?? baseMetadata(),
  };
}

const n = (
  id: string,
  kind: LoopNode['kind'],
  label: string,
  extra: Partial<LoopNode> = {},
): LoopNode => ({
  id,
  kind,
  label,
  ...extra,
});

const e = (
  id: string,
  from: string,
  to: string,
  kind: LoopEdge['kind'],
  extra: Partial<LoopEdge> = {},
): LoopEdge => ({
  id,
  from,
  to,
  kind,
  ...extra,
});

/** A straight start→action→verify→finish sequence. */
function straightIR(): LoopIR {
  return makeIR({
    title: 'Straight Sequence',
    nodes: [
      n('s', 'start', 'Start'),
      n('act', 'action', 'Do the work'),
      n('ver', 'verify', 'Verify result'),
      n('f', 'finish', 'Finish'),
    ],
    edges: [
      e('e1', 's', 'act', 'next'),
      e('e2', 'act', 'ver', 'next'),
      e('e3', 'ver', 'f', 'next'),
    ],
  });
}

/** A feedback cycle plus a self loop on the action. */
function feedbackIR(): LoopIR {
  return makeIR({
    title: 'Feedback Cycle',
    nodes: [
      n('s', 'start', 'Start'),
      n('act', 'action', 'Build'),
      n('dec', 'decision', 'Pass?'),
      n('f', 'finish', 'Finish'),
    ],
    edges: [
      e('e1', 's', 'act', 'next'),
      e('e2', 'act', 'dec', 'next'),
      e('e3', 'dec', 'f', 'next', { label: 'pass' }),
      e('e4', 'dec', 'act', 'feedback', { label: 'fail' }),
      e('e5', 'act', 'act', 'retry', { maxRetries: 2 }), // self loop retry
    ],
  });
}

/** retry + escalate edges. */
function retryEscalateIR(): LoopIR {
  return makeIR({
    title: 'Retry and Escalate',
    nodes: [
      n('s', 'start', 'Start'),
      n('act', 'action', 'Attempt'),
      n('gate', 'human_gate', 'Approve risky step'),
      n('f', 'finish', 'Finish'),
    ],
    edges: [
      e('e1', 's', 'act', 'next'),
      e('e2', 'act', 'act', 'retry', { maxRetries: 3 }),
      e('e3', 'act', 'gate', 'escalate', { label: 'too many retries' }),
      e('e4', 'gate', 'f', 'next'),
    ],
    humanGates: [
      {
        id: 'g1',
        nodeId: 'gate',
        prompt: 'Approve the risky deploy?',
        reason: 'irreversible production change',
      },
    ],
  });
}

/** A subloop with an inline child graph. */
function nestedInlineIR(): LoopIR {
  return makeIR({
    title: 'Nested Inline',
    nodes: [
      n('s', 'start', 'Start'),
      n('sub', 'subloop', 'Inner refinement', {
        childGraph: {
          nodes: [
            n('cs', 'start', 'Inner start'),
            n('ca', 'action', 'Inner work'),
            n('cf', 'finish', 'Inner finish'),
          ],
          edges: [e('ce1', 'cs', 'ca', 'next'), e('ce2', 'ca', 'cf', 'next')],
        },
      }),
      n('f', 'finish', 'Finish'),
    ],
    edges: [e('e1', 's', 'sub', 'next'), e('e2', 'sub', 'f', 'next')],
  });
}

/** A subloop referencing a saved revision (no inline child). */
function referencedSubloopIR(): LoopIR {
  return makeIR({
    title: 'Referenced Subloop',
    nodes: [
      n('s', 'start', 'Start'),
      n('sub', 'subloop', 'Saved subroutine', { subloopRevisionId: 'rev-xyz' }),
      n('f', 'finish', 'Finish'),
    ],
    edges: [e('e1', 's', 'sub', 'next'), e('e2', 'sub', 'f', 'next')],
  });
}

/** Dangling edges: one edge points at a missing node, plus a duplicate node id. */
function danglingIR(): LoopIR {
  return makeIR({
    title: 'Dangling',
    nodes: [
      n('s', 'start', 'Start'),
      n('act', 'action', 'Work'),
      n('act', 'action', 'Dup id'), // duplicate id (second dropped)
      n('f', 'finish', 'Finish'),
    ],
    edges: [
      e('e1', 's', 'act', 'next'),
      e('e2', 'act', 'ghost', 'next'), // dangling target
      e('e3', 'phantom', 'f', 'next'), // dangling source
      e('e4', 'act', 'f', 'next'),
    ],
  });
}

/**
 * A large graph: `count` action nodes chained in a line, with a feedback edge
 * every 10th node back to the start of its decade. Deterministic by index.
 */
function largeIR(count: number): LoopIR {
  const nodes: LoopNode[] = [n('s', 'start', 'Start')];
  const edges: LoopEdge[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `a${i}`;
    nodes.push(n(id, i % 7 === 0 ? 'verify' : 'action', `Step ${i}`));
    const prev = i === 0 ? 's' : `a${i - 1}`;
    edges.push(e(`n${i}`, prev, id, 'next'));
    if (i > 0 && i % 10 === 0) {
      edges.push(e(`fb${i}`, id, `a${i - 9}`, 'feedback', { label: 'retry decade' }));
    }
  }
  nodes.push(n('f', 'finish', 'Finish'));
  edges.push(e('nf', `a${count - 1}`, 'f', 'next'));
  return makeIR({ title: 'Large', nodes, edges });
}

/**
 * A top-level node literally named 'root' that carries a child graph. The OLD
 * edge-id scheme used 'root' as the root-graph sentinel, so this node's child
 * edges would collide with top-level edge ids. The sentinel is now '__root__'.
 */
function rootNamedNodeIR(): LoopIR {
  return makeIR({
    title: 'Root Named Node',
    nodes: [
      n('s', 'start', 'Start'),
      n('root', 'subloop', 'Subloop named root', {
        childGraph: {
          nodes: [n('cs', 'start', 'Inner start'), n('ca', 'action', 'Inner work')],
          // This child edge id is 'e1' — same local id as the top-level edge below.
          edges: [e('e1', 'cs', 'ca', 'next')],
        },
      }),
      n('f', 'finish', 'Finish'),
    ],
    // Top-level edge also id 'e1' — must NOT collide with the child's 'e1'.
    edges: [e('e1', 's', 'root', 'next'), e('e2', 'root', 'f', 'next')],
  });
}

/**
 * Zero top-level retries, but a subloop whose inline child graph contains a retry
 * edge. The loop-wide retry summary MUST reflect the nested retry.
 */
function nestedRetryOnlyIR(): LoopIR {
  return makeIR({
    title: 'Nested Retry Only',
    nodes: [
      n('s', 'start', 'Start'),
      n('sub', 'subloop', 'Inner retrying loop', {
        childGraph: {
          nodes: [
            n('cs', 'start', 'Inner start'),
            n('ca', 'action', 'Inner work'),
            n('cf', 'finish', 'Inner finish'),
          ],
          edges: [
            e('ce1', 'cs', 'ca', 'next'),
            e('ce2', 'ca', 'ca', 'retry', { maxRetries: 4 }), // nested retry
            e('ce3', 'ca', 'cf', 'next'),
          ],
        },
      }),
      n('f', 'finish', 'Finish'),
    ],
    // Deliberately NO retry edges at the top level.
    edges: [e('e1', 's', 'sub', 'next'), e('e2', 'sub', 'f', 'next')],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findingCodes(p: LoopGraphProjection): string[] {
  return p.findings.map((f) => f.code);
}

function positionsKey(laidOut: { nodes: { id: string; x: number; y: number }[] }): string {
  return [...laidOut.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((nd) => `${nd.id}@${Math.round(nd.x)},${Math.round(nd.y)}`)
    .join('|');
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.log('Loop graph projection + layout harness\n');

  await check('straight sequence projects all nodes/edges, no findings', () => {
    const p = projectLoopGraph(straightIR());
    assert.equal(p.nodes.length, 4);
    assert.equal(p.edges.length, 3);
    assert.equal(p.findings.length, 0, `unexpected findings: ${JSON.stringify(p.findings)}`);
    assert.equal(p.counts.nodes, 4);
    assert.equal(p.counts.edges, 3);
  });

  await check('feedback cycle + self loop are first-class projected edges', () => {
    const p = projectLoopGraph(feedbackIR());
    const feedback = p.edges.find((x) => x.kind === 'feedback');
    assert.ok(feedback, 'feedback edge present');
    assert.equal(feedback?.label, 'fail');
    const selfLoop = p.edges.find((x) => x.selfLoop);
    assert.ok(selfLoop, 'self loop present');
    assert.equal(selfLoop?.kind, 'retry');
    assert.equal(selfLoop?.maxRetries, 2);
    assert.equal(p.findings.length, 0);
  });

  await check('retry + escalate carry kind, badge label, retries; gate inspector populated', () => {
    const p = projectLoopGraph(retryEscalateIR());
    const retry = p.edges.find((x) => x.kind === 'retry');
    assert.equal(retry?.maxRetries, 3);
    const escalate = p.edges.find((x) => x.kind === 'escalate');
    assert.ok(escalate, 'escalate edge present');
    assert.equal(escalate?.label, 'too many retries');
    const gateNode = p.nodes.find((x) => x.kind === 'human_gate');
    assert.ok(gateNode?.inspector.gate, 'gate inspector present');
    assert.equal(gateNode?.inspector.gate?.reason, 'irreversible production change');
  });

  await check('nested inline child graph flattens to a separate level keyed by subloop id', () => {
    const p = projectLoopGraph(nestedInlineIR());
    const sub = p.nodes.find((x) => x.kind === 'subloop');
    assert.ok(sub, 'subloop node present');
    assert.equal(sub?.childNodeCount, 3);
    assert.equal(sub?.childGraphId, sub?.id);
    // Child level nodes exist under the subloop's projected id.
    const childNodes = p.nodes.filter((x) => x.parentGraphId === sub?.id);
    assert.equal(childNodes.length, 3, 'three inline child nodes');
    // The child finish node carries the completion summary too (loop-level).
    assert.ok(p.graphLabels[sub!.id], 'child graph label registered');
    assert.equal(p.findings.length, 0);
  });

  await check(
    'referenced subloop becomes a leaf reference node (no crash, no inline level)',
    () => {
      const p = projectLoopGraph(referencedSubloopIR());
      const sub = p.nodes.find((x) => x.kind === 'subloop');
      assert.equal(sub?.referencedRevisionId, 'rev-xyz');
      assert.equal(sub?.childGraphId, undefined);
      // No phantom child level was created.
      const childNodes = p.nodes.filter((x) => x.parentGraphId === sub?.id);
      assert.equal(childNodes.length, 0);
      assert.equal(p.findings.length, 0);
    },
  );

  await check('invalid/dangling ids degrade gracefully (findings, no throw)', () => {
    let p: LoopGraphProjection | undefined;
    assert.doesNotThrow(() => {
      p = projectLoopGraph(danglingIR());
    });
    assert.ok(p, 'projection produced');
    const codes = findingCodes(p!);
    assert.ok(
      codes.includes('graph.dangling_edge'),
      `dangling finding present: ${codes.join(',')}`,
    );
    assert.ok(
      codes.includes('graph.duplicate_node_id'),
      `duplicate finding present: ${codes.join(',')}`,
    );
    // Both dangling edges dropped; only the two valid edges survive.
    assert.equal(p!.edges.length, 2, `surviving edges: ${p!.edges.map((x) => x.id).join(',')}`);
    // Duplicate node id collapsed to one.
    assert.equal(p!.nodes.filter((x) => x.localId === 'act').length, 1);
  });

  await check('root-named top-level node yields globally-unique edge ids (no silent dedup)', () => {
    const p = projectLoopGraph(rootNamedNodeIR());
    assert.equal(p.findings.length, 0, `unexpected findings: ${findingCodes(p).join(',')}`);
    const ids = p.edges.map((x) => x.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `duplicate edge ids: ${ids.join(', ')}`);
    // The top-level 'e1' and the child 'e1' must project to different ids.
    const topE1 = p.edges.find((x) => x.localId === 'e1' && x.parentGraphId === '');
    const childE1 = p.edges.find((x) => x.localId === 'e1' && x.parentGraphId === 'root');
    assert.ok(topE1, 'top-level e1 projected');
    assert.ok(childE1, 'child e1 projected');
    assert.notEqual(topE1!.id, childE1!.id, 'root-named child edge must not collide with top edge');
  });

  await check('retry summary includes nested subloop retries (no "No retry edges" lie)', () => {
    const p = projectLoopGraph(nestedRetryOnlyIR());
    // The retry lives ONLY inside the subloop; the inspector summary is loop-wide.
    const anyNode = p.nodes.find((x) => x.kind === 'finish')!;
    assert.match(
      anyNode.inspector.retrySummary,
      /retry edge/i,
      `nested retry must surface, got: "${anyNode.inspector.retrySummary}"`,
    );
    assert.match(anyNode.inspector.retrySummary, /max 4/, 'nested maxRetries reflected');
    assert.doesNotMatch(
      anyNode.inspector.retrySummary,
      /No retry edges/i,
      'must not claim zero retries',
    );
  });

  await check('expand/collapse selects only the visible subset for a level', () => {
    const p = projectLoopGraph(nestedInlineIR());
    const root = selectVisibleSubset(p, '');
    // Root level: start, subloop, finish.
    assert.equal(root.nodes.length, 3);
    const sub = p.nodes.find((x) => x.kind === 'subloop')!;
    const child = selectVisibleSubset(p, sub.id);
    assert.equal(child.nodes.length, 3, 'child level shows inner nodes only');
    // Collapsing the subloop hides its descendants at any deeper level.
    const collapsed = selectVisibleSubset(p, sub.id, new Set([sub.id]));
    assert.equal(collapsed.nodes.length, 0, 'collapsed subloop hides its children');
  });

  await check('drilldown/breadcrumb path is correct root → subloop', () => {
    const p = projectLoopGraph(nestedInlineIR());
    const sub = p.nodes.find((x) => x.kind === 'subloop')!;
    const trail = breadcrumbTrail(p, sub.id);
    assert.equal(trail.length, 2);
    assert.equal(trail[0].id, '');
    assert.equal(trail[0].label, 'Nested Inline');
    assert.equal(trail[1].id, sub.id);
    assert.equal(trail[1].label, 'Inner refinement');
  });

  // Frozen layout snapshot for the straight sequence. ELK + the fixed options
  // (layered / BRANDES_KOEPF / randomSeed 1 / stable input order) MUST reproduce
  // these exact positions. Any layout-determinism break (node sizing, seed,
  // option, ordering that ELK is sensitive to) shifts these and fails the case.
  const STRAIGHT_LAYOUT_SNAPSHOT = 'act@276,12|f@804,12|s@12,12|ver@540,12';

  await check(
    'STABLE layout: same IR → same node ids + positions (deterministic, snapshot)',
    async () => {
      const elk = makeElk();
      const ir = feedbackIR();
      const p1 = projectLoopGraph(ir);
      const p2 = projectLoopGraph(ir);
      const sub1 = selectVisibleSubset(p1, '');
      const sub2 = selectVisibleSubset(p2, '');
      const l1 = await layoutGraph(elk, sub1.nodes, sub1.edges);
      const l2 = await layoutGraph(elk, sub2.nodes, sub2.edges);
      const key1 = positionsKey(l1);
      const key2 = positionsKey(l2);
      assert.equal(key1, key2, `layout not deterministic:\n  ${key1}\n  ${key2}`);

      // Frozen-snapshot guard: a known graph must land on known coordinates.
      const straight = selectVisibleSubset(projectLoopGraph(straightIR()), '');
      const ls = await layoutGraph(elk, straight.nodes, straight.edges);
      assert.equal(
        positionsKey(ls),
        STRAIGHT_LAYOUT_SNAPSHOT,
        `layout drifted from frozen snapshot:\n  got      ${positionsKey(ls)}\n  expected ${STRAIGHT_LAYOUT_SNAPSHOT}`,
      );
      // Node id set identical and matches projection.
      assert.deepEqual(l1.nodes.map((x) => x.id).sort(), sub1.nodes.map((x) => x.id).sort());
    },
  );

  await check('STABLE layout: insertion order of nodes does not change positions', async () => {
    const elk = makeElk();
    const ir = straightIR();
    const shuffled = makeIR({
      title: ir.title,
      // Reverse the node order; the adapter + stable sort must absorb it.
      nodes: [...ir.nodes].reverse(),
      edges: ir.edges,
    });
    const a = selectVisibleSubset(projectLoopGraph(ir), '');
    const b = selectVisibleSubset(projectLoopGraph(shuffled), '');
    const la = await layoutGraph(elk, a.nodes, a.edges);
    const lb = await layoutGraph(elk, b.nodes, b.edges);
    assert.equal(positionsKey(la), positionsKey(lb), 'input order must not affect layout');
  });

  await check(
    'async cancellation (PRE-ELK guard): already-stale request never runs ELK',
    async () => {
      const elk = makeElk();
      const ir = feedbackIR();
      const sub = selectVisibleSubset(projectLoopGraph(ir), '');
      // Simulate a generation token bumped BEFORE layout starts: isCancelled is
      // already true on entry, so the pre-ELK guard short-circuits.
      let generation = 5;
      const requested = 5;
      const isCancelled = () => generation !== requested;
      generation = 6; // bumped before the call → pre-check fires
      let threw = false;
      try {
        await layoutGraph(elk, sub.nodes, sub.edges, {}, isCancelled);
      } catch (err) {
        threw = err instanceof LayoutCancelledError;
      }
      assert.ok(threw, 'pre-ELK guard throws LayoutCancelledError');
    },
  );

  await check(
    'async cancellation (POST-ELK guard): revision bumped DURING layout discards result',
    async () => {
      // A fake ELK that flips the generation token WHILE its layout() is awaited.
      // The request is current on entry (pre-check passes), so only the POST-ELK
      // guard can catch it — proving the guard after `await elk.layout()` works.
      let generation = 1;
      const requested = 1;
      const isCancelled = () => generation !== requested;
      const fakeElk: ElkLike = {
        async layout(graph) {
          // Bump the generation mid-flight (the revision changed during layout).
          generation = 2;
          return {
            width: 0,
            height: 0,
            children: (graph.children ?? []).map((c) => ({
              id: c.id,
              x: 0,
              y: 0,
              width: c.width,
              height: c.height,
            })),
            edges: [],
          };
        },
      };
      const ir = feedbackIR();
      const sub = selectVisibleSubset(projectLoopGraph(ir), '');
      let threw = false;
      try {
        await layoutGraph(fakeElk, sub.nodes, sub.edges, {}, isCancelled);
      } catch (err) {
        threw = err instanceof LayoutCancelledError;
      }
      assert.ok(
        threw,
        'post-ELK guard throws LayoutCancelledError when generation bumps during layout',
      );
    },
  );

  await check(
    'large graph (250 nodes / ~500 edges-ish) layout completes under budget',
    async () => {
      const elk = makeElk();
      const ir = largeIR(250);
      const p = projectLoopGraph(ir);
      // No findings on a well-formed large graph.
      assert.equal(p.findings.length, 0, `large graph findings: ${findingCodes(p).join(',')}`);
      assert.ok(p.nodes.length >= 250, `node count ${p.nodes.length}`);
      const sub = selectVisibleSubset(p, '');
      const start = process.hrtime.bigint();
      const laidOut = await layoutGraph(elk, sub.nodes, sub.edges);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      assert.equal(laidOut.nodes.length, sub.nodes.length, 'all nodes laid out');
      // Generous CI-safe ceiling; ELK layered on 250 nodes is well under this.
      assert.ok(elapsedMs < 8000, `layout took ${elapsedMs.toFixed(0)}ms (budget 8000ms)`);
    },
  );

  await check('keyboard / a11y label data present in the projection', () => {
    const p = projectLoopGraph(nestedInlineIR());
    for (const node of p.nodes) {
      assert.ok(node.a11yLabel.length > 0, `node ${node.id} has a11y label`);
    }
    const sub = p.nodes.find((x) => x.kind === 'subloop')!;
    assert.match(sub.a11yLabel, /open/i, 'subloop a11y label advertises enter affordance');
    assert.equal(p.counts.nodes, 3, 'current-level node count for SR summary');
    assert.equal(p.counts.edges, 2, 'current-level edge count for SR summary');
  });

  await check('direction adapts: narrow → DOWN, wide → RIGHT', () => {
    assert.equal(directionForWidth(600), 'DOWN');
    assert.equal(directionForWidth(1200), 'RIGHT');
  });

  await check('extra findings (validator passthrough) merge ahead of adapter findings', () => {
    const extra: LoopValidationFinding[] = [
      { code: 'validator.demo', message: 'from validator', severity: 'warning' },
    ];
    const p = projectLoopGraph(danglingIR(), extra);
    assert.equal(p.findings[0].code, 'validator.demo', 'caller findings come first');
    assert.ok(findingCodes(p).includes('graph.dangling_edge'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
