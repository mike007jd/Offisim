/**
 * Custom React Flow node for the loop graph (PR-09). Pure VIEW: renders a
 * {@link ProjectedNode} using the shared visual grammar (icon + kind word +
 * shape class). NEVER edits the IR. Subloop nodes show a child-count badge and an
 * "Open" enter affordance; the panel wires double-click / Enter / Open to
 * drilldown. Accessibility: each node is a focusable element with the projection's
 * stable a11y label.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowRight } from 'lucide-react';
import { NODE_GRAMMAR } from './loop-graph-grammar.js';
import type { ProjectedNode } from './loop-graph-adapter.js';

export interface LoopGraphNodeData extends Record<string, unknown> {
  projected: ProjectedNode;
  selected: boolean;
  onOpenSubloop: (graphId: string) => void;
  /** Handle sides derived from the layout direction (LTR vs TTB). */
  sourcePosition?: Position;
  targetPosition?: Position;
}

export function LoopGraphNode({ data }: NodeProps) {
  const { projected, selected, sourcePosition, targetPosition } = data as unknown as LoopGraphNodeData;
  const grammar = NODE_GRAMMAR[projected.kind];
  const Icon = grammar.icon;
  const isSubloop = projected.kind === 'subloop';
  // Direction-aware handles: edges must exit/enter the side ELK laid out toward,
  // else DOWN (narrow) layout zigzags. Default to LTR (Left in / Right out).
  const targetSide = targetPosition ?? Position.Left;
  const sourceSide = sourcePosition ?? Position.Right;

  return (
    <div
      className={`off-loopnode off-loopnode--${grammar.shape}${selected ? ' off-loopnode--selected' : ''}`}
      data-kind={projected.kind}
    >
      <Handle type="target" position={targetSide} className="off-loopnode-handle" />
      <div className="off-loopnode-head">
        <Icon className="off-loopnode-icon" aria-hidden="true" />
        <span className="off-loopnode-kind">{grammar.kindWord}</span>
      </div>
      <div className="off-loopnode-label" title={projected.label}>
        {projected.label}
      </div>
      {isSubloop ? (
        <div className="off-loopnode-subfoot">
          {projected.referencedRevisionId ? (
            <span className="off-loopnode-ref">Saved revision</span>
          ) : (
            <span className="off-loopnode-count">
              {projected.childNodeCount ?? 0} step{(projected.childNodeCount ?? 0) === 1 ? '' : 's'}
            </span>
          )}
          {projected.childGraphId ? (
            <button
              type="button"
              className="off-loopnode-open"
              onClick={(event) => {
                event.stopPropagation();
                (data as unknown as LoopGraphNodeData).onOpenSubloop(projected.childGraphId!);
              }}
            >
              Open
              <ArrowRight className="off-loopnode-open-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={sourceSide} className="off-loopnode-handle" />
    </div>
  );
}
