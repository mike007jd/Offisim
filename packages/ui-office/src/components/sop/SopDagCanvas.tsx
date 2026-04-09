import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { SopDagEdge, buildBezierPath } from './SopDagEdge';
import { SopDagNode } from './SopDagNode';
import type { DagLayout, SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopDagCanvasProps {
  layout: DagLayout;
  runtimeState: SopRuntimeStepState[] | null;
  selectedStepId: string | null;
  onStepClick: (stepId: string) => void;
  stepIds: string[];
  editMode?: boolean;
  onAddDependency?: (fromStepId: string, toStepId: string) => void;
  onRemoveDependency?: (fromStepId: string, toStepId: string) => void;
  onDeleteStep?: (stepId: string) => void;
  onAddStep?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function handlePortKeyDown(
  event: ReactKeyboardEvent<SVGGElement>,
  action: () => void,
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.stopPropagation();
    action();
  }
}

// ---------------------------------------------------------------------------
// SopDagCanvas
// ---------------------------------------------------------------------------

export function SopDagCanvas({
  layout,
  runtimeState,
  selectedStepId,
  onStepClick,
  stepIds,
  editMode,
  onAddDependency,
  onRemoveDependency,
  onDeleteStep,
  onAddStep,
}: SopDagCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Drag-to-connect state
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Build runtime status map: stepIndex → status (memoized to avoid rebuild on mousemove)
  const statusMap = useMemo(() => {
    const map = new Map<string, SopStepStatus>();
    if (runtimeState) {
      for (const rs of runtimeState) {
        const id = stepIds[rs.stepIndex];
        if (id) map.set(id, rs.status);
      }
    }
    return map;
  }, [runtimeState, stepIds]);

  const getStatus = (stepId: string): SopStepStatus => statusMap.get(stepId) ?? 'pending';
  const getEdgeStatus = (fromStepId: string): SopStepStatus =>
    statusMap.get(fromStepId) ?? 'pending';

  // --- Fit to view ---
  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.totalWidth === 0 || layout.totalHeight === 0) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const sx = cw / layout.totalWidth;
    const sy = ch / layout.totalHeight;
    const s = clamp(Math.min(sx, sy) * 0.95, 0.25, 2);
    const tx = (cw - layout.totalWidth * s) / 2;
    const ty = (ch - layout.totalHeight * s) / 2;
    setScale(s);
    setTranslate({ x: tx, y: ty });
  }, [layout.totalWidth, layout.totalHeight]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitToView());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToView]);

  // --- Wheel zoom ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = clamp(scale * factor, 0.25, 2);
      const ratio = newScale / scale;
      setScale(newScale);
      setTranslate({
        x: mx - ratio * (mx - translate.x),
        y: my - ratio * (my - translate.y),
      });
    },
    [scale, translate],
  );

  // --- Drag pan (only when not connecting) ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || connectingFrom) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    },
    [translate, connectingFrom],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (connectingFrom) {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMousePos({
          x: (e.clientX - rect.left - translate.x) / scale,
          y: (e.clientY - rect.top - translate.y) / scale,
        });
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
    },
    [dragging, connectingFrom, translate, scale],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    if (connectingFrom) {
      setConnectingFrom(null);
    }
  }, [connectingFrom]);

  // --- Port drag start ---
  const handlePortDragStart = useCallback((stepId: string) => {
    setConnectingFrom(stepId);
  }, []);

  // --- Port drop (target node) ---
  const handlePortDrop = useCallback(
    (targetStepId: string) => {
      if (!connectingFrom || connectingFrom === targetStepId) {
        setConnectingFrom(null);
        return;
      }
      onAddDependency?.(connectingFrom, targetStepId);
      setConnectingFrom(null);
    },
    [connectingFrom, onAddDependency],
  );

  // --- Escape cancels connecting ---
  useEffect(() => {
    if (!connectingFrom) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnectingFrom(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connectingFrom]);

  // Compute the temporary connection line from source output port to mouse
  const connectingLine = connectingFrom
    ? (() => {
        const sourceNode = layout.nodes.find((n) => n.stepId === connectingFrom);
        if (!sourceNode) return null;
        return buildBezierPath(sourceNode.outputPort, mousePos);
      })()
    : null;

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden relative ${connectingFrom ? 'cursor-crosshair' : dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg width="100%" height="100%" role="img" aria-label="SOP workflow DAG">
        <title>SOP workflow DAG</title>
        {/* Dot grid background — moves with pan/zoom */}
        <defs>
          <pattern
            id="sop-dot-grid"
            x={translate.x}
            y={translate.y}
            width={20 * scale}
            height={20 * scale}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={1 * scale} cy={1 * scale} r={1 * scale} fill="rgba(255,255,255,0.05)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sop-dot-grid)" pointerEvents="none" />
        <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
          {/* Edges */}
          {layout.edges.map((edge) => (
            <SopDagEdge
              key={`${edge.fromStepId}-${edge.toStepId}`}
              edge={edge}
              status={getEdgeStatus(edge.fromStepId)}
              editMode={editMode}
              onDisconnect={onRemoveDependency}
            />
          ))}
          {/* Temporary connecting line */}
          {connectingLine && (
            <path
              d={connectingLine}
              fill="none"
              stroke="rgba(251,191,36,0.5)"
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
          )}
          {/* Nodes via foreignObject */}
          {layout.nodes.map((node) => (
            <foreignObject
              key={node.stepId}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
            >
              <SopDagNode
                step={node.step}
                status={getStatus(node.stepId)}
                selected={selectedStepId === node.stepId}
                editMode={editMode}
                onClick={() => onStepClick(node.stepId)}
                onDelete={onDeleteStep}
              />
            </foreignObject>
          ))}
          {editMode &&
            layout.nodes.map((node) => (
              <g key={`${node.stepId}-ports`}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Connect dependency into ${node.step.label}`}
                  className="cursor-crosshair"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseUp={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePortDrop(node.stepId);
                  }}
                  onKeyDown={(e) =>
                    handlePortKeyDown(e, () => {
                      handlePortDrop(node.stepId);
                    })
                  }
                >
                  <circle
                    cx={node.inputPort.x}
                    cy={node.inputPort.y}
                    r={11}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={8}
                  />
                  <circle
                    cx={node.inputPort.x}
                    cy={node.inputPort.y}
                    r={7}
                    fill="rgba(15,23,42,0.98)"
                    stroke="rgba(34,211,238,0.9)"
                    strokeWidth={2.5}
                  />
                </g>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Create dependency from ${node.step.label}`}
                  className="cursor-crosshair"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePortDragStart(node.stepId);
                  }}
                  onKeyDown={(e) =>
                    handlePortKeyDown(e, () => {
                      handlePortDragStart(node.stepId);
                    })
                  }
                >
                  <circle
                    cx={node.outputPort.x}
                    cy={node.outputPort.y}
                    r={11}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={8}
                  />
                  <circle
                    cx={node.outputPort.x}
                    cy={node.outputPort.y}
                    r={7}
                    fill="rgba(15,23,42,0.98)"
                    stroke="rgba(251,191,36,0.95)"
                    strokeWidth={2.5}
                  />
                </g>
              </g>
            ))}
        </g>
      </svg>

      {/* Add step button (edit mode) */}
      {editMode && onAddStep && (
        <button
          type="button"
          onClick={onAddStep}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-100 backdrop-blur-sm transition hover:bg-cyan-500/25"
        >
          <Plus className="h-4 w-4" />
          Add Step
        </button>
      )}
    </div>
  );
}
