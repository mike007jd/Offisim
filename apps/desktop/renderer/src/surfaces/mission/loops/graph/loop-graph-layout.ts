/**
 * Deterministic ELK layout for the visible subset (PR-09). Pure-ish: given a set
 * of projected nodes + edges for ONE drilldown level, compute positions via ELK's
 * `layered` algorithm with orthogonal edge routing and a FIXED random seed so the
 * same input yields the same positions (no jitter on re-render).
 *
 * Layout runs on an async, CANCELABLE path: each call carries a generation token;
 * the caller bumps the token when the revision / level changes and ignores stale
 * results. ELK itself runs worker-less here (the harness uses the node bundle;
 * the renderer uses the same constructor). Positions are cached by the caller in
 * memory only — NEVER written back to the revision.
 *
 * DOM-free and React-free: the harness imports `layoutGraph` directly with the
 * node ELK bundle and asserts deterministic positions headlessly.
 */

import type { ProjectedEdge, ProjectedNode } from './loop-graph-adapter.js';

/** A laid-out node: projected node + absolute position + measured size. */
export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutGraph {
  nodes: LaidOutNode[];
  /** ELK-routed edge bend points, keyed by projected edge id (orthogonal). */
  edgeSections: Record<string, { x: number; y: number }[]>;
  /** Overall content bounds (for fit-view bookkeeping). */
  width: number;
  height: number;
}

export type LayoutDirection = 'RIGHT' | 'DOWN';

export interface LayoutOptions {
  /** 'RIGHT' = left-to-right (default), 'DOWN' = top-to-bottom (narrow windows). */
  direction?: LayoutDirection;
  /** Per-node measured width (defaults to a stable card width). */
  nodeWidth?: number;
  nodeHeight?: number;
}

/**
 * Minimal structural typing for the ELK constructor — both `elkjs` (browser) and
 * `elkjs/lib/elk.bundled.js` (node) export a default class with this shape. We do
 * not import a concrete `ELK` value here so the harness can inject the node
 * bundle and the renderer can inject the browser build without a hard coupling.
 */
export interface ElkLike {
  layout(graph: ElkGraphInput): Promise<ElkGraphOutput>;
}

interface ElkGraphInput {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: {
    id: string;
    width: number;
    height: number;
    layoutOptions?: Record<string, string>;
  }[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
}

interface ElkGraphOutput {
  width?: number;
  height?: number;
  children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
  edges?: {
    id: string;
    sections?: {
      startPoint: { x: number; y: number };
      endPoint: { x: number; y: number };
      bendPoints?: { x: number; y: number }[];
    }[];
  }[];
}

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 64;

/**
 * Fixed ELK options. The deterministic knobs are the point: a fixed `randomSeed`,
 * the layered algorithm, BRANDES_KOEPF node placement (stable, no randomized
 * tie-breaking), and orthogonal edge routing. No option here is time- or
 * Math.random-derived.
 */
function elkLayoutOptions(direction: LayoutDirection): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.randomSeed': '1',
    'elk.layered.spacing.nodeNodeBetweenLayers': '64',
    'elk.spacing.nodeNode': '40',
    'elk.spacing.edgeNode': '24',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  };
}

/** Thrown internally to signal a stale/cancelled layout (never surfaced to UI). */
export class LayoutCancelledError extends Error {
  constructor() {
    super('layout cancelled');
    this.name = 'LayoutCancelledError';
  }
}

/**
 * Stable input ordering. ELK is deterministic for a given input, but the INPUT
 * order must itself be stable, so we sort nodes + edges by their deterministic
 * ids before handing them to ELK. Same IR → same order → same positions.
 */
function stableSortNodes(nodes: ProjectedNode[]): ProjectedNode[] {
  return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function stableSortEdges(edges: ProjectedEdge[]): ProjectedEdge[] {
  return [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Run ELK layout for one level. `isCancelled` is polled before and after the
 * async ELK call so a rapidly-changing revision discards stale work. Throws
 * {@link LayoutCancelledError} when cancelled (callers swallow it).
 */
export async function layoutGraph(
  elk: ElkLike,
  nodes: ProjectedNode[],
  edges: ProjectedEdge[],
  options: LayoutOptions = {},
  isCancelled: () => boolean = () => false,
): Promise<LaidOutGraph> {
  if (isCancelled()) throw new LayoutCancelledError();

  const direction = options.direction ?? 'RIGHT';
  const nodeWidth = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;

  const orderedNodes = stableSortNodes(nodes);
  const orderedEdges = stableSortEdges(edges);

  // Self loops can't be expressed as ELK edges between two distinct nodes; we
  // keep them out of the ELK graph (the view draws a self-loop affordance) but
  // never drop them from the projection.
  const elkEdges = orderedEdges.filter((e) => !e.selfLoop);

  const input: ElkGraphInput = {
    id: 'root',
    layoutOptions: elkLayoutOptions(direction),
    children: orderedNodes.map((n) => ({
      id: n.id,
      // subloop compound nodes are a touch taller to carry the child-count badge.
      width: nodeWidth,
      height: n.kind === 'subloop' ? nodeHeight + 16 : nodeHeight,
    })),
    edges: elkEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const result = await elk.layout(input);

  if (isCancelled()) throw new LayoutCancelledError();

  const laidOutNodes: LaidOutNode[] = (result.children ?? []).map((c) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? nodeWidth,
    height: c.height ?? nodeHeight,
  }));

  const edgeSections: Record<string, { x: number; y: number }[]> = {};
  for (const e of result.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    edgeSections[e.id] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
  }

  return {
    nodes: laidOutNodes,
    edgeSections,
    width: result.width ?? 0,
    height: result.height ?? 0,
  };
}

/**
 * Pick the layout direction from the available width. Narrow windows lay out
 * top-to-bottom so the LTR card chain does not overflow horizontally.
 */
export function directionForWidth(availableWidth: number): LayoutDirection {
  return availableWidth < 720 ? 'DOWN' : 'RIGHT';
}
