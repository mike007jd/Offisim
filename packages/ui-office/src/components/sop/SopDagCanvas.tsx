import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { SopDagEdge, buildBezierPath } from './SopDagEdge';
import { SopDagNode } from './SopDagNode';
import {
  type DagLayout,
  type DagNodeLayout,
  type SopStepStatus,
  findInputPortAtPoint,
} from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 5; // px radius before treating as drag
const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

const INPUT_PORT_STROKE = 'var(--accent)';
const INPUT_PORT_REJECT_STROKE = 'var(--danger)';
const OUTPUT_PORT_STROKE = 'var(--warn)';
const PORT_FILL = 'var(--surface-1)';

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
  onMoveStep?: (stepId: string, x: number, y: number) => void;
  /** Bumped by an external Add Step trigger (e.g. toolbar). Opens the
   * add-step popover at canvas centre, with proper canvas-coord translation. */
  addStepRequestToken?: number;
  onContextMenu?: (stepId: string, screenX: number, screenY: number) => void;
  onDoubleClickCanvas?: (
    canvasX: number,
    canvasY: number,
    screenX: number,
    screenY: number,
  ) => void;
  onDoubleClickNode?: (stepId: string, screenX: number, screenY: number) => void;
  /**
   * Predicate for live drag preview. Returns true when (fromId → toId) is a
   * valid dependency (no cycle, no self). Optional — when omitted all drops
   * are accepted (legacy behavior).
   */
  canConnect?: (fromStepId: string, toStepId: string) => boolean;
  /**
   * Set of `role_slug` values that have no employee in the active company.
   * Forwarded to each `SopDagNode` so the missing-role chip is reactive.
   */
  missingRoleSet?: ReadonlySet<string>;
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

