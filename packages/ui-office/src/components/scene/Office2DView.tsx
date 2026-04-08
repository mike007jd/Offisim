import { UNASSIGNED_ZONE_ID } from '@offisim/shared-types';
/**
 * SVG-based 2D office top-down view.
 * Replaces PixiJS for visual rendering — cleaner, matches 3D layout 1:1.
 *
 * Supports drag-to-assign: drag an employee avatar to a department zone
 * to reassign their workstation. Emits 'employee.workstation.drop-requested'
 * which is consumed by WorkstationAssignmentService via useScene.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator';
import {
  DEFAULT_BUBBLE_TEXT,
  MANAGER_PRESENCE_COLORS,
  getPhaseColor,
  prepareWaitingDisplay,
} from '../../lib/ceremony-visuals';
import { truncate } from '../../lib/format-time';
import { SeatRegistry } from '../../lib/seat-registry.js';
import { STATE_LABELS } from '../../lib/state-labels';
import { STATUS_COLORS } from '../../lib/status-colors.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { useCompany } from '../company/CompanyContext.js';

import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import { Office2DPrefab, PlantSVG } from './Office2DPrefab.js';
import { getAvatarUri } from './office-2d-avatar-cache';
import { buildZoneDeskEmployeeSvgPositions } from './office-2d-layout';
import {
  ROOM_H,
  ROOM_W,
  type ViewportTransform,
  positionToSVG,
  screenToSvg as screenToSvgPure,
  toSVG,
} from './office-2d-geometry';
import { resolveEmployeeSceneZoneId } from './office3d-shared.js';
import { useOffice2DDrag } from './useOffice2DDrag';

// ── Employee Node ─────────────────────────────────────────────────────

const EmployeeNode = memo(function EmployeeNode({
  x,
  y,
  agent,
  seed,
  companyId,
  selected,
  onClick,
  onDragStart,
  dimmed,
}: {
  x: number;
  y: number;
  agent: AgentState;
  seed: string;
  companyId: string;
  selected: boolean;
  onClick: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
  dimmed?: boolean;
}) {
  const avatarUri = useMemo(() => getAvatarUri(seed, companyId), [seed, companyId]);
  const statusColor = STATUS_COLORS[agent.state] ?? '#64748b';

  const isActive = agent.state !== 'idle';
  const isBlocked = agent.state === 'blocked' || agent.state === 'failed';
  const isSuccess = agent.state === 'success';
  const isWorking =
    agent.state === 'executing' || agent.state === 'thinking' || agent.state === 'searching';

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      tabIndex={0}
      aria-label={`${agent.name} employee node`}
      onPointerDown={(e) => {
        if (onDragStart) {
          e.stopPropagation();
          onDragStart(e);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: 'grab', touchAction: 'none' }}
      opacity={dimmed ? 0.35 : 1}
    >
      {selected && (
        <circle
          cx="0"
          cy="0"
          r="26"
          fill="none"
          stroke="var(--accent-val)"
          strokeWidth="2.5"
          opacity={0.9}
        />
      )}
      <circle
        cx="0"
        cy="0"
        r="22"
        fill={statusColor}
        opacity="0.15"
        style={{ transition: 'fill 0.4s ease, opacity 0.4s ease' }}
      >
        {isActive && (
          <animate
            attributeName="r"
            values="22;25;22"
            dur={isBlocked ? '2s' : '1.5s'}
            repeatCount="indefinite"
          />
        )}
        {isActive && (
          <animate
            attributeName="opacity"
            values="0.15;0.25;0.15"
            dur={isBlocked ? '2s' : '1.5s'}
            repeatCount="indefinite"
          />
        )}
      </circle>
      <circle
        cx="0"
        cy="0"
        r="18"
        fill="var(--surface-lighter)"
        stroke={statusColor}
        strokeWidth={isActive ? '3' : '2.5'}
        style={{ transition: 'stroke 0.4s ease, stroke-width 0.3s ease' }}
      />
      <image
        href={avatarUri}
        x="-16"
        y="-16"
        width="32"
        height="32"
        clipPath="circle(16px at center)"
      />
      <circle
        cx="12"
        cy="12"
        r="5"
        fill={statusColor}
        stroke="var(--surface-light)"
        strokeWidth="2"
        style={{ transition: 'fill 0.3s ease' }}
      >
        {isWorking && (
          <animate attributeName="r" values="5;6.5;5" dur="1s" repeatCount="indefinite" />
        )}
        {isBlocked && (
          <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
        )}
      </circle>
      {isActive && STATE_LABELS[agent.state] && (
        <g transform="translate(0, -28)" style={{ opacity: 1 }}>
          <rect
            x={-22}
            y={-8}
            width={44}
            height={14}
            rx={7}
            fill={
              isBlocked
                ? 'rgba(239,68,68,0.25)'
                : isSuccess
                  ? 'rgba(34,197,94,0.25)'
                  : 'rgba(0,0,0,0.7)'
            }
            stroke={
              isBlocked
                ? 'rgba(239,68,68,0.4)'
                : isSuccess
                  ? 'rgba(34,197,94,0.4)'
                  : 'rgba(255,255,255,0.1)'
            }
            strokeWidth={0.5}
            style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
          />
          <text
            x={0}
            y={1}
            textAnchor="middle"
            fontSize={7}
            fontFamily="monospace"
            fill={isBlocked ? '#fca5a5' : isSuccess ? '#86efac' : 'rgba(255,255,255,0.8)'}
          >
            {isBlocked ? '⚠ ' : isSuccess ? '✓ ' : ''}
            {STATE_LABELS[agent.state]}
          </text>
        </g>
      )}
      <g transform="translate(0, 28)">
        <rect
          x="-32"
          y="-8"
          width="64"
          height="16"
          rx="8"
          fill="var(--surface-light)"
          opacity="0.85"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="0.5"
        />
        <text x="0" y="4" fill="#f8fafc" fontSize="9" fontWeight="bold" textAnchor="middle">
          {agent.name.split(' ')[0]}
        </text>
      </g>
    </g>
  );
});

// ── Drag Ghost ────────────────────────────────────────────────────────

function DragGhost({
  svgX,
  svgY,
  seed,
  companyId,
  statusColor,
  name,
}: {
  svgX: number;
  svgY: number;
  seed: string;
  companyId: string;
  statusColor: string;
  name: string;
}) {
  const avatarUri = useMemo(() => getAvatarUri(seed, companyId), [seed, companyId]);
  return (
    <g transform={`translate(${svgX}, ${svgY})`} style={{ pointerEvents: 'none' }}>
      <circle cx="2" cy="2" r="22" fill="rgba(0,0,0,0.3)" />
      <circle cx="0" cy="0" r="24" fill={statusColor} opacity="0.2" />
      <circle
        cx="0"
        cy="0"
        r="20"
        fill="var(--surface-lighter)"
        stroke={statusColor}
        strokeWidth="3"
      />
      <image
        href={avatarUri}
        x="-18"
        y="-18"
        width="36"
        height="36"
        clipPath="circle(18px at center)"
      />
      <g transform="translate(0, 32)">
        <rect
          x="-36"
          y="-8"
          width="72"
          height="16"
          rx="8"
          fill="var(--surface-light)"
          opacity="0.9"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="0.5"
        />
        <text x="0" y="4" fill="#f8fafc" fontSize="9" fontWeight="bold" textAnchor="middle">
          {name.split(' ')[0]}
        </text>
      </g>
    </g>
  );
}

// ── Meeting bubble (SVG) ──────────────────────────────────────────────

function MeetingBubble2D({ ceremony }: { ceremony: CeremonyState }) {
  if (
    ceremony.phase === 'idle' ||
    (!ceremony.bubbleText && ceremony.waitingRelationships.length === 0)
  ) {
    return null;
  }

  const mtg = toSVG(-10, -8, 14, 6);
  const bx = mtg.x + mtg.w / 2;
  const by = mtg.y - 30;
  const {
    visible: visibleRelationships,
    extraCount,
    labels,
  } = prepareWaitingDisplay(ceremony.waitingRelationships);
  const bubbleHeight = visibleRelationships.length > 0 ? 54 + visibleRelationships.length * 12 : 32;

  return (
    <g>
      <rect
        x={bx - 140}
        y={by - 16}
        width="280"
        height={bubbleHeight}
        rx="16"
        fill="rgba(0,0,0,0.65)"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1"
      />
      <circle cx={bx - 120} cy={by} r="4" fill={getPhaseColor(ceremony.phase)} opacity="0.8">
        <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <text
        x={bx - 108}
        y={by + 4}
        fill="rgba(255,255,255,0.85)"
        fontSize="12"
        fontWeight="600"
        fontFamily="monospace"
      >
        {truncate(ceremony.bubbleText || DEFAULT_BUBBLE_TEXT, 35)}
      </text>
      {ceremony.participantIds.size > 0 && (
        <text
          x={bx + 125}
          y={by + 4}
          fill="rgba(255,255,255,0.35)"
          fontSize="9"
          fontFamily="monospace"
          textAnchor="end"
        >
          {ceremony.participantIds.size}p
        </text>
      )}
      {visibleRelationships.map((relationship, i) => (
        <text
          key={`${relationship.waiterId}:${relationship.kind}`}
          x={bx - 108}
          y={by + 18 + i * 11}
          fill="rgba(255,255,255,0.55)"
          fontSize="9"
          fontFamily="monospace"
        >
          {labels[i]}
        </text>
      ))}
      {extraCount > 0 && (
        <text
          x={bx - 108}
          y={by + 18 + visibleRelationships.length * 11}
          fill="rgba(255,255,255,0.45)"
          fontSize="9"
          fontFamily="monospace"
        >
          +{extraCount} more
        </text>
      )}
    </g>
  );
}

// ── Main 2D View ──────────────────────────────────────────────────────

interface Office2DViewProps {
  ceremony: CeremonyState;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

export default function Office2DView({
  ceremony,
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: Office2DViewProps) {
  const agents = useAgentStates();
  const { activeCompanyId } = useCompany();
  const { eventBus } = useOffisimRuntime();
  const companyId = activeCompanyId ?? '';
  const { zones } = useCompanyZones();
  const { instances: prefabInstances } = usePrefabInstances();
  const seatRegistry = useMemo(
    () =>
      SeatRegistry.build(
        prefabInstances.map((entry) => entry.instance),
        zones,
      ),
    [prefabInstances, zones],
  );

  // ── Dynamic zone derivations ──
  const dropTargetZones = useMemo(() => zones.filter((z) => z.deskSlots > 0), [zones]);

  const zoneSvgBounds = useMemo(
    () =>
      dropTargetZones.map((z) => {
        const s = toSVG(z.cx, z.cz, z.w, z.d);
        return { zone: z, x: s.x, y: s.y, w: s.w, h: s.h };
      }),
    [dropTargetZones],
  );

  /** Resolve which zone an employee belongs to (role-based, dynamic). */
  const resolveEmployeeZone = useCallback(
    (agent: { role: string; workstationId?: string | null }): string => {
      return resolveEmployeeSceneZoneId(agent, zones);
    },
    [zones],
  );

  // ── Viewport state ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<ViewportTransform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedEmployeeId = onSelectEmployee ? externalSelectedId : localSelectedId;

  const transformRef = useRef(transform);
  transformRef.current = transform;

  /** screenToSvg bound to current viewport — used by drag hook and pointer handlers. */
  const screenToSvgBound = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    return screenToSvgPure(clientX, clientY, el.getBoundingClientRect(), transformRef.current);
  }, []);

  // ── Employee selection ──
  const handleEmployeeClick = useCallback(
    (empId: string) => {
      if (onSelectEmployee) {
        onSelectEmployee(empId);
      } else {
        setLocalSelectedId(empId);
      }
      eventBus.emit({
        type: 'scene.employee.selected',
        entityId: empId,
        entityType: 'employee',
        companyId,
        timestamp: Date.now(),
        payload: { employeeId: empId, source: 'scene' },
      });
    },
    [onSelectEmployee, eventBus, companyId],
  );

  const handleDeselect = useCallback(() => {
    if (onDeselectEmployee) {
      onDeselectEmployee();
    } else {
      setLocalSelectedId(null);
    }
    eventBus.emit({
      type: 'ui.selection.changed',
      entityId: '',
      entityType: 'employee',
      companyId,
      timestamp: Date.now(),
      payload: { entityId: null, source: 'scene' },
    });
  }, [onDeselectEmployee, eventBus, companyId]);

  // ── Drag hook ──
  const {
    dragState,
    isDragging,
    hoveredZoneId,
    startDrag,
    onPointerMove: onDragPointerMove,
    onPointerUp: onDragPointerUp,
    cancelDrag,
  } = useOffice2DDrag({
    screenToSvg: screenToSvgBound,
    zoneSvgBounds,
    eventBus,
    companyId,
    onEmployeeClick: handleEmployeeClick,
  });

  /** Start a drag from an EmployeeNode. */
  const handleEmployeeDragStart = useCallback(
    (empId: string, agent: AgentState, seed: string, e: React.PointerEvent) => {
      const statusColor = STATUS_COLORS[agent.state] ?? '#64748b';
      startDrag(empId, agent.name, agent.role, resolveEmployeeZone(agent), seed, statusColor, e);
    },
    [startDrag, resolveEmployeeZone],
  );

  // ── Fit to viewport on mount ──
  useEffect(() => {
    if (viewportRef.current) {
      const rect = viewportRef.current.getBoundingClientRect();
      const scale = Math.min(rect.width / ROOM_W, rect.height / ROOM_H) * 0.92;
      setTransform({
        x: (rect.width - ROOM_W * scale) / 2,
        y: (rect.height - ROOM_H * scale) / 2,
        scale,
      });
    }
  }, []);

  // ── Wheel zoom ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * -0.002;
      setTransform((prev) => {
        const newScale = Math.min(Math.max(0.3, prev.scale + delta), 4);
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const ox = px - prev.x;
        const oy = py - prev.y;
        const ratio = newScale / prev.scale;
        return { x: prev.x - ox * (ratio - 1), y: prev.y - oy * (ratio - 1), scale: newScale };
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // ── Pointer handlers (drag-first, then pan) ──

  const handlePointerDown = (e: React.PointerEvent) => {
    if (dragState) return;
    setIsPanning(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (onDragPointerMove(e)) return;
    if (isPanning) {
      setTransform((prev) => ({ ...prev, x: prev.x + e.movementX, y: prev.y + e.movementY }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (onDragPointerUp(e)) return;
    setIsPanning(false);
  };

  const handlePointerLeave = () => {
    if (dragState) {
      cancelDrag();
      return;
    }
    setIsPanning(false);
  };

  // ── Group employees by zone ──
  const zoneEmployees = useMemo(() => {
    const map = new Map<string, Array<{ agent: AgentState; seed: string; empId: string }>>();
    for (const z of zones) map.set(z.zoneId, []);
    for (const [empId, agent] of agents) {
      const restZone = zones.find((z) => z.archetype === 'rest');
      const restId = restZone?.zoneId ?? UNASSIGNED_ZONE_ID;
      const zId = agent.state === 'idle' ? restId : resolveEmployeeZone(agent);
      map.get(zId)?.push({ agent, seed: agent.name, empId });
    }
    return map;
  }, [agents, zones, resolveEmployeeZone]);

  // ── Ceremony-aware positions ──
  const ceremonyActive = ceremony.phase !== 'idle';
  const dispatchedIds = useMemo(
    () => Array.from(ceremony.dispatchedIds).sort(),
    [ceremony.dispatchedIds],
  );
  const participantIds = useMemo(
    () => Array.from(ceremony.participantIds).sort(),
    [ceremony.participantIds],
  );
  const employeeCeremonyPositions = useMemo(() => {
    if (!ceremonyActive) return new Map<string, { x: number; y: number }>();

    const positions = new Map<string, { x: number; y: number }>();
    const mtgSvg = toSVG(-10, -8, 14, 6);
    const mtgCx = mtgSvg.x + mtgSvg.w / 2;
    const mtgCy = mtgSvg.y + mtgSvg.h / 2;
    const restSvg = toSVG(8, 2, 14, 8);
    const restCx = restSvg.x + restSvg.w / 2;
    const restCy = restSvg.y + restSvg.h / 2;

    const allEmps = [...agents.entries()];
    const mtgRadius = 100;

    allEmps.forEach(([empId], idx) => {
      const isDispatched = dispatchedIds.includes(empId);
      const isParticipant = participantIds.includes(empId);

      if (ceremony.phase === 'dismissing') {
        const angle = (idx / Math.max(allEmps.length, 1)) * Math.PI * 1.5 + 0.3;
        positions.set(empId, {
          x: restCx + Math.cos(angle) * 60,
          y: restCy + Math.sin(angle) * 40,
        });
      } else if (ceremony.phase === 'working' && isDispatched) {
        // Dispatched at workstations — no override
      } else if (isDispatched && ceremony.phase === 'dispatching') {
        const agent = agents.get(empId);
        const zoneId = agent ? resolveEmployeeZone(agent) : UNASSIGNED_ZONE_ID;
        const zone = zones.find((z) => z.zoneId === zoneId);
        if (zone) {
          const zoneEmps = zoneEmployees.get(zoneId) ?? [];
          const zoneIndex = zoneEmps.findIndex((entry) => entry.empId === empId);
          const deskPositions = buildZoneDeskEmployeeSvgPositions(
            zone,
            zoneEmps.length,
            seatRegistry,
          );
          const deskPosition = deskPositions[Math.max(zoneIndex, 0)];
          if (deskPosition) {
            positions.set(empId, deskPosition);
          }
        }
      } else if (
        isParticipant ||
        ceremony.phase === 'gathering' ||
        ceremony.phase === 'analyzing' ||
        ceremony.phase === 'planning'
      ) {
        const angle = Math.PI * ((idx + 1) / (allEmps.length + 2));
        positions.set(empId, {
          x: mtgCx + Math.cos(angle) * mtgRadius,
          y: mtgCy + Math.sin(angle) * mtgRadius * 0.6,
        });
      }
    });

    return positions;
  }, [
    ceremonyActive,
    ceremony.phase,
    dispatchedIds,
    participantIds,
    agents,
    zones,
    resolveEmployeeZone,
    seatRegistry,
    zoneEmployees,
  ]);

  const cursor = isDragging ? 'grabbing' : isPanning ? 'grabbing' : 'grab';

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      ref={viewportRef}
      className="w-full h-full bg-[#020617] overflow-hidden select-none"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className="absolute origin-top-left"
        style={{
          width: ROOM_W,
          height: ROOM_H,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${ROOM_W} ${ROOM_H}`}
          className="w-full h-full"
          role="img"
          aria-label="2D office layout"
        >
          <title>2D office layout</title>
          <defs>
            <pattern id="grid2d" width="50" height="50" patternUnits="userSpaceOnUse">
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke="var(--surface-lighter)"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          {/* Floor — deselect target */}
          <rect
            width={ROOM_W}
            height={ROOM_H}
            fill="#090f1b"
            onClick={handleDeselect}
            role="button"
            tabIndex={0}
            aria-label="Deselect office scene"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleDeselect();
              }
            }}
            style={{ cursor: 'default' }}
          />
          <rect
            width={ROOM_W}
            height={ROOM_H}
            fill="url(#grid2d)"
            style={{ pointerEvents: 'none' }}
          />

          {/* Zones — with drag highlight overlay */}
          {zones.map((z) => {
            const s = toSVG(z.cx, z.cz, z.w, z.d);
            const isDropTarget = isDragging && z.deskSlots > 0;
            const isHovered = isDragging && hoveredZoneId === z.zoneId;
            const isSourceZone = isDragging && dragState?.sourceZoneId === z.zoneId;
            const isInfra = z.deskSlots === 0;
            return (
              <g key={z.zoneId}>
                <rect
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  rx="16"
                  fill={z.accentColor}
                  fillOpacity={isHovered && !isSourceZone ? 0.18 : 0.06}
                  stroke={z.accentColor}
                  strokeWidth={isDropTarget ? (isHovered && !isSourceZone ? 3 : 2) : 1.5}
                  strokeOpacity={isDropTarget ? (isHovered && !isSourceZone ? 0.8 : 0.5) : 0.3}
                  strokeDasharray={isInfra ? '8 4' : isDropTarget && !isSourceZone ? '6 3' : 'none'}
                  style={{
                    transition: 'fill-opacity 0.15s, stroke-width 0.15s, stroke-opacity 0.15s',
                  }}
                />
                {isDropTarget && !isSourceZone && (
                  <text
                    x={s.x + s.w / 2}
                    y={s.y + s.h / 2 + 5}
                    fill={z.accentColor}
                    fontSize="14"
                    fontWeight="700"
                    textAnchor="middle"
                    opacity={isHovered ? 0.9 : 0.4}
                    style={{ pointerEvents: 'none', transition: 'opacity 0.15s' }}
                  >
                    Drop here
                  </text>
                )}
                <text
                  x={s.x + s.w / 2}
                  y={s.y + 28}
                  fill={z.accentColor}
                  fontSize="18"
                  fontWeight="900"
                  letterSpacing="6"
                  textAnchor="middle"
                  opacity="0.5"
                >
                  {z.label}
                </text>
              </g>
            );
          })}

          {/* ── Furniture — data-driven from prefab instances ── */}
          {prefabInstances.length > 0
            ? prefabInstances.map((inst) => {
                const svgPos = positionToSVG(inst.instance.position_x, inst.instance.position_y);
                return (
                  <Office2DPrefab
                    key={inst.instance.instance_id}
                    prefabId={inst.definition.prefabId}
                    category={inst.definition.category}
                    x={svgPos.x}
                    y={svgPos.y}
                    rotation={inst.instance.rotation}
                  />
                );
              })
            : /* Fallback: generic desk clusters when no studio data saved */
              zones.map((z) => {
                const s = toSVG(z.cx, z.cz, z.w, z.d);
                const mx = s.x + s.w / 2;
                const my = s.y + s.h / 2;
                return (
                  <Office2DPrefab
                    key={`fallback-${z.zoneId}`}
                    prefabId={
                      z.archetype === 'server'
                        ? 'server-rack-2u'
                        : z.archetype === 'meeting'
                          ? 'meeting-table-4'
                          : z.archetype === 'library'
                            ? 'bookshelf-single'
                            : z.archetype === 'rest'
                              ? 'sofa-set'
                              : 'workstation-standard'
                    }
                    category={
                      z.archetype === 'server'
                        ? 'compute'
                        : z.archetype === 'meeting'
                          ? 'meeting'
                          : z.archetype === 'library'
                            ? 'knowledge'
                            : z.archetype === 'rest'
                              ? 'rest'
                              : 'workspace'
                    }
                    x={mx}
                    y={my}
                    rotation={0}
                  />
                );
              })}

          {/* Rest area employees — idle employees scattered naturally */}
          {(() => {
            const restZ = zones.find((z) => z.archetype === 'rest');
            if (!restZ) return null;
            const restEmps = zoneEmployees.get(restZ.zoneId) ?? [];
            return restEmps.map((emp, idx) => {
              if (employeeCeremonyPositions.has(emp.empId)) return null;
              const [worldX, , worldZ] = seatRegistry.getRestSeat(zones, idx);
              const { x: ex, y: ey } = positionToSVG(worldX, worldZ);
              return (
                <EmployeeNode
                  key={emp.empId}
                  x={ex}
                  y={ey}
                  agent={emp.agent}
                  seed={emp.seed}
                  companyId={companyId}
                  selected={selectedEmployeeId === emp.empId}
                  dimmed={isDragging && dragState?.employeeId === emp.empId}
                  onClick={() => handleEmployeeClick(emp.empId)}
                  onDragStart={(e) => handleEmployeeDragStart(emp.empId, emp.agent, emp.seed, e)}
                />
              );
            });
          })()}

          {/* Department employees — desk clusters */}
          {dropTargetZones.map((z) => {
            const emps = zoneEmployees.get(z.zoneId) ?? [];
            const deskPositions = buildZoneDeskEmployeeSvgPositions(z, emps.length, seatRegistry);
            return (
              <g key={z.zoneId}>
                {deskPositions.map((position, i) => {
                  const emp = emps[i] ?? null;
                  if (!emp) return null;
                  return (
                    <g key={`${emp.empId}:${position.x}:${position.y}`} transform={`translate(${position.x}, ${position.y})`}>
                      <rect
                        x="-28"
                        y="-22"
                        width="56"
                        height="44"
                        rx="4"
                        fill="var(--surface-mid)"
                        opacity="0.6"
                      />
                      <rect
                        x="-16"
                        y="-2"
                        width="32"
                        height="6"
                        rx="1"
                        fill="var(--surface-light)"
                      />
                      <rect x="-14" y="-4" width="28" height="3" fill="#0ea5e9" opacity="0.5" />
                      <circle cx="0" cy="32" r="10" fill="var(--surface-lighter)" stroke="var(--surface-mid)" strokeWidth="1" />
                      {!employeeCeremonyPositions.has(emp.empId) && (
                        <EmployeeNode
                          x={0}
                          y={32}
                          agent={emp.agent}
                          seed={emp.seed}
                          companyId={companyId}
                          selected={selectedEmployeeId === emp.empId}
                          dimmed={isDragging && dragState?.employeeId === emp.empId}
                          onClick={() => handleEmployeeClick(emp.empId)}
                          onDragStart={(e) =>
                            handleEmployeeDragStart(emp.empId, emp.agent, emp.seed, e)
                          }
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Corner plants */}
          <PlantSVG x={130} y={130} />
          <PlantSVG x={130} y={1430} />
          <PlantSVG x={1930} y={130} />
          <PlantSVG x={1930} y={1430} />
          <PlantSVG x={1030} y={1430} />

          {/* Ceremony position overlay */}
          {ceremonyActive &&
            [...employeeCeremonyPositions.entries()].map(([empId, pos]) => {
              const agent = agents.get(empId);
              if (!agent) return null;
              const isHighlighted =
                ceremony.dispatchedIds.has(empId) && ceremony.phase === 'dispatching';
              return (
                <g
                  key={`ceremony-${empId}`}
                  style={{
                    transition: 'transform 2s ease-in-out',
                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                  }}
                >
                  <EmployeeNode
                    x={0}
                    y={0}
                    agent={agent}
                    seed={agent.name}
                    companyId={companyId}
                    selected={selectedEmployeeId === empId || isHighlighted}
                    onClick={() => handleEmployeeClick(empId)}
                  />
                </g>
              );
            })}

          {/* Drag ghost overlay */}
          {isDragging && dragState && (
            <DragGhost
              svgX={dragState.currentSvgX}
              svgY={dragState.currentSvgY}
              seed={dragState.avatarSeed}
              companyId={companyId}
              statusColor={dragState.statusColor}
              name={dragState.employeeName}
            />
          )}

          {ceremony.managerVisible &&
            ceremony.managerPosition &&
            (() => {
              const marker = positionToSVG(
                ceremony.managerPosition[0],
                ceremony.managerPosition[2],
              );
              return (
                <g className="manager-presence" transform={`translate(${marker.x}, ${marker.y})`}>
                  <polygon
                    points="0,-12 12,0 0,12 -12,0"
                    fill={MANAGER_PRESENCE_COLORS.svgFill}
                    stroke={MANAGER_PRESENCE_COLORS.svgStroke}
                    strokeWidth="1.2"
                  />
                  <text
                    x={0}
                    y={24}
                    fill={MANAGER_PRESENCE_COLORS.svgText}
                    fontSize="8"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    Manager
                  </text>
                </g>
              );
            })()}

          {/* Meeting bubble */}
          <MeetingBubble2D ceremony={ceremony} />
        </svg>
      </div>
    </div>
  );
}
