/**
 * Generic LoopIR validator (PR-07). Deterministic, pure, harness-tested. Two
 * layers:
 *   1. structural / JSON-schema shape (every required field present + typed);
 *   2. semantic graph rules — dangling node/edge ids, legal entry/exit, no
 *      unreachable node, no unbounded retry, bounded inline nesting, subloop refs
 *      resolve, completion reachable, budget legal.
 *
 * The validator NEVER throws on bad input: a malformed value yields an `error`
 * finding, not a crash. `validateLoopIR` returns `{ ok, findings }`; `ok` is true
 * only when there are zero `error` findings (warnings are allowed in a ready IR).
 */

import type {
  LoopBudgetContract,
  LoopChildGraph,
  LoopEdge,
  LoopIR,
  LoopNode,
  LoopValidation,
  LoopValidationFinding,
} from '@offisim/shared-types';
import { LOOP_LIMITS } from './types.js';

const NODE_KINDS = new Set([
  'start',
  'action',
  'decision',
  'verify',
  'human_gate',
  'subloop',
  'finish',
]);
const EDGE_KINDS = new Set(['next', 'feedback', 'retry', 'escalate']);

function err(code: string, message: string, ref?: string): LoopValidationFinding {
  return ref !== undefined
    ? { code, message, severity: 'error', ref }
    : { code, message, severity: 'error' };
}

function warn(code: string, message: string, ref?: string): LoopValidationFinding {
  return ref !== undefined
    ? { code, message, severity: 'warning', ref }
    : { code, message, severity: 'warning' };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate the top-level IR shape (defensive — the IR is built in-process but may
 * have been round-tripped through JSON / a model draft). Pushes structural errors;
 * returns false when the shape is too broken to run graph checks.
 */
function validateShape(ir: unknown, findings: LoopValidationFinding[]): ir is LoopIR {
  if (!isObject(ir)) {
    findings.push(err('ir.not_object', 'IR is not an object'));
    return false;
  }
  let ok = true;
  if (ir.schemaVersion !== '1') {
    findings.push(
      err('ir.schema_version', `schemaVersion must be '1', got ${String(ir.schemaVersion)}`),
    );
    ok = false;
  }
  for (const key of ['title', 'outcome'] as const) {
    if (typeof ir[key] !== 'string' || (ir[key] as string).length === 0) {
      findings.push(err(`ir.${key}`, `${key} must be a non-empty string`));
      ok = false;
    }
  }
  for (const key of [
    'inputs',
    'outputs',
    'parameters',
    'nodes',
    'edges',
    'humanGates',
    'skillBindings',
  ] as const) {
    if (!Array.isArray(ir[key])) {
      findings.push(err(`ir.${key}`, `${key} must be an array`));
      ok = false;
    }
  }
  if (!isObject(ir.completion)) {
    findings.push(err('ir.completion', 'completion must be an object'));
    ok = false;
  }
  if (!isObject(ir.metadata)) {
    findings.push(err('ir.metadata', 'metadata must be an object'));
    ok = false;
  }
  return ok;
}

/** Recursively collect every node kind/id from a graph (top-level + inline children). */
function walkGraph(
  nodes: LoopNode[],
  edges: LoopEdge[],
  depth: number,
  findings: LoopValidationFinding[],
): void {
  if (depth > LOOP_LIMITS.maxSubloopDepth) {
    findings.push(
      err('graph.too_deep', `inline subloop nesting exceeds ${LOOP_LIMITS.maxSubloopDepth}`),
    );
    return;
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!isObject(node) || typeof node.id !== 'string' || node.id.length === 0) {
      findings.push(err('node.id', 'a node is missing a string id'));
      continue;
    }
    if (nodeIds.has(node.id)) {
      findings.push(err('node.duplicate_id', `duplicate node id ${node.id}`, node.id));
    }
    nodeIds.add(node.id);
    if (!NODE_KINDS.has(node.kind)) {
      findings.push(
        err('node.kind', `node ${node.id} has illegal kind ${String(node.kind)}`, node.id),
      );
    }
    // subloop: exactly one of childGraph | subloopRevisionId.
    if (node.kind === 'subloop') {
      const hasChild = isObject(node.childGraph);
      const hasRef =
        typeof node.subloopRevisionId === 'string' && node.subloopRevisionId.length > 0;
      if (hasChild === hasRef) {
        findings.push(
          err(
            'subloop.ref',
            `subloop node ${node.id} must reference exactly one of childGraph or subloopRevisionId`,
            node.id,
          ),
        );
      }
      if (hasChild) {
        const child = node.childGraph as LoopChildGraph;
        if (!Array.isArray(child.nodes) || !Array.isArray(child.edges)) {
          findings.push(
            err('subloop.child_shape', `subloop node ${node.id} child graph is malformed`, node.id),
          );
        } else {
          walkGraph(child.nodes, child.edges, depth + 1, findings);
        }
      }
    } else if (node.childGraph !== undefined || node.subloopRevisionId !== undefined) {
      findings.push(
        err(
          'node.subloop_only',
          `node ${node.id} carries subloop fields but is kind ${node.kind}`,
          node.id,
        ),
      );
    }
  }

  // Edge id resolution + retry bound.
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!isObject(edge) || typeof edge.id !== 'string' || edge.id.length === 0) {
      findings.push(err('edge.id', 'an edge is missing a string id'));
      continue;
    }
    if (edgeIds.has(edge.id)) {
      findings.push(err('edge.duplicate_id', `duplicate edge id ${edge.id}`, edge.id));
    }
    edgeIds.add(edge.id);
    if (!EDGE_KINDS.has(edge.kind)) {
      findings.push(
        err('edge.kind', `edge ${edge.id} has illegal kind ${String(edge.kind)}`, edge.id),
      );
    }
    if (typeof edge.from !== 'string' || !nodeIds.has(edge.from)) {
      findings.push(
        err(
          'edge.dangling_from',
          `edge ${edge.id} from ${String(edge.from)} references no node`,
          edge.id,
        ),
      );
    }
    if (typeof edge.to !== 'string' || !nodeIds.has(edge.to)) {
      findings.push(
        err(
          'edge.dangling_to',
          `edge ${edge.id} to ${String(edge.to)} references no node`,
          edge.id,
        ),
      );
    }
    // Unbounded retry is illegal — a retry edge must declare a positive bound.
    if (edge.kind === 'retry') {
      const max = edge.maxRetries;
      if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
        findings.push(
          err(
            'edge.unbounded_retry',
            `retry edge ${edge.id} must declare a positive maxRetries`,
            edge.id,
          ),
        );
      }
    }
  }
}

