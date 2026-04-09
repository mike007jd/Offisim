import { useState } from 'react';
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
  pending: { stroke: 'rgba(148,163,184,0.45)', width: 2 },
  active: { stroke: 'rgba(96,165,250,0.75)', width: 2.5 },
  completed: { stroke: 'rgba(52,211,153,0.6)', width: 2 },
  failed: { stroke: 'rgba(248,113,113,0.65)', width: 2 },
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

export function SopDagEdge({ edge, status, editMode, onDisconnect }: SopDagEdgeProps) {
  const d = buildBezierPath(edge.fromPoint, edge.toPoint);
  const { stroke, width } = STROKE_CONFIG[status];
  const [hovered, setHovered] = useState(false);

  const activeStroke = editMode && hovered ? 'rgba(248,113,113,0.7)' : stroke;
  const activeWidth = editMode && hovered ? 3 : width;

  return (
    <g>
      <path d={d} fill="none" stroke={activeStroke} strokeWidth={activeWidth} strokeLinecap="round" />
      {/* Wider invisible hit area for easier clicking in edit mode */}
      {editMode && onDisconnect && (
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
            fill="rgba(248,113,113,0.3)"
          />
          <text
            x={(edge.fromPoint.x + edge.toPoint.x) / 2}
            y={(edge.fromPoint.y + edge.toPoint.y) / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(248,113,113,0.9)"
            fontSize={12}
            fontWeight="bold"
          >
            ×
          </text>
        </>
      )}
      {status === 'active' && (
        <circle r={3} fill="rgba(96,165,250,0.8)">
          <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  );
}
