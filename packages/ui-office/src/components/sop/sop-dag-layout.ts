import type { SopDefinition, SopStep } from '@offisim/shared-types';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const DAG_LAYOUT = {
  nodeWidth: 280,
  nodeHeight: 140,
  columnGap: 120,
  rowGap: 32,
  padding: 40,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface DagNodeLayout {
  stepId: string;
  step: SopStep;
  x: number;
  y: number;
  width: number;
  height: number;
  batchIndex: number;
  inputPort: { x: number; y: number };
  outputPort: { x: number; y: number };
}

export interface DagEdgeLayout {
  fromStepId: string;
  toStepId: string;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
}

export interface DagLayout {
  nodes: DagNodeLayout[];
  edges: DagEdgeLayout[];
  totalWidth: number;
  totalHeight: number;
}

// ---------------------------------------------------------------------------
// getExecutionBatches — topological sort into parallel batches
// ---------------------------------------------------------------------------

export function getExecutionBatches(def: SopDefinition): SopStep[][] {
  const steps = [...def.steps];
  const completed = new Set<string>();
  const batches: SopStep[][] = [];

  while (completed.size < steps.length) {
    const batch: SopStep[] = [];
    for (const step of steps) {
      if (completed.has(step.step_id)) continue;
      if (step.dependencies.every((d) => completed.has(d))) {
        batch.push(step);
      }
    }
    if (batch.length === 0) break; // cycle detection
    for (const s of batch) completed.add(s.step_id);
    batches.push(batch);
  }
  return batches;
}

// ---------------------------------------------------------------------------
// computeAutoLayoutPositions — returns a map of stepId → {x, y}
// ---------------------------------------------------------------------------

export function computeAutoLayoutPositions(
  definition: SopDefinition,
): Map<string, { x: number; y: number }> {
  const { nodeWidth, nodeHeight, columnGap, rowGap, padding } = DAG_LAYOUT;
  const batches = getExecutionBatches(definition);
  const positions = new Map<string, { x: number; y: number }>();

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    // biome-ignore lint/style/noNonNullAssertion: array access within bounds
    const batch = batches[batchIdx]!;
    for (let rowIdx = 0; rowIdx < batch.length; rowIdx++) {
      // biome-ignore lint/style/noNonNullAssertion: array access within bounds
      const step = batch[rowIdx]!;
      positions.set(step.step_id, {
        x: padding + batchIdx * (nodeWidth + columnGap),
        y: padding + rowIdx * (nodeHeight + rowGap),
      });
    }
  }
  return positions;
}

// ---------------------------------------------------------------------------
// buildNodesFromPositions — shared node builder
// ---------------------------------------------------------------------------

function buildNodesFromPositions(
  definition: SopDefinition,
  positionMap: Map<string, { x: number; y: number }>,
  batchIndexMap: Map<string, number>,
): DagNodeLayout[] {
  const { nodeWidth, nodeHeight } = DAG_LAYOUT;
  const nodes: DagNodeLayout[] = [];

  for (const step of definition.steps) {
    const pos = positionMap.get(step.step_id);
    if (!pos) continue;
    const nx = pos.x;
    const ny = pos.y;
    nodes.push({
      stepId: step.step_id,
      step,
      x: nx,
      y: ny,
      width: nodeWidth,
      height: nodeHeight,
      batchIndex: batchIndexMap.get(step.step_id) ?? 0,
      inputPort: { x: nx, y: ny + nodeHeight / 2 },
      outputPort: { x: nx + nodeWidth, y: ny + nodeHeight / 2 },
    });
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// buildEdges — shared edge builder
// ---------------------------------------------------------------------------

function buildEdges(
  definition: SopDefinition,
  nodeMap: Map<string, DagNodeLayout>,
): DagEdgeLayout[] {
  const { nodeWidth, nodeHeight } = DAG_LAYOUT;
  const edges: DagEdgeLayout[] = [];

  for (const step of definition.steps) {
    const target = nodeMap.get(step.step_id);
    if (!target) continue;
    for (const depId of step.dependencies) {
      const source = nodeMap.get(depId);
      if (!source) continue;
      edges.push({
        fromStepId: depId,
        toStepId: step.step_id,
        fromPoint: {
          x: source.x + nodeWidth,
          y: source.y + nodeHeight / 2,
        },
        toPoint: {
          x: target.x,
          y: target.y + nodeHeight / 2,
        },
      });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// computeBounds — shared bounds calculation
// ---------------------------------------------------------------------------

function computeBounds(nodes: DagNodeLayout[]): { totalWidth: number; totalHeight: number } {
  const { nodeWidth, nodeHeight, padding } = DAG_LAYOUT;
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    const right = n.x + nodeWidth;
    const bottom = n.y + nodeHeight;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return {
    totalWidth: nodes.length > 0 ? maxX + padding : 0,
    totalHeight: nodes.length > 0 ? maxY + padding : 0,
  };
}

// ---------------------------------------------------------------------------
// computeDagLayout — pure function: SopDefinition → DagLayout
// ---------------------------------------------------------------------------

export function computeDagLayout(definition: SopDefinition): DagLayout {
  const batches = getExecutionBatches(definition);

  // Build batch index map (used for both branches)
  const batchIndexMap = new Map<string, number>();
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    // biome-ignore lint/style/noNonNullAssertion: array access within bounds
    for (const step of batches[batchIdx]!) {
      batchIndexMap.set(step.step_id, batchIdx);
    }
  }

  // Mixed-mode: use manual position when available, auto-layout for the rest
  const autoPositions = computeAutoLayoutPositions(definition);
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const step of definition.steps) {
    positionMap.set(
      step.step_id,
      step.position ?? autoPositions.get(step.step_id) ?? { x: 0, y: 0 },
    );
  }

  const nodes = buildNodesFromPositions(definition, positionMap, batchIndexMap);
  const nodeMap = new Map(nodes.map((n) => [n.stepId, n]));
  const edges = buildEdges(definition, nodeMap);
  const { totalWidth, totalHeight } = computeBounds(nodes);

  return { nodes, edges, totalWidth, totalHeight };
}