/** Reachability + entry/exit checks over the TOP-LEVEL graph only. */
function validateTopology(ir: LoopIR, findings: LoopValidationFinding[]): void {
  const nodes = ir.nodes;
  const edges = ir.edges;
  if (nodes.length > LOOP_LIMITS.maxNodes) {
    findings.push(
      err('graph.too_many_nodes', `node count ${nodes.length} exceeds ${LOOP_LIMITS.maxNodes}`),
    );
  }
  if (edges.length > LOOP_LIMITS.maxEdges) {
    findings.push(
      err('graph.too_many_edges', `edge count ${edges.length} exceeds ${LOOP_LIMITS.maxEdges}`),
    );
  }

  const starts = nodes.filter((n) => n.kind === 'start');
  const finishes = nodes.filter((n) => n.kind === 'finish');
  if (starts.length !== 1) {
    findings.push(
      err('graph.entry', `IR must have exactly one start node (found ${starts.length})`),
    );
  }
  if (finishes.length < 1) {
    findings.push(err('graph.exit', 'IR must have at least one finish node'));
  }

  const start = starts[0];
  // A start node must have no incoming edge; a finish node must have no outgoing.
  for (const e of edges) {
    if (start && e.to === start.id) {
      findings.push(
        err('graph.entry_inbound', `start node ${start.id} must have no inbound edge`, e.id),
      );
    }
    if (finishes.some((f) => f.id === e.from)) {
      findings.push(
        err('graph.exit_outbound', `finish node ${e.from} must have no outbound edge`, e.id),
      );
    }
  }

  // Reachability from start (forward, over all edge kinds). This runs REGARDLESS
  // of any dangling edge: an unrelated dangling endpoint must not suppress the
  // orphan/unreachable report. Adjacency is built only from edges whose BOTH
  // endpoints resolve to a real node, so a dangling edge contributes nothing to
  // the BFS but is still reported separately by walkGraph. A node that is itself
  // the `to` of a dangling edge is excluded from the unreachable report (it is
  // already covered by the edge.dangling_to finding — no double-report).
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  // Endpoints of any dangling edge (a `to` that names no node), used to avoid
  // double-reporting. (`from` danglers don't add a node id to suppress.)
  const danglingToTargets = new Set<string>();
  for (const e of edges) {
    if (typeof e.to === 'string' && !nodeIdSet.has(e.to)) danglingToTargets.add(e.to);
  }
  if (start) {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      // Only edges with both endpoints present participate in reachability.
      if (typeof e.from !== 'string' || typeof e.to !== 'string') continue;
      if (!nodeIdSet.has(e.from) || !nodeIdSet.has(e.to)) continue;
      const list = adj.get(e.from) ?? [];
      list.push(e.to);
      adj.set(e.from, list);
    }
    const seen = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const n of nodes) {
      // A node that is the `to` of a dangling edge is already reported by
      // edge.dangling_to; skip it here so the same defect is not double-counted.
      if (!seen.has(n.id) && !danglingToTargets.has(n.id)) {
        findings.push(err('graph.unreachable', `node ${n.id} is unreachable from start`, n.id));
      }
    }
    // Completion reachable: at least one finish node must be reachable.
    if (finishes.length > 0 && !finishes.some((f) => seen.has(f.id))) {
      findings.push(err('graph.completion_unreachable', 'no finish node is reachable from start'));
    }
  }
}

