/**
 * Custom React Flow edge for the loop graph (PR-09). Renders the IR edge kind
 * with a distinct LINE pattern + badge (not color alone): next = solid, feedback
 * = emphasized loop-back with label, retry = dashed with retry badge, escalate =
 * warning style. Pure VIEW over the projected edge data.
 */

import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import type { ProjectedEdge } from './loop-graph-adapter.js';
import { EDGE_GRAMMAR } from './loop-graph-grammar.js';

interface LoopGraphEdgeData extends Record<string, unknown> {
  projected: ProjectedEdge;
}

export function LoopGraphEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const projected = (data as unknown as LoopGraphEdgeData | undefined)?.projected;
  const kind = projected?.kind ?? 'next';
  const grammar = EDGE_GRAMMAR[kind];
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const dash = grammar.line === 'dashed' ? '6 4' : undefined;
  const badgeText = projected?.label ?? grammar.defaultLabel;
  const BadgeIcon = grammar.icon;

  return (
    <>
      <BaseEdge
        id={projected?.id}
        path={path}
        markerEnd={markerEnd}
        style={{
          strokeDasharray: dash,
          strokeWidth: grammar.emphasized ? 2 : 1.5,
        }}
        className={`off-loopedge off-loopedge--${kind}`}
      />
      {badgeText ? (
        <EdgeLabelRenderer>
          <div
            className={`off-loopedge-badge off-loopedge-badge--${kind}${
              grammar.severity === 'warn' ? ' off-loopedge-badge--warn' : ''
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {BadgeIcon ? (
              <BadgeIcon className="off-loopedge-badge-icon" aria-hidden="true" />
            ) : null}
            <span>{badgeText}</span>
            {kind === 'retry' && typeof projected?.maxRetries === 'number' ? (
              <span className="off-loopedge-badge-count">×{projected.maxRetries}</span>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