function handlePortKeyDown(event: React.KeyboardEvent<SVGElement>, action: () => void): void {
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
  onMoveStep,
  addStepRequestToken,
  onContextMenu: onContextMenuProp,
  onDoubleClickCanvas,
  onDoubleClickNode,
  canConnect,
  missingRoleSet,
}: SopDagCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  // Ref-based interaction mode (avoids stale closure issues)
  const modeRef = useRef<InteractionMode>({ type: 'idle' });
  // Force re-render trigger for connecting line
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const [hoveredInputStepId, setHoveredInputStepId] = useState<string | null>(null);
  const [hoveredOutputStepId, setHoveredOutputStepId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

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

  useEffect(() => {
    if (!addStepRequestToken || !onDoubleClickCanvas) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const canvasX = Math.round((rect.width / 2 - translateRef.current.x) / scaleRef.current);
    const canvasY = Math.round((rect.height / 2 - translateRef.current.y) / scaleRef.current);
    onDoubleClickCanvas(canvasX, canvasY, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [addStepRequestToken, onDoubleClickCanvas]);

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
  // Edge inherits its upstream step's status, with one exception: an edge whose
  // upstream is 'failed' is short-circuited to 'failed' so the downstream stops
  // animating and renders red. Implementation note: identical to passing
  // `getStatus(fromStepId)` through, since the upstream failure case lands on
  // 'failed' either way — the helper exists for spec readability.
  const getEdgeStatus = (fromStepId: string): SopStepStatus => {
    const upstream = statusMap.get(fromStepId) ?? 'pending';
    if (upstream === 'failed') return 'failed';
    return upstream;
  };

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
    e.preventDefault();
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

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const mode = modeRef.current;

      if (mode.type === 'connecting') {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const nextMousePos = {
          x: (e.clientX - rect.left - translateRef.current.x) / scaleRef.current,
          y: (e.clientY - rect.top - translateRef.current.y) / scaleRef.current,
        };
        setMousePos(nextMousePos);
        const next = findInputPortAtPoint(layout.nodes, nextMousePos);
        setHoveredInputStepId((prev) => (prev === next ? prev : next));
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
    },
    [layout.nodes],
  );

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
        const rect = containerRef.current?.getBoundingClientRect();
        const pointerCanvasPos = rect
          ? {
              x: (e.clientX - rect.left - translateRef.current.x) / scaleRef.current,
              y: (e.clientY - rect.top - translateRef.current.y) / scaleRef.current,
            }
          : null;
        const pointerTargetStepId =
          hoveredInputStepId ??
          (pointerCanvasPos ? findInputPortAtPoint(layout.nodes, pointerCanvasPos) : null);
        if (
          pointerTargetStepId &&
          pointerTargetStepId !== mode.fromStepId &&
          (!canConnect || canConnect(mode.fromStepId, pointerTargetStepId))
        ) {
          onAddDependency?.(mode.fromStepId, pointerTargetStepId);
        }
        setConnectingFrom(null);
        setHoveredInputStepId(null);
        setHoveredOutputStepId(null);
        modeRef.current = { type: 'idle' };
        return;
      }
    },
    [onMoveStep, onStepClick, hoveredInputStepId, layout.nodes, canConnect, onAddDependency],
  );

  // --- Port drag start ---
  const handlePortDragStart = useCallback((stepId: string, e?: React.PointerEvent<SVGElement>) => {
    if (e) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setMousePos({
          x: (e.clientX - rect.left - translateRef.current.x) / scaleRef.current,
          y: (e.clientY - rect.top - translateRef.current.y) / scaleRef.current,
        });
      }
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort; coordinate hit-testing is the source of truth.
      }
    }
    modeRef.current = { type: 'connecting', fromStepId: stepId };
    setConnectingFrom(stepId);
    setHoveredOutputStepId(stepId);
  }, []);

  // --- Port drop (target node) ---
  const handlePortDrop = useCallback(
    (targetStepId: string) => {
      const resetState = () => {
        setConnectingFrom(null);
        setHoveredInputStepId(null);
        setHoveredOutputStepId(null);
        modeRef.current = { type: 'idle' };
      };
      if (!connectingFrom || connectingFrom === targetStepId) {
        resetState();
        return;
      }
      // Live cycle highlight already messaged the user — silently abort.
      if (canConnect && !canConnect(connectingFrom, targetStepId)) {
        resetState();
        return;
      }
      onAddDependency?.(connectingFrom, targetStepId);
      resetState();
    },
    [connectingFrom, canConnect, onAddDependency],
  );

  // --- Escape cancels connecting ---
  useEffect(() => {
    if (!connectingFrom) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConnectingFrom(null);
        setHoveredInputStepId(null);
        setHoveredOutputStepId(null);
        modeRef.current = { type: 'idle' };
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connectingFrom]);

  useEffect(() => {
    if (!connectingFrom) return;
    const handleWindowPointerUp = (e: PointerEvent) => {
      if (modeRef.current.type !== 'connecting') return;
      const rect = containerRef.current?.getBoundingClientRect();
      const pointerCanvasPos = rect
        ? {
            x: (e.clientX - rect.left - translateRef.current.x) / scaleRef.current,
            y: (e.clientY - rect.top - translateRef.current.y) / scaleRef.current,
          }
        : null;
      const targetStepId =
        hoveredInputStepId ??
        (pointerCanvasPos ? findInputPortAtPoint(layout.nodes, pointerCanvasPos) : null);

      if (
        targetStepId &&
        targetStepId !== connectingFrom &&
        (!canConnect || canConnect(connectingFrom, targetStepId))
      ) {
        onAddDependency?.(connectingFrom, targetStepId);
      }
      setConnectingFrom(null);
      setHoveredInputStepId(null);
      setHoveredOutputStepId(null);
      modeRef.current = { type: 'idle' };
    };

    window.addEventListener('pointerup', handleWindowPointerUp, true);
    return () => window.removeEventListener('pointerup', handleWindowPointerUp, true);
  }, [connectingFrom, hoveredInputStepId, layout.nodes, canConnect, onAddDependency]);

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

  const graphTransform = `translate(${translate.x}, ${translate.y}) scale(${scale})`;
  const graphCssTransform = `translate(${translate.x}px, ${translate.y}px) scale(${scale})`;
  const graphLayerStyle: CSSProperties = {
    width: layout.totalWidth,
    height: layout.totalHeight,
    transform: graphCssTransform,
    transformOrigin: '0 0',
    pointerEvents: editMode ? 'none' : 'auto',
    willChange: 'transform',
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden relative select-none ${cursorClass}`}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleCanvasDoubleClick}
    >
      <svg
        className="absolute inset-0"
        width="100%"
        height="100%"
        role="img"
        aria-label="SOP workflow DAG"
        pointerEvents="none"
      >
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
            <circle cx={1 * scale} cy={1 * scale} r={1 * scale} fill="var(--line)" opacity={0.38} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sop-dot-grid)" pointerEvents="none" />
        <g transform={graphTransform} pointerEvents="none">
          {/* Edges */}
          {adjustedEdges.map((edge) => (
            <SopDagEdge
              key={`${edge.fromStepId}-${edge.toStepId}`}
              edge={edge}
              status={getEdgeStatus(edge.fromStepId)}
            />
          ))}
          {/* Temporary connecting line */}
          {connectingLine && (
            <path
              d={connectingLine}
              fill="none"
              stroke="var(--warn)"
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
          )}
        </g>
      </svg>

      <div
        className="absolute left-0 top-0"
        // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
        style={graphLayerStyle}
      >
        {layout.nodes.map((node) => {
          const pos = getNodePos(node);
          const nodeStyle = {
            left: pos.x,
            top: pos.y,
            width: node.width,
            height: node.height,
          };
          return (
            <div
              key={node.stepId}
              className="absolute"
              // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
              style={nodeStyle}
            >
              <SopDagNode
                step={node.step}
                status={getStatus(node.stepId)}
                selected={selectedStepId === node.stepId}
                editMode={editMode}
                onStepClick={handleNodeClick}
                roleMissing={missingRoleSet?.has(node.step.role_slug) ?? false}
              />
            </div>
          );
        })}
      </div>

      <svg
        className="absolute inset-0"
        width="100%"
        height="100%"
        aria-hidden={editMode ? undefined : true}
        pointerEvents={editMode ? 'auto' : 'none'}
      >
        <title>SOP dependency canvas</title>
        <g transform={graphTransform}>
          {/* Edge disconnect hit areas live above the HTML node layer without
              owning blank-canvas pointer events. */}
          {editMode &&
            onRemoveDependency &&
            adjustedEdges.map((edge) => {
              const edgeKey = `${edge.fromStepId}-${edge.toStepId}`;
              const d = buildBezierPath(edge.fromPoint, edge.toPoint);
              const hovered = hoveredEdgeKey === edgeKey;
              return (
                <g key={`${edgeKey}-interaction`}>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: SVG path cannot have keyboard events */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                    onMouseLeave={() => setHoveredEdgeKey(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveDependency(edge.fromStepId, edge.toStepId);
                    }}
                  />
                  {hovered && (
                    <>
                      <circle
                        cx={(edge.fromPoint.x + edge.toPoint.x) / 2}
                        cy={(edge.fromPoint.y + edge.toPoint.y) / 2}
                        r={8}
                        fill="var(--danger-surface)"
                        pointerEvents="none"
                      />
                      <text
                        x={(edge.fromPoint.x + edge.toPoint.x) / 2}
                        y={(edge.fromPoint.y + edge.toPoint.y) / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="var(--danger)"
                        fontSize={12}
                        fontWeight="bold"
                        pointerEvents="none"
                      >
                        ×
                      </text>
                    </>
                  )}
                </g>
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
                  pointerEvents="all"
                  className="cursor-move"
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.stepId)}
                  onDoubleClick={(e) => handleNodeDoubleClick(e, node.stepId)}
                />
              );
            })}
          {/* Port circles — always rendered, opacity-gated outside edit mode */}
          {layout.nodes.map((node) => {
            const pos = getNodePos(node);
            const ipx = pos.x;
            const ipy = pos.y + node.height / 2;
            const opx = pos.x + node.width;
            const opy = pos.y + node.height / 2;
            const portsInteractive = editMode === true;
            const portGroupClass = portsInteractive
              ? 'opacity-100'
              : 'opacity-40 pointer-events-none';
            const isHoveredRejection =
              portsInteractive &&
              connectingFrom !== null &&
              hoveredInputStepId === node.stepId &&
              connectingFrom !== node.stepId &&
              canConnect !== undefined &&
              !canConnect(connectingFrom, node.stepId);
            const isHoveredAccept =
              portsInteractive &&
              connectingFrom !== null &&
              hoveredInputStepId === node.stepId &&
              connectingFrom !== node.stepId &&
              !isHoveredRejection;
            const inputStroke = isHoveredRejection
              ? INPUT_PORT_REJECT_STROKE
              : isHoveredAccept
                ? OUTPUT_PORT_STROKE
                : INPUT_PORT_STROKE;
            const outputHovered =
              portsInteractive &&
              (hoveredOutputStepId === node.stepId || connectingFrom === node.stepId);
            return (
              <g
                key={`${node.stepId}-ports`}
                className={portGroupClass}
                pointerEvents={portsInteractive ? undefined : 'none'}
              >
                {/* Input port hit area + visual. Pointer handler sits on the
                    painted hit circle directly — putting it on the parent <g>
                    relies on event bubbling through SVG groups which Tauri /
                    WebKit drops for transparent-fill children. */}
                <circle
                  cx={ipx}
                  cy={ipy}
                  r={11}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={8}
                  pointerEvents="all"
                  className={portsInteractive ? 'cursor-crosshair' : undefined}
                  aria-label={`Connect dependency into ${node.step.label}`}
                  tabIndex={portsInteractive ? 0 : -1}
                  onPointerEnter={() => {
                    if (portsInteractive && connectingFrom) {
                      setHoveredInputStepId(node.stepId);
                    }
                  }}
                  onPointerLeave={() => {
                    if (portsInteractive && hoveredInputStepId === node.stepId) {
                      setHoveredInputStepId(null);
                    }
                  }}
                  onPointerDown={(e) => {
                    if (!portsInteractive) return;
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onKeyDown={(e) =>
                    handlePortKeyDown(e, () => {
                      if (!portsInteractive) return;
                      handlePortDrop(node.stepId);
                    })
                  }
                />
                <circle
                  cx={ipx}
                  cy={ipy}
                  r={isHoveredAccept || isHoveredRejection ? 8.5 : 7}
                  fill={PORT_FILL}
                  stroke={inputStroke}
                  strokeWidth={isHoveredAccept || isHoveredRejection ? 3.5 : 2.5}
                  pointerEvents="none"
                />
                {/* Output port (connection source) */}
                <circle
                  cx={opx}
                  cy={opy}
                  r={11}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={8}
                  pointerEvents="all"
                  className={portsInteractive ? 'cursor-crosshair' : undefined}
                  aria-label={`Create dependency from ${node.step.label}`}
                  tabIndex={portsInteractive ? 0 : -1}
                  onPointerEnter={() => {
                    if (portsInteractive) setHoveredOutputStepId(node.stepId);
                  }}
                  onPointerLeave={() => {
                    if (portsInteractive && connectingFrom !== node.stepId) {
                      setHoveredOutputStepId(null);
                    }
                  }}
                  onPointerDown={(e) => {
                    if (!portsInteractive) return;
                    e.preventDefault();
                    e.stopPropagation();
                    handlePortDragStart(node.stepId, e);
                  }}
                  onKeyDown={(e) =>
                    handlePortKeyDown(e, () => {
                      if (!portsInteractive) return;
                      handlePortDragStart(node.stepId);
                    })
                  }
                />
                <circle
                  cx={opx}
                  cy={opy}
                  r={outputHovered ? 8.5 : 7}
                  fill={PORT_FILL}
                  stroke={OUTPUT_PORT_STROKE}
                  strokeWidth={outputHovered ? 3.5 : 2.5}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