/** Completion contract + budget legality. */
function validateContracts(ir: LoopIR, findings: LoopValidationFinding[]): void {
  const c = ir.completion;
  if (isObject(c)) {
    if (typeof c.outcome !== 'string' || c.outcome.length === 0) {
      findings.push(err('completion.outcome', 'completion.outcome must be a non-empty string'));
    }
    if (!Array.isArray(c.acceptance) || c.acceptance.length === 0) {
      findings.push(
        err('completion.acceptance', 'completion must declare at least one acceptance item'),
      );
    } else {
      const requiredCount = c.acceptance.filter((a) => isObject(a) && a.required === true).length;
      if (requiredCount === 0) {
        findings.push(
          err(
            'completion.no_required',
            'completion must have at least one REQUIRED acceptance item',
          ),
        );
      }
      for (const a of c.acceptance) {
        if (!isObject(a)) {
          findings.push(err('completion.item', 'an acceptance item is not an object'));
          continue;
        }
        if (
          a.oracle === 'deterministic' &&
          (typeof a.evaluatorId !== 'string' || a.evaluatorId.length === 0)
        ) {
          findings.push(
            warn(
              'completion.deterministic_no_evaluator',
              `acceptance ${String(a.id)} is deterministic but names no evaluator — will become a human gate`,
              typeof a.id === 'string' ? a.id : undefined,
            ),
          );
        }
      }
    }
    if (!Array.isArray(c.exitStates) || c.exitStates.length === 0) {
      findings.push(
        err('completion.exit_states', 'completion must declare at least one exit state'),
      );
    }
  }

  if (ir.budget !== undefined) {
    validateBudget(ir.budget, findings);
  }

  // Human gates must reference a node of kind human_gate.
  const gateNodeIds = new Set(ir.nodes.filter((n) => n.kind === 'human_gate').map((n) => n.id));
  for (const g of ir.humanGates) {
    if (!isObject(g)) {
      findings.push(err('human_gate.shape', 'a human gate is not an object'));
      continue;
    }
    if (typeof g.nodeId !== 'string' || !gateNodeIds.has(g.nodeId)) {
      findings.push(
        err(
          'human_gate.ref',
          `human gate ${String(g.id)} references no human_gate node`,
          typeof g.id === 'string' ? g.id : undefined,
        ),
      );
    }
  }
}

function validateBudget(budget: LoopBudgetContract, findings: LoopValidationFinding[]): void {
  if (!isObject(budget)) {
    findings.push(err('budget.shape', 'budget is not an object'));
    return;
  }
  if (!['light', 'standard', 'aggressive'].includes(budget.tier as string)) {
    findings.push(err('budget.tier', `illegal budget tier ${String(budget.tier)}`));
  }
  const positives: Array<keyof LoopBudgetContract> = [
    'maxConcurrentAgents',
    'maxTotalAgents',
    'maxRecursionDepth',
    'maxFixWavesPerGate',
  ];
  for (const key of positives) {
    const v = budget[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      findings.push(err(`budget.${key}`, `budget.${key} must be a positive number`));
    }
  }
  if (typeof budget.maxConcurrentAgents === 'number' && typeof budget.maxTotalAgents === 'number') {
    if (budget.maxConcurrentAgents > budget.maxTotalAgents) {
      findings.push(
        err('budget.concurrency', 'maxConcurrentAgents must not exceed maxTotalAgents'),
      );
    }
  }
}

/**
 * The public validator. Runs structural → graph → topology → contracts. `ok` is
 * true only when there are zero `error` findings.
 */
export function validateLoopIR(ir: unknown): LoopValidation {
  const findings: LoopValidationFinding[] = [];
  if (!validateShape(ir, findings)) {
    return { ok: false, findings };
  }
  const typed = ir as LoopIR;
  walkGraph(typed.nodes, typed.edges, 0, findings);
  validateTopology(typed, findings);
  validateContracts(typed, findings);
  const ok = !findings.some((f) => f.severity === 'error');
  return { ok, findings };
}
