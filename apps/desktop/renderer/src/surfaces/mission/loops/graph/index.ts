/**
 * Public surface of the loop graph (PR-09). PR-08 integrates ONLY through
 * `LoopGraphPanel` + its props type, plus the pure adapter for non-canvas reads.
 * React Flow internals, layout, and node/edge components are NOT part of the
 * public contract.
 */

export { LoopGraphPanel } from './LoopGraphPanel.js';
export type { LoopGraphPanelProps, LoopGraphPanelState } from './LoopGraphPanel.js';
export { projectLoopGraph, selectVisibleSubset, breadcrumbTrail } from './loop-graph-adapter.js';
export type {
  LoopGraphProjection,
  ProjectedNode,
  ProjectedEdge,
  NodeInspector,
} from './loop-graph-adapter.js';
