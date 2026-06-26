/**
 * Loop IR → graph projection (PR-09). PURE adapter: turns the business-truth
 * {@link LoopIR} into a {@link LoopGraphProjection} the React Flow view renders.
 *
 * Source-of-truth rule: `LoopIR` is the only business truth. This module NEVER
 * mutates the IR; it produces a derived, read-only projection. React Flow
 * `Node[]/Edge[]`, viewport, selection and expand/collapse are UI state computed
 * downstream from this projection — never persisted back to the revision.
 *
 * The projection is a FULL flattened model of every level (top graph + every
 * inline child graph), keyed by a deterministic, stable path id. The view picks
 * the visible subset per current drilldown level + collapse set; the full graph
 * always stays here so collapse/drilldown never loses information.
 *
 * Dangling / invalid ids degrade gracefully: the adapter records a finding and
 * drops the offending edge — it NEVER throws. Referenced-revision subloops
 * (`subloopRevisionId`, no inline child) are surfaced as leaf "reference" nodes
 * (the panel cannot resolve another revision without a loader; that is PR-08's
 * job), not as a crash.
 *
 * DOM-free and React-free so the harness can test it headlessly.
 */

import type {
  LoopIR,
  LoopNode,
  LoopNodeKind,
  LoopEdge,
  LoopEdgeKind,
  LoopChildGraph,
  LoopHumanGate,
  LoopSkillBindingRef,
  LoopValidationFinding,
} from '@offisim/shared-types';

// ---------------------------------------------------------------------------
// Projection types (pure adapter output)
// ---------------------------------------------------------------------------

/** A node in the flattened projection. `path` is the drilldown ancestry. */
export interface ProjectedNode {
  /** Deterministic, stable, globally-unique id: ancestry joined by '/'. */
  id: string;
  /** The original IR node id at this level (not globally unique on its own). */
  localId: string;
  kind: LoopNodeKind;
  label: string;
  description?: string;
  /** Drilldown ancestry of graph ids this node lives under (top level = []). */
  path: string[];
  /** The graph-level id this node belongs to (parent subloop projected id, or ''). */
  parentGraphId: string;
  /** subloop only: number of direct child nodes in the inline child graph. */
  childNodeCount?: number;
  /** subloop only: it references a saved revision instead of an inline graph. */
  referencedRevisionId?: string;
  /** subloop only: the projected graph id you drill into (only for inline). */
  childGraphId?: string;
  /** Inspector summary derived from the IR (read-only). */
  inspector: NodeInspector;
  /** Stable accessible label data for screen readers (no DOM needed to test). */
  a11yLabel: string;
}

/** An edge in the flattened projection. */
export interface ProjectedEdge {
  /** Deterministic id: `${parentGraphId}::${localId}`. */
  id: string;
  localId: string;
  /** Projected (globally-unique) source/target node ids. */
  source: string;
  target: string;
  /** Same-level graph id this edge belongs to. */
  parentGraphId: string;
  kind: LoopEdgeKind;
  label?: string;
  maxRetries?: number;
  /** True when from === to (self loop) — the view draws a self-loop affordance. */
  selfLoop: boolean;
}

/** Read-only inspector summary for a node, derived from the IR. */
export interface NodeInspector {
  kind: LoopNodeKind;
  label: string;
  instruction: string;
  inputs: string[];
  outputs: string[];
  /** Completion / gate summary line(s). */
  completion: string[];
  /** Human-gate prompt + reason, if this is a human_gate with a binding. */
  gate?: { prompt: string; reason: string };
  /** Skill ids bound on the loop (loop-level; shown on the inspector). */
  skills: string[];
  /** Retry / budget one-line summary. */
  retrySummary: string;
  budgetSummary: string;
}

/**
 * One drilldown level: the visible subset is computed by the view from this
 * (current path + collapse set). The projection itself is the FULL model.
 */
