/**
 * LoopGraphPanel (PR-09) — the SINGLE public surface PR-08 integrates through.
 *
 * Renders a {@link LoopIR} as a browsable nested loop graph: main loop,
 * feedback/retry/escalate edges, subloops, drilldown, breadcrumb, expand/collapse,
 * viewport controls, node inspector. The IR is business truth; React Flow
 * Node[]/Edge[], viewport, and selection are pure UI state derived from the
 * adapter projection. The panel NEVER mutates the IR and never writes ELK
 * positions back to the revision.
 *
 * Layout runs on a cancelable async path keyed by a generation token; selection
 * does NOT trigger re-layout (only IR / drilldown level / direction changes do).
 */

import {
  Background,
  Controls,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeTypes,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { LoopIR, LoopValidationFinding } from '@offisim/shared-types';
import { ChevronRight, Loader2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoopGraphEdge } from './LoopGraphEdge.js';
import { LoopGraphNode } from './LoopGraphNode.js';
import { LoopNodeInspector } from './LoopNodeInspector.js';
import {
  type LoopGraphProjection,
  type ProjectedNode,
  breadcrumbTrail,
  projectLoopGraph,
  selectVisibleSubset,
} from './loop-graph-adapter.js';
import {
  type ElkLike,
  LayoutCancelledError,
  directionForWidth,
  layoutGraph,
} from './loop-graph-layout.js';
import './loop-graph.css';

export type LoopGraphPanelState = 'empty' | 'compiling' | 'ready' | 'invalid' | 'error';

export interface LoopGraphPanelProps {
  ir: LoopIR | null;
  selectedNodeId?: string | null;
  onSelectedNodeChange?: (id: string | null) => void;
  onNavigatePathChange?: (path: string[]) => void;
  state: LoopGraphPanelState;
  findings?: LoopValidationFinding[];
  errorMessage?: string | null;
  focusRequestKey?: number;
}

const nodeTypes: NodeTypes = { loopNode: LoopGraphNode };
const edgeTypes: EdgeTypes = { loopEdge: LoopGraphEdge };

/**
 * ELK is loaded lazily (browser build) so the canvas chunk stays lean.
 *
 * NOTE: `elk.bundled.js` runs worker-FREE — `layout()` executes on the main JS
 * thread. For very large graphs (the ~250-node phase-1 budget) the layout pass
 * can briefly block the thread: the loading spinner shows, but pointer/keyboard
 * input is frozen until ELK returns. A web-worker ELK (`elk-worker.js` +
 * `Worker`) would move layout off-thread and keep the UI responsive — that is a
 * deliberate phase-2 UX upgrade, out of scope for the read-only phase-1 panel.
 */
async function loadElk(): Promise<ElkLike> {
  const mod = await import('elkjs/lib/elk.bundled.js');
  const Ctor = (mod.default ?? mod) as unknown as new () => ElkLike;
  return new Ctor();
}

interface LaidOut {
  nodes: Node[];
  edges: Edge[];
}

export function LoopGraphPanel(props: LoopGraphPanelProps) {
  return (
    <ReactFlowProvider>
      <LoopGraphPanelInner {...props} />
    </ReactFlowProvider>
  );
}

function LoopGraphPanelInner({
  ir,
  selectedNodeId = null,
  onSelectedNodeChange,
  onNavigatePathChange,
  state,
  findings = [],
  errorMessage = null,
  focusRequestKey = 0,
}: LoopGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const elkRef = useRef<ElkLike | null>(null);
  const layoutGenRef = useRef(0);

  // Projection is recomputed only when the IR identity changes (business truth).
  const projection: LoopGraphProjection | null = useMemo(
    () => (ir ? projectLoopGraph(ir, findings) : null),
    // findings is value-stable per render from the caller; we key on ir + findings.
    [ir, findings],
  );

  // Drilldown level (projected graph id; '' = root) and collapse set are UI state.
  const [currentGraphId, setCurrentGraphId] = useState<string>('');
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [laidOut, setLaidOut] = useState<LaidOut>({ nodes: [], edges: [] });
  const [isLaying, setIsLaying] = useState(false);

  // Reset drilldown when the IR changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ir is an intentionally tracked invalidation key; the callback resets UI state on IR identity change rather than referencing ir directly.
  useEffect(() => {
    setCurrentGraphId('');
    setCollapsedIds(new Set());
  }, [ir]);

  // Notify the host of the navigation path (breadcrumb ids) when it changes.
  useEffect(() => {
    if (!projection) {
      onNavigatePathChange?.([]);
      return;
    }
    const trail = breadcrumbTrail(projection, currentGraphId).map((t) => t.id);
    onNavigatePathChange?.(trail);
  }, [projection, currentGraphId, onNavigatePathChange]);

  const visible = useMemo(() => {
    if (!projection) return { nodes: [], edges: [] };
    return selectVisibleSubset(projection, currentGraphId, collapsedIds);
  }, [projection, currentGraphId, collapsedIds]);

  const openSubloop = useCallback((graphId: string) => {
    setCurrentGraphId(graphId);
  }, []);

  // ── Layout effect (cancelable, generation-keyed). Re-runs ONLY when the
  //    visible graph subset changes — i.e. IR / level / collapse. Selection is
  //    intentionally NOT a dependency, so selecting a node never relayouts. ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedNodeId is intentionally excluded — layout must not re-run on node selection (would cause relayout thrash); it is not referenced in this callback.
  useEffect(() => {
    if (visible.nodes.length === 0) {
      setLaidOut({ nodes: [], edges: [] });
      return;
    }
    // biome-ignore lint/suspicious/noAssignInExpressions: generation counter for cancelable layout
    const gen = (layoutGenRef.current += 1);
    let cancelled = false;
    setIsLaying(true);

    void (async () => {
      try {
        if (!elkRef.current) elkRef.current = await loadElk();
        if (cancelled || gen !== layoutGenRef.current) return;
        const width = containerRef.current?.clientWidth ?? 1200;
        const direction = directionForWidth(width);
        const result = await layoutGraph(
          elkRef.current,
          visible.nodes,
          visible.edges,
          { direction },
          () => cancelled || gen !== layoutGenRef.current,
        );
        if (cancelled || gen !== layoutGenRef.current) return;

        // Direction-aware handle/edge geometry: LTR exits right / enters left;
        // TTB (narrow windows) exits bottom / enters top. Without this, DOWN
        // layout would route edges right→left and zigzag across the canvas.
        const sourcePos = direction === 'DOWN' ? Position.Bottom : Position.Right;
        const targetPos = direction === 'DOWN' ? Position.Top : Position.Left;

        const posById = new Map(result.nodes.map((n) => [n.id, n]));
        const rfNodes: Node[] = visible.nodes.map((pn) => {
          const pos = posById.get(pn.id);
          return {
            id: pn.id,
            type: 'loopNode',
            position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
            sourcePosition: sourcePos,
            targetPosition: targetPos,
            data: {
              projected: pn,
              selected: pn.id === selectedNodeId,
              onOpenSubloop: openSubloop,
              sourcePosition: sourcePos,
              targetPosition: targetPos,
            },
            ariaLabel: pn.a11yLabel,
          };
        });
        const rfEdges: Edge[] = visible.edges.map((pe) => ({
          id: pe.id,
          source: pe.source,
          target: pe.target,
          type: 'loopEdge',
          data: { projected: pe },
          ariaLabel: `${pe.kind} edge`,
        }));
        setLaidOut({ nodes: rfNodes, edges: rfEdges });
        setIsLaying(false);
        // Fit view after a fresh layout (enter/return/relayout), not on selection.
        requestAnimationFrame(() => {
          if (gen === layoutGenRef.current) {
            rfRef.current?.fitView({ padding: 0.2, duration: 200 });
          }
        });
      } catch (err) {
        if (err instanceof LayoutCancelledError) return;
        if (!cancelled) setIsLaying(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // selectedNodeId deliberately excluded — selection must not relayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openSubloop]);

  // Selection-only update: patch node data without relayout (cheap, no ELK).
  useEffect(() => {
    setLaidOut((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => ({
        ...n,
        data: { ...n.data, selected: n.id === selectedNodeId },
      })),
    }));
  }, [selectedNodeId]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      onSelectedNodeChange?.(node.id);
    },
    [onSelectedNodeChange],
  );

  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      const pn = (node.data as { projected?: ProjectedNode })?.projected;
      if (pn?.childGraphId) openSubloop(pn.childGraphId);
    },
    [openSubloop],
  );

  const breadcrumb = useMemo(
    () => (projection ? breadcrumbTrail(projection, currentGraphId) : []),
    [projection, currentGraphId],
  );

  const selectedNode = useMemo(
    () => projection?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [projection, selectedNodeId],
  );

  const errorFindings = useMemo(
    () => (projection?.findings ?? []).filter((f) => f.severity === 'error'),
    [projection],
  );

  useEffect(() => {
    if (state !== 'ready' || focusRequestKey === 0 || laidOut.nodes.length === 0) return;
    const frame = requestAnimationFrame(() => {
      rfRef.current?.fitView({ padding: 0.2, duration: 240 });
      canvasRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequestKey, laidOut.nodes.length, state]);

  // ── Keyboard: Esc / Backspace returns to the parent level. ──
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && currentGraphId !== '') {
        event.preventDefault();
        const segs = currentGraphId.split('/');
        segs.pop();
        setCurrentGraphId(segs.join('/'));
      }
      if (event.key === 'Enter' && selectedNode?.childGraphId) {
        event.preventDefault();
        openSubloop(selectedNode.childGraphId);
      }
    },
    [currentGraphId, selectedNode, openSubloop],
  );

  // ── Non-ready render states ──
  if (state === 'compiling') {
    return (
      <div className="off-loopgraph off-loopgraph--state" aria-busy="true">
        <div className="off-loopgraph-progress">
          <Loader2 className="off-loopgraph-loading-icon off-spin" aria-hidden="true" />
          <div>
            <p className="off-loopgraph-state-title">Generating your plan</p>
            <p className="off-loopgraph-state-text">
              Keeping your steps, retries, and stopping condition clear…
            </p>
          </div>
        </div>
        <div className="off-loopgraph-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="off-loopgraph off-loopgraph--state" role="alert">
        <TriangleAlert className="off-loopgraph-state-icon" aria-hidden="true" />
        <p className="off-loopgraph-state-title">The plan could not be generated</p>
        <p className="off-loopgraph-state-text">
          {errorMessage ?? 'The AI did not return a usable plan.'}
        </p>
        <p className="off-loopgraph-state-help">
          Your description is safe. Review it and try Generate plan again.
        </p>
      </div>
    );
  }
  if (state === 'invalid' && (!ir || !projection)) {
    return (
      <div className="off-loopgraph off-loopgraph--state" role="alert">
        <TriangleAlert className="off-loopgraph-state-icon" aria-hidden="true" />
        <p className="off-loopgraph-state-title">This Loop needs a few fixes</p>
        {findings.length > 0 ? (
          <ul className="off-loopgraph-state-findings">
            {findings.slice(0, 3).map((finding, index) => (
              <li key={`${finding.code}:${finding.ref ?? ''}:${index}`}>{finding.message}</li>
            ))}
          </ul>
        ) : (
          <p className="off-loopgraph-state-text">The AI could not build a usable plan.</p>
        )}
        <p className="off-loopgraph-state-help">Update the description, then generate again.</p>
      </div>
    );
  }
  if (state === 'empty' || !ir || !projection) {
    return (
      <div className="off-loopgraph off-loopgraph--state">
        <p className="off-loopgraph-state-title">Ready for a description</p>
        <p className="off-loopgraph-state-text">
          Describe the goal below, then generate a plan you can review.
        </p>
      </div>
    );
  }

  return (
    <div className="off-loopgraph" ref={containerRef}>
      <div className="off-loopgraph-main">
        {/* Breadcrumb */}
        <nav className="off-loopgraph-crumbs" aria-label="Loop hierarchy">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="off-loopgraph-crumb-wrap">
              <button
                type="button"
                className={`off-loopgraph-crumb${
                  crumb.id === currentGraphId ? ' off-loopgraph-crumb--current' : ''
                }`}
                onClick={() => setCurrentGraphId(crumb.id)}
                aria-current={crumb.id === currentGraphId ? 'page' : undefined}
              >
                {crumb.label}
              </button>
              {i < breadcrumb.length - 1 ? (
                <ChevronRight className="off-loopgraph-crumb-sep" aria-hidden="true" />
              ) : null}
            </span>
          ))}
        </nav>

        {/* Invalid-findings overlay (non-blocking; the graph still renders). */}
        {(state === 'invalid' || errorFindings.length > 0) && errorFindings.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: intentional ARIA live region (role=status) for invalid-findings announcement
          <div className="off-loopgraph-findings" role="status">
            <TriangleAlert className="off-loopgraph-findings-icon" aria-hidden="true" />
            <span>
              {errorFindings.length} issue{errorFindings.length === 1 ? '' : 's'} in this loop —{' '}
              {errorFindings[0]?.message}
            </span>
          </div>
        ) : null}

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="off-loopgraph-canvas"
          role="application"
          aria-label={`Loop graph, ${visible.nodes.length} nodes and ${visible.edges.length} edges at this level`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: interactive React Flow canvas is keyboard-focusable by design
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {isLaying ? (
            <div className="off-loopgraph-laying" aria-hidden="true">
              <Loader2 className="off-loopgraph-loading-icon off-spin" />
            </div>
          ) : null}
          <ReactFlow
            nodes={laidOut.nodes}
            edges={laidOut.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              rfRef.current = instance;
            }}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            fitView
            minZoom={0.2}
            maxZoom={1.75}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="off-loopgraph-minimap" />
          </ReactFlow>
        </div>

        {/* Screen-reader live summary of the current level + selection. */}
        <p className="off-loopgraph-sr" aria-live="polite">
          {`Level ${breadcrumb[breadcrumb.length - 1]?.label ?? ''}: ${visible.nodes.length} nodes, ${
            visible.edges.length
          } edges.${selectedNode ? ` Selected: ${selectedNode.a11yLabel}.` : ''}`}
        </p>
      </div>

      <LoopNodeInspector node={selectedNode} />
    </div>
  );
}
