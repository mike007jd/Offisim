import { memo, useState } from 'react';
import type { DagEdgeLayout, SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Bezier path builder
// ---------------------------------------------------------------------------

export function buildBezierPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = (to.x - from.x) * 0.4;
  return `M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`;
}

// ---------------------------------------------------------------------------
// Status-based stroke config
// ---------------------------------------------------------------------------

const STROKE_CONFIG: Record<SopStepStatus, { stroke: string; width: number }> = {
  pending: { stroke: 'var(--color-border-default-val)', width: 2 },
  active: { stroke: 'var(--color-info-val)', width: 2.5 },
  completed: { stroke: 'var(--color-success-val)', width: 2 },
  failed: { stroke: 'var(--color-error-val)', width: 2 },
};

// ---------------------------------------------------------------------------
// SopDagEdge
// ---------------------------------------------------------------------------

export interface SopDagEdgeProps {
  edge: DagEdgeLayout;
  status: SopStepStatus;
  editMode?: boolean;
  onDisconnect?: (fromStepId: string, toStepId: string) => void;
}

export const SopDagEdge = memo(function SopDagEdge({
  edge,
  status,
  editMode,
  onDisconnect,
}: SopDagEdgeProps) {
  const d = buildBezierPath(edge.fromPoint, edge.toPoint);
  const { stroke, width } = STROKE_CONFIG[status];
  const [hovered, setHovered] = useState(false);

  const activeStroke = editMode && hovered ? 'var(--color-error-val)' : stroke;
  const activeWidth = editMode && hovered ? 3 : width;

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={activeStroke}
        strokeWidth={activeWidth}
        strokeLinecap="round"
      />
      {/* Wider invisible hit area for easier clicking in edit mode */}
      {editMode && onDisconnect && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: SVG path cannot have keyboard events
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          strokeLinecap="round"
          className="cursor-pointer"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            onDisconnect(edge.fromStepId, edge.toStepId);
          }}
        />
      )}
      {/* Disconnect × indicator at midpoint */}
      {editMode && hovered && (
        <>
          <circle
            cx={(edge.fromPoint.x + edge.toPoint.x) / 2}
            cy={(edge.fromPoint.y + edge.toPoint.y) / 2}
            r={8}
            fill="var(--color-error-muted-val)"
          />
          <text
            x={(edge.fromPoint.x + edge.toPoint.x) / 2}
            y={(edge.fromPoint.y + edge.toPoint.y) / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-error-val)"
            fontSize={12}
            fontWeight="bold"
          >
            ×
          </text>
        </>
      )}
      {status === 'active' && (
        <circle r={3} fill="var(--color-info-val)">
          <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  );
});