export interface LoopGraphProjection {
  /** Every node across every level, flat. */
  nodes: ProjectedNode[];
  /** Every edge across every level, flat. */
  edges: ProjectedEdge[];
  /** Quick lookup: projected graph id → direct child node ids (for collapse). */
  childrenByGraph: Record<string, string[]>;
  /** Adapter findings (dangling ids etc.) merged with any caller findings. */
  findings: LoopValidationFinding[];
  /** Top-level graph id (always '' = root). */
  rootGraphId: string;
  /** Breadcrumb labels keyed by projected graph id (root + each subloop). */
  graphLabels: Record<string, string>;
  /** Top-level node/edge counts (a11y: current level summary helper). */
  counts: { nodes: number; edges: number };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

function nodeKindWord(kind: LoopNodeKind): string {
  switch (kind) {
    case 'start':
      return 'Start';
    case 'finish':
      return 'Finish';
    case 'action':
      return 'Action';
    case 'decision':
      return 'Decision';
    case 'verify':
      return 'Verify';
    case 'human_gate':
      return 'Human gate';
    case 'subloop':
      return 'Subloop';
    default:
      return 'Node';
  }
}

function edgeKindWord(kind: LoopEdgeKind): string {
  switch (kind) {
    case 'next':
      return 'next';
    case 'feedback':
      return 'feedback';
    case 'retry':
      return 'retry';
    case 'escalate':
      return 'escalate';
    default:
      return 'edge';
  }
}

/** Deterministic projected id: ancestry path + local id, '/'-joined. */
function projectId(path: string[], localId: string): string {
  return [...path, localId].join('/');
}

/**
 * Sentinel for the root graph in COMPOSITE keys (edge ids). The root graph id is
 * '' internally, but '' can't appear in a composite id, so we substitute a token
 * that cannot collide with any user node id. Child graph ids are already
 * '/'-joined projected node ids (globally unique), so only the root needs this.
 */
const ROOT_GRAPH_SENTINEL = '__root__';

/** Map a graph id to its non-empty, collision-proof segment for composite ids. */
function graphIdSegment(graphId: string): string {
  return graphId === '' ? ROOT_GRAPH_SENTINEL : graphId;
}

function buildInspector(
  ir: LoopIR,
  node: LoopNode,
  gateByNodeId: Map<string, LoopHumanGate>,
  skillSummary: string[],
  retrySummary: string,
  budgetSummary: string,
): NodeInspector {
  const completion: string[] = [];
  // Completion contract is loop-level; surface it on the finish node so a reader
  // sees "how does this loop end" without leaving the inspector.
  if (node.kind === 'finish') {
    completion.push(`Outcome: ${ir.completion.outcome}`);
    for (const item of ir.completion.acceptance) {
      const req = item.required ? 'required' : 'optional';
      completion.push(`[${item.oracle}/${req}] ${item.description}`);
    }
    if (ir.completion.exitStates.length > 0) {
      completion.push(`Exit states: ${ir.completion.exitStates.join(', ')}`);
    }
  }
  const gate = gateByNodeId.get(node.id);
  return {
    kind: node.kind,
    label: node.label,
    instruction: node.description ?? '',
    inputs: ir.inputs.map((p) => `${p.label}${p.required ? '' : ' (optional)'}`),
    outputs: ir.outputs.map((p) => p.label),
    completion,
    gate: gate ? { prompt: gate.prompt, reason: gate.reason } : undefined,
    skills: skillSummary,
    retrySummary,
    budgetSummary,
  };
}

function a11yFor(node: LoopNode, childCount: number | undefined, referenced: string | undefined): string {
  const word = nodeKindWord(node.kind);
  if (node.kind === 'subloop') {
    if (referenced) {
      return `${word} ${node.label}, references saved revision`;
    }
    return `${word} ${node.label}, ${childCount ?? 0} child step${(childCount ?? 0) === 1 ? '' : 's'}, press Enter to open`;
  }
  return `${word} ${node.label}`;
}

/**
 * Recursively flatten one graph level into the projection. `path` is the
 * ancestry of projected graph ids; for the root it is `[]` and the graph id is ''.
 */
function flattenGraph(
  ir: LoopIR,
  graphId: string,
  path: string[],
  nodes: LoopNode[],
  edges: LoopEdge[],
  out: {
    nodes: ProjectedNode[];
    edges: ProjectedEdge[];
    childrenByGraph: Record<string, string[]>;
    graphLabels: Record<string, string>;
    findings: LoopValidationFinding[];
  },
  shared: {
    gateByNodeId: Map<string, LoopHumanGate>;
    skillSummary: string[];
    retrySummary: string;
    budgetSummary: string;
  },
): void {
  const localIds = new Set<string>();
  const childIds: string[] = [];

  for (const node of nodes) {
    if (localIds.has(node.id)) {
      out.findings.push({
        code: 'graph.duplicate_node_id',
        message: `Duplicate node id "${node.id}" in graph "${graphId || 'root'}"`,
        severity: 'error',
        ref: node.id,
      });
      continue;
    }
    localIds.add(node.id);

    const pid = projectId(path, node.id);
    childIds.push(pid);

    let childNodeCount: number | undefined;
    let referencedRevisionId: string | undefined;
    let childGraphId: string | undefined;

    if (node.kind === 'subloop') {
      const inline: LoopChildGraph | undefined = node.childGraph;
      if (inline) {
        childNodeCount = inline.nodes.length;
        childGraphId = pid; // the subloop node's projected id IS the child graph id
        // Defensive: a child graph id equal to the root sentinel would let its
        // edge ids collide with the root's. The sentinel is namespaced ('__root__')
        // precisely so a normal node id ('root') can't, but a node id LITERALLY
        // equal to the sentinel still must be surfaced, never silently merged.
        if (childGraphId === ROOT_GRAPH_SENTINEL) {
          out.findings.push({
            code: 'graph.reserved_node_id',
            message: `Node id "${ROOT_GRAPH_SENTINEL}" is reserved; its subloop edges may not project uniquely`,
            severity: 'error',
            ref: node.id,
          });
        }
        out.graphLabels[childGraphId] = node.label;
        // Recurse: the child graph's path is this node's projected ancestry.
        flattenGraph(ir, childGraphId, [...path, node.id], inline.nodes, inline.edges, out, shared);
      } else if (node.subloopRevisionId) {
        referencedRevisionId = node.subloopRevisionId;
      } else {
        out.findings.push({
          code: 'graph.subloop_empty',
          message: `Subloop "${node.id}" has neither an inline child graph nor a referenced revision`,
          severity: 'warning',
          ref: node.id,
        });
      }
    }

    out.nodes.push({
      id: pid,
      localId: node.id,
      kind: node.kind,
      label: node.label,
      description: node.description,
      path,
      parentGraphId: graphId,
      childNodeCount,
      referencedRevisionId,
      childGraphId,
      inspector: buildInspector(
        ir,
        node,
        shared.gateByNodeId,
        shared.skillSummary,
        shared.retrySummary,
        shared.budgetSummary,
      ),
      a11yLabel: a11yFor(node, childNodeCount, referencedRevisionId),
    });
  }

  out.childrenByGraph[graphId] = childIds;

  // Edges: drop any whose endpoints don't resolve at THIS level (graceful degrade).
  for (const edge of edges) {
    const fromOk = localIds.has(edge.from);
    const toOk = localIds.has(edge.to);
    if (!fromOk || !toOk) {
      out.findings.push({
        code: 'graph.dangling_edge',
        message: `Edge "${edge.id}" in graph "${graphId || 'root'}" references ${
          !fromOk ? `missing source "${edge.from}"` : `missing target "${edge.to}"`
        }; dropped from view`,
        severity: 'error',
        ref: edge.id,
      });
      continue;
    }
    out.edges.push({
      // Composite id MUST be globally unique. graphId is '' (root) or a '/'-joined
      // projected node id; the root sentinel '__root__' cannot be a user node id,
      // so a top-level node literally named 'root' can never collide here.
      id: `${graphIdSegment(graphId)}::${edge.id}`,
      localId: edge.id,
      source: projectId(path, edge.from),
      target: projectId(path, edge.to),
      parentGraphId: graphId,
      kind: edge.kind,
      label: edge.label ?? (edge.kind !== 'next' ? edgeKindWord(edge.kind) : undefined),
      maxRetries: edge.maxRetries,
      selfLoop: edge.from === edge.to,
    });
  }
}

/**
 * Project a {@link LoopIR} into a {@link LoopGraphProjection}. Pure, never throws,
 * never mutates `ir`. `extraFindings` (e.g. validator output passed through the
 * panel) are merged in front of adapter findings.
 */
export function projectLoopGraph(
  ir: LoopIR,
  extraFindings: LoopValidationFinding[] = [],
): LoopGraphProjection {
  const out = {
    nodes: [] as ProjectedNode[],
    edges: [] as ProjectedEdge[],
    childrenByGraph: {} as Record<string, string[]>,
    graphLabels: {} as Record<string, string>,
    findings: [...extraFindings] as LoopValidationFinding[],
  };

  const gateByNodeId = new Map<string, LoopHumanGate>();
  for (const gate of ir.humanGates) {
    gateByNodeId.set(gate.nodeId, gate);
  }

  const skillSummary = [...ir.skillBindings]
    .sort((a: LoopSkillBindingRef, b: LoopSkillBindingRef) => a.orderIndex - b.orderIndex)
    .map((b) => `${b.skillId}@${b.skillVersion}`);

  // Loop-wide retry summary: walk EVERY level (top graph + every inline child
  // graph), not just the top-level edges, so a retry living only inside a subloop
  // is still reflected — the inspector must not claim "No retry edges" when nested
  // retries exist.
  const retryEdges: number[] = [];
  const collectRetries = (nodes: LoopNode[], edges: LoopEdge[]) => {
    for (const e of edges) {
      if (e.kind === 'retry' && typeof e.maxRetries === 'number') retryEdges.push(e.maxRetries);
    }
    for (const node of nodes) {
      if (node.childGraph) collectRetries(node.childGraph.nodes, node.childGraph.edges);
    }
  };
  collectRetries(ir.nodes, ir.edges);
  const retrySummary =
    retryEdges.length === 0
      ? 'No retry edges'
      : `${retryEdges.length} retry edge${retryEdges.length === 1 ? '' : 's'}, max ${Math.max(...retryEdges)} attempt(s)`;

  const budgetSummary = ir.budget
    ? `Tier ${ir.budget.tier}: ≤${ir.budget.maxConcurrentAgents} concurrent / ≤${ir.budget.maxTotalAgents} total agents, depth ≤${ir.budget.maxRecursionDepth}, ${ir.budget.maxFixWavesPerGate} fix-waves/gate`
    : 'No budget declared';

  out.graphLabels[''] = ir.title;

  flattenGraph(ir, '', [], ir.nodes, ir.edges, out, {
    gateByNodeId,
    skillSummary,
    retrySummary,
    budgetSummary,
  });

  const rootChildren = out.childrenByGraph[''] ?? [];
  const rootEdges = out.edges.filter((e) => e.parentGraphId === '');

  return {
    nodes: out.nodes,
    edges: out.edges,
    childrenByGraph: out.childrenByGraph,
    findings: out.findings,
    rootGraphId: '',
    graphLabels: out.graphLabels,
    counts: { nodes: rootChildren.length, edges: rootEdges.length },
  };
}

// ---------------------------------------------------------------------------
// Visible-subset selection (UI state derivation; still pure + DOM-free)
// ---------------------------------------------------------------------------

/**
 * Given the full projection, the current drilldown graph id, and the set of
 * collapsed node ids, return only the nodes/edges visible at this level. The
 * full projection is unchanged; this is what the React Flow canvas renders.
 *
 * "Collapsed" hides a subloop's descendants — but since each level is a separate
 * graph id, collapse at the SAME level simply means: render the nodes of the
 * current graph; subloop nodes are always rendered as a single compact node
 * (their children live one drilldown deeper). The `collapsedIds` set lets a
 * future inline-compound rendering hide expanded children; in the flat-per-level
 * model it filters edges that would point into a collapsed compound.
 */
export function selectVisibleSubset(
  projection: LoopGraphProjection,
  currentGraphId: string,
  collapsedIds: ReadonlySet<string> = new Set(),
): { nodes: ProjectedNode[]; edges: ProjectedEdge[] } {
  const nodes = projection.nodes.filter(
    (n) => n.parentGraphId === currentGraphId && !isHiddenByCollapse(n, collapsedIds),
  );
  const visibleIds = new Set(nodes.map((n) => n.id));
  const edges = projection.edges.filter(
    (e) => e.parentGraphId === currentGraphId && visibleIds.has(e.source) && visibleIds.has(e.target),
  );
  return { nodes, edges };
}

function isHiddenByCollapse(node: ProjectedNode, collapsedIds: ReadonlySet<string>): boolean {
  // A node is hidden if any ancestor (by projected path) is collapsed.
  for (let i = 0; i < node.path.length; i += 1) {
    const ancestor = node.path.slice(0, i + 1).join('/');
    if (collapsedIds.has(ancestor)) return true;
  }
  return false;
}

/**
 * Breadcrumb trail for a drilldown path. `pathIds` is the list of projected
 * graph ids from root → current (root is '' and yields the IR title).
 */
export function breadcrumbTrail(
  projection: LoopGraphProjection,
  currentGraphId: string,
): { id: string; label: string }[] {
  const trail: { id: string; label: string }[] = [];
  // Root is always first.
  trail.push({ id: '', label: projection.graphLabels[''] ?? 'Loop' });
  if (currentGraphId === '') return trail;
  // currentGraphId is a projected node id; its path segments are ancestors.
  const segments = currentGraphId.split('/');
  let acc = '';
  for (const seg of segments) {
    acc = acc === '' ? seg : `${acc}/${seg}`;
    const label = projection.graphLabels[acc] ?? acc;
    trail.push({ id: acc, label });
  }
  return trail;
}
