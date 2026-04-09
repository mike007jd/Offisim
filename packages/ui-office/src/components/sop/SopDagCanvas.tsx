import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { SopDagEdge, buildBezierPath } from './SopDagEdge';
import { SopDagNode } from './SopDagNode';
import type { DagLayout, DagNodeLayout, SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 5; // px radius before treating as drag
const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

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
  onMoveStep?: (stepId: string, x: number, y: number) => void;
  onContextMenu?: (stepId: string, screenX: number, screenY: number) => void;
  onDoubleClickCanvas?: (
    canvasX: number,
    canvasY: number,
    screenX: number,
    screenY: number,
  ) => void;
  onDoubleClickNode?: (stepId: string, screenX: number, screenY: number) => void;
}

// ---------------------------------------------------------------------------
// InteractionMode — ref-based to avoid stale closures
// ---------------------------------------------------------------------------

type InteractionMode =
  | { type: 'idle' }
  | { type: 'panning'; startX: number; startY: number; startTx: number; startTy: number }
  | {
      type: 'node-drag-pending';
      stepId: string;
      startX: number;
      startY: number;
      nodeX: number;
      nodeY: number;
      pointerId: number;
    }
  | {
      type: 'node-dragging';
      stepId: string;
      startX: number;
      startY: number;
      nodeX: number;
      nodeY: number;
      pointerId: number;
    }
  | { type: 'connecting'; fromStepId: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function handlePortKeyDown(event: React.KeyboardEvent<SVGGElement>, action: () => void): void {
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
  onAddStep,
  onMoveStep,
  onContextMenu: onContextMenuProp,
  onDoubleClickCanvas,
  onDoubleClickNode,
}: SopDagCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  // Ref-based interaction mode (avoids stale closure issues)
  const modeRef = useRef<InteractionMode>({ type: 'idle' });
  // Force re-render trigger for connecting line
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Node offset during drag (single-node, optimistic UI)
  const [dragOffset, setDragOffset] = useState<{
    stepId: string;
    dx: number;
    dy: number;
  } | null>(null);

  // Click guard — prevent click firing after drag
  const clickGuardRef = useRef(false);

  // Refs for current transform (avoids stale closures in pointer handlers)
  const scaleRef = useRef(scale);
  const translateRef = useRef(translate);
  scaleRef.current = scale;
  translateRef.current = translate;

  // Build runtime status map
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
    const s = clamp(Math.min(sx, sy) * 0.95, MIN_SCALE, MAX_SCALE);
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
      const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = newScale / scale;
      setScale(newScale);
      setTranslate({
        x: mx - ratio * (mx - translate.x),
        y: my - ratio * (my - translate.y),
      });
    },
    [scale, translate],
  );

  // --- Pointer handlers (unified mouse/touch) ---

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const mode = modeRef.current;
    if (mode.type !== 'idle') return;
    // Canvas pan
    modeRef.current = {
      type: 'panning',
      startX: e.clientX,
      startY: e.clientY,
      startTx: translateRef.current.x,
      startTy: translateRef.current.y,
    };
  }, []);

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, node: DagNodeLayout) => {
      if (e.button !== 0 || !editMode) return;
      e.stopPropagation();
      e.preventDefault();

      modeRef.current = {
        type: 'node-drag-pending',
        stepId: node.stepId,
        startX: e.clientX,
        startY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
        pointerId: e.pointerId,
      };

      // Capture pointer for reliable drag tracking
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [editMode],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const mode = modeRef.current;

    if (mode.type === 'connecting') {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMousePos({
        x: (e.clientX - rect.left - translateRef.current.x) / scaleRef.current,
        y: (e.clientY - rect.top - translateRef.current.y) / scaleRef.current,
      });
      return;
    }

    if (mode.type === 'node-drag-pending') {
      const dx = e.clientX - mode.startX;
      const dy = e.clientY - mode.startY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        modeRef.current = { ...mode, type: 'node-dragging' };
        // Compute offset in canvas coords
        const cdx = dx / scaleRef.current;
        const cdy = dy / scaleRef.current;
        setDragOffset({ stepId: mode.stepId, dx: cdx, dy: cdy });
      }
      return;
    }

    if (mode.type === 'node-dragging') {
      const dx = e.clientX - mode.startX;
      const dy = e.clientY - mode.startY;
      const cdx = dx / scaleRef.current;
      const cdy = dy / scaleRef.current;
      setDragOffset({ stepId: mode.stepId, dx: cdx, dy: cdy });
      return;
    }

    if (mode.type === 'panning') {
      const dx = e.clientX - mode.startX;
      const dy = e.clientY - mode.startY;
      setTranslate({ x: mode.startTx + dx, y: mode.startTy + dy });
      return;
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const mode = modeRef.current;

      if (mode.type === 'node-dragging') {
        // Commit final position
        const dx = e.clientX - mode.startX;
        const dy = e.clientY - mode.startY;
        const finalX = Math.round(mode.nodeX + dx / scaleRef.current);
        const finalY = Math.round(mode.nodeY + dy / scaleRef.current);
        onMoveStep?.(mode.stepId, finalX, finalY);
        setDragOffset(null);
        clickGuardRef.current = true;
        modeRef.current = { type: 'idle' };
        try {
          (e.target as Element).releasePointerCapture(mode.pointerId);
        } catch {
          // Pointer capture may already be released
        }
        return;
      }

      if (mode.type === 'node-drag-pending') {
        // Did not exceed threshold → treat as click
        modeRef.current = { type: 'idle' };
        onStepClick(mode.stepId);
        try {
          (e.target as Element).releasePointerCapture(mode.pointerId);
        } catch {
          // Pointer capture may already be released
        }
        return;
      }

      if (mode.type === 'panning') {
        modeRef.current = { type: 'idle' };
        return;
      }

      if (mode.type === 'connecting') {
        setConnectingFrom(null);
        modeRef.current = { type: 'idle' };
        return;
      }
    },
    [onMoveStep, onStepClick],
  );

  // --- Port drag start ---
  const handlePortDragStart = useCallback((stepId: string) => {
    modeRef.current = { type: 'connecting', fromStepId: stepId };
    setConnectingFrom(stepId);
  }, []);

  // --- Port drop (target node) ---
  const handlePortDrop = useCallback(
    (targetStepId: string) => {
      if (!connectingFrom || connectingFrom === targetStepId) {
        setConnectingFrom(null);
        modeRef.current = { type: 'idle' };
        return;
      }
      onAddDependency?.(connectingFrom, targetStepId);
      setConnectingFrom(null);
      modeRef.current = { type: 'idle' };
    },
    [connectingFrom, onAddDependency],
  );

  // --- Escape cancels connecting ---
  useEffect(() => {
    if (!connectingFrom) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConnectingFrom(null);
        modeRef.current = { type: 'idle' };
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connectingFrom]);

  // --- Node click handler with guard ---
  const handleNodeClick = useCallback(
    (stepId: string) => {
      if (clickGuardRef.current) {
        clickGuardRef.current = false;
        return;
      }
      if (!editMode) {
        onStepClick(stepId);
      }
      // In edit mode, click on node is handled via pointer-up on drag-rect
    },
    [editMode, onStepClick],
  );

  // --- Context menu on node ---
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, stepId: string) => {
      if (!editMode) return;
      e.preventDefault();
      e.stopPropagation();
      onContextMenuProp?.(stepId, e.clientX, e.clientY);
    },
    [editMode, onContextMenuProp],
  );

  // --- Double-click on canvas blank ---
  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editMode) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const canvasX = Math.round(
        (e.clientX - rect.left - translateRef.current.x) / scaleRef.current,
      );
      const canvasY = Math.round(
        (e.clientY - rect.top - translateRef.current.y) / scaleRef.current,
      );
      onDoubleClickCanvas?.(canvasX, canvasY, e.clientX, e.clientY);
    },
    [editMode, onDoubleClickCanvas],
  );

  // --- Double-click on node ---
  const handleNodeDoubleClick = useCallback(
    (e: React.MouseEvent, stepId: string) => {
      if (!editMode) return;
      e.stopPropagation();
      onDoubleClickNode?.(stepId, e.clientX, e.clientY);
    },
    [editMode, onDoubleClickNode],
  );

  // --- Compute adjusted edges during drag ---
  const adjustedEdges = useMemo(() => {
    if (!dragOffset) return layout.edges;
    return layout.edges.map((edge) => {
      if (edge.fromStepId === dragOffset.stepId) {
        return {
          ...edge,
          fromPoint: {
            x: edge.fromPoint.x + dragOffset.dx,
            y: edge.fromPoint.y + dragOffset.dy,
          },
        };
      }
      if (edge.toStepId === dragOffset.stepId) {
        return {
          ...edge,
          toPoint: {
            x: edge.toPoint.x + dragOffset.dx,
            y: edge.toPoint.y + dragOffset.dy,
          },
        };
      }
      return edge;
    });
  }, [layout.edges, dragOffset]);

  // Connecting line from source output port to mouse
  const connectingLine = connectingFrom
    ? (() => {
        const sourceNode = layout.nodes.find((n) => n.stepId === connectingFrom);
        if (!sourceNode) return null;
        return buildBezierPath(sourceNode.outputPort, mousePos);
      })()
    : null;

  // Helper to get effective node position (with drag offset)
  const getNodePos = (node: DagNodeLayout) => {
    if (dragOffset && dragOffset.stepId === node.stepId) {
      return { x: node.x + dragOffset.dx, y: node.y + dragOffset.dy };
    }
    return { x: node.x, y: node.y };
  };

  const cursorClass = connectingFrom
    ? 'cursor-crosshair'
    : modeRef.current.type === 'panning' || modeRef.current.type === 'node-dragging'
      ? 'cursor-grabbing'
      : 'cursor-grab';

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden relative ${cursorClass}`}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleCanvasDoubleClick}
    >
      <svg width="100%" height="100%" role="img" aria-label="SOP workflow DAG">
        <title>SOP workflow DAG</title>
        {/* Dot grid background */}
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
          {adjustedEdges.map((edge) => (
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
          {layout.nodes.map((node) => {
            const pos = getNodePos(node);
            return (
              <foreignObject
                key={node.stepId}
                x={pos.x}
                y={pos.y}
                width={node.width}
                height={node.height}
                style={
                  editMode && dragOffset?.stepId === node.stepId
                    ? { pointerEvents: 'none' as const }
                    : undefined
                }
              >
                <SopDagNode
                  step={node.step}
                  status={getStatus(node.stepId)}
                  selected={selectedStepId === node.stepId}
                  editMode={editMode}
                  onStepClick={handleNodeClick}
                />
              </foreignObject>
            );
          })}
          {/* Edit mode: transparent drag rects over nodes */}
          {editMode &&
            layout.nodes.map((node) => {
              const pos = getNodePos(node);
              return (
                <rect
                  key={`${node.stepId}-drag`}
                  x={pos.x}
                  y={pos.y}
                  width={node.width}
                  height={node.height}
                  fill="transparent"
                  className="cursor-move"
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.stepId)}
                  onDoubleClick={(e) => handleNodeDoubleClick(e, node.stepId)}
                />
              );
            })}
          {/* Edit mode: port circles */}
          {editMode &&
            layout.nodes.map((node) => {
              const pos = getNodePos(node);
              const ipx = pos.x;
              const ipy = pos.y + node.height / 2;
              const opx = pos.x + node.width;
              const opy = pos.y + node.height / 2;
              return (
                <g key={`${node.stepId}-ports`}>
                  {/* Input port (connection target) */}
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG group cannot be button */}
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Connect dependency into ${node.step.label}`}
                    className="cursor-crosshair"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerUp={(e) => {
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
                      cx={ipx}
                      cy={ipy}
                      r={11}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={8}
                    />
                    <circle
                      cx={ipx}
                      cy={ipy}
                      r={7}
                      fill="rgba(15,23,42,0.98)"
                      stroke="rgba(34,211,238,0.9)"
                      strokeWidth={2.5}
                    />
                  </g>
                  {/* Output port (connection source) */}
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG group cannot be button */}
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Create dependency from ${node.step.label}`}
                    className="cursor-crosshair"
                    onPointerDown={(e) => {
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
                      cx={opx}
                      cy={opy}
                      r={11}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={8}
                    />
                    <circle
                      cx={opx}
                      cy={opy}
                      r={7}
                      fill="rgba(15,23,42,0.98)"
                      stroke="rgba(251,191,36,0.95)"
                      strokeWidth={2.5}
                    />
                  </g>
                </g>
              );
            })}
        </g>
      </svg>

      {/* Add step button (edit mode) */}
      {editMode && onAddStep && (
        <button
          type="button"
          onClick={() => {
            const el = containerRef.current;
            if (!el) return onAddStep();
            const rect = el.getBoundingClientRect();
            const canvasX = Math.round(
              (rect.width / 2 - translateRef.current.x) / scaleRef.current,
            );
            const canvasY = Math.round(
              (rect.height / 2 - translateRef.current.y) / scaleRef.current,
            );
            onDoubleClickCanvas?.(
              canvasX,
              canvasY,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
          }}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-100 backdrop-blur-sm transition hover:bg-cyan-500/25"
        >
          <Plus className="h-4 w-4" />
          Add Step
        </button>
      )}
    </div>
  );
}
