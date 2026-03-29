/**
 * SVG-based 2D office top-down view.
 * Replaces PixiJS for visual rendering — cleaner, matches 3D layout 1:1.
 *
 * Supports drag-to-assign: drag an employee avatar to a department zone
 * to reassign their workstation. Emits 'employee.workstation.drop-requested'
 * which is consumed by WorkstationAssignmentService via useScene.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoleSlug } from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID, resolveZoneForRole } from '@offisim/shared-types';
import { type CeremonyState, useSceneOrchestrator } from '../../hooks/useSceneOrchestrator';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { getPhaseColor } from '../../lib/ceremony-visuals';
import { truncate } from '../../lib/format-time';
import { STATE_LABELS } from '../../lib/state-labels';
import { STATUS_COLORS } from '../../lib/zone-config.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { useCompany } from '../company/CompanyContext.js';

import { ROOM_H, ROOM_W, type ViewportTransform, screenToSvg as screenToSvgPure, toSVG } from './office-2d-geometry';
import { getAvatarUri } from './office-2d-avatar-cache';
import { useOffice2DDrag } from './useOffice2DDrag';

// ── SVG Furniture Components ──────────────────────────────────────────

const MeetingTableSVG = memo(function MeetingTableSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-100"
        y="-35"
        width="200"
        height="70"
        rx="20"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="2"
      />
      <rect x="-85" y="-25" width="170" height="50" rx="12" fill="var(--surface-light)" />
      {[-60, -20, 20, 60].map((cx) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={-55}
            r="12"
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth="1"
          />
          <circle
            cx={cx}
            cy={55}
            r="12"
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth="1"
          />
        </g>
      ))}
    </g>
  );
});

const BookshelfSVG = memo(function BookshelfSVG({ x, y }: { x: number; y: number }) {
  const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-25"
        y="-35"
        width="50"
        height="70"
        rx="3"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      {[0, 1, 2, 3].map((shelf) => (
        <g key={shelf}>
          <rect x="-23" y={-30 + shelf * 17} width="46" height="1" fill="var(--surface-mid)" />
          {[0, 1, 2, 3, 4, 5, 6].map((b) => (
            <rect
              key={b}
              x={-21 + b * 6.5}
              y={-28 + shelf * 17}
              width="5"
              height="14"
              rx="0.5"
              fill={bookColors[(shelf * 7 + b) % bookColors.length]}
            />
          ))}
        </g>
      ))}
    </g>
  );
});

const SofaSVG = memo(function SofaSVG({
  x,
  y,
  color = '#f59e0b',
}: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M-50,-20 L50,-20 L50,10 L30,10 L30,-5 L-30,-5 L-30,10 L-50,10 Z" fill={color} />
      <rect x="-55" y="-20" width="10" height="30" rx="4" fill="var(--surface-light)" />
      <rect x="45" y="-20" width="10" height="30" rx="4" fill="var(--surface-light)" />
    </g>
  );
});

const CoffeeTableSVG = memo(function CoffeeTableSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="0"
        r="25"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      <circle cx="0" cy="0" r="12" fill="var(--surface-light)" />
    </g>
  );
});

const ServerRackSVG = memo(function ServerRackSVG({ x, y }: { x: number; y: number }) {
  const rackRows = [-40, -29, -18, -7, 4, 15, 26, 37] as const;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-18"
        y="-45"
        width="36"
        height="90"
        rx="3"
        fill="var(--surface-light)"
        stroke="var(--surface-lighter)"
        strokeWidth="1.5"
      />
      {rackRows.map((row, index) => (
        <g key={row}>
          <rect x="-14" y={row} width="28" height="9" rx="1" fill="var(--surface-light)" />
          <circle cx="10" cy={row + 4} r="2" fill={index % 3 === 0 ? '#fbbf24' : '#22c55e'} />
        </g>
      ))}
    </g>
  );
});

const PlantSVG = memo(function PlantSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="5"
        r="12"
        fill="var(--surface-mid)"
        stroke="var(--text-muted-val)"
        strokeWidth="1"
      />
      <path d="M0,0 C-12,-18 12,-18 0,0" fill="#10b981" />
      <path d="M0,0 C-12,-18 12,-18 0,0" fill="#059669" transform="rotate(72)" />
      <path d="M0,0 C-12,-18 12,-18 0,0" fill="#34d399" transform="rotate(144)" />
      <path d="M0,0 C-12,-18 12,-18 0,0" fill="#10b981" transform="rotate(216)" />
      <path d="M0,0 C-12,-18 12,-18 0,0" fill="#059669" transform="rotate(288)" />
    </g>
  );
});

const VendingMachineSVG = memo(function VendingMachineSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-16"
        y="-30"
        width="32"
        height="60"
        rx="4"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      <rect x="-12" y="-26" width="24" height="25" rx="2" fill="#0ea5e9" opacity="0.5" />
      <rect x="-10" y="5" width="20" height="8" rx="2" fill="var(--surface-light)" />
    </g>
  );
});

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
  if (ceremony.phase === 'idle' || !ceremony.bubbleText) return null;

  const mtg = toSVG(-10, -8, 14, 6);
  const bx = mtg.x + mtg.w / 2;
  const by = mtg.y - 30;

  return (
    <g>
      <rect
        x={bx - 140}
        y={by - 16}
        width="280"
        height="32"
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
        {truncate(ceremony.bubbleText, 35)}
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
    </g>
  );
}

// ── Main 2D View ──────────────────────────────────────────────────────

interface Office2DViewProps {
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

export default function Office2DView({
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: Office2DViewProps) {
  const agents = useAgentStates();
  const { activeCompanyId } = useCompany();
  const { eventBus } = useOffisimRuntime();
  const companyId = activeCompanyId ?? '';
  const { zones } = useCompanyZones();

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
      if (agent.workstationId) {
        const validIds = new Set(dropTargetZones.map((z) => z.zoneId));
        if (validIds.has(agent.workstationId)) return agent.workstationId;
      }
      return resolveZoneForRole(agent.role as RoleSlug, zones)?.zoneId ?? UNASSIGNED_ZONE_ID;
    },
    [zones, dropTargetZones],
  );

  // ── Scene choreography ──
  const ceremony = useSceneOrchestrator({ companyId, eventBus, agents, zones });

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
      startDrag(
        empId,
        agent.name,
        agent.role,
        resolveEmployeeZone(agent),
        seed,
        statusColor,
        e,
      );
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
          const zoneSvg = toSVG(zone.cx, zone.cz, zone.w, zone.d);
          positions.set(empId, {
            x: zoneSvg.x + zoneSvg.w / 2 + (idx % 2 === 0 ? -40 : 40),
            y: zoneSvg.y + zoneSvg.h / 2 + (idx % 3 === 0 ? -30 : 30),
          });
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
  }, [ceremonyActive, ceremony.phase, dispatchedIds, participantIds, agents, zones, resolveEmployeeZone]);

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
                  strokeDasharray={
                    isInfra ? '8 4' : isDropTarget && !isSourceZone ? '6 3' : 'none'
                  }
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

          {/* ── Furniture ── */}

          {/* MTG: conference table + whiteboard */}
          {(() => {
            const cx = toSVG(-10, -8, 14, 6);
            const mx = cx.x + cx.w / 2;
            const my = cx.y + cx.h / 2;
            return (
              <g>
                <MeetingTableSVG x={mx} y={my} />
                <rect
                  x={mx - 275}
                  y={my - 60}
                  width="8"
                  height="100"
                  rx="2"
                  fill="#f1f5f9"
                  stroke="var(--text-secondary-val)"
                  strokeWidth="1"
                />
              </g>
            );
          })()}

          {/* SRV: server racks + cable channels + glow */}
          {(() => {
            const cx = toSVG(8, -8, 14, 6);
            const mx = cx.x + cx.w / 2;
            const my = cx.y + cx.h / 2;
            return (
              <g>
                {[-200, -75, 50, 175].map((ox) => (
                  <ServerRackSVG key={ox} x={mx + ox} y={my - 25} />
                ))}
                {[-150, 0, 150].map((ox) => (
                  <rect
                    key={ox}
                    x={mx + ox - 4}
                    y={my + 50}
                    width="8"
                    height="80"
                    rx="2"
                    fill="#0c4a6e"
                    opacity="0.4"
                  />
                ))}
                <circle cx={mx} cy={my} r="40" fill="#06b6d4" opacity="0.03" />
              </g>
            );
          })()}

          {/* LIB: bookshelves + reading tables + chairs + plant */}
          {(() => {
            const cx = toSVG(-10, 2, 14, 8);
            const mx = cx.x + cx.w / 2;
            const my = cx.y + cx.h / 2;
            return (
              <g>
                {[-200, -75, 50, 175].map((ox) => (
                  <BookshelfSVG key={ox} x={mx + ox} y={my - 125} />
                ))}
                {[-150, 75].map((ox) => (
                  <g key={ox}>
                    <rect
                      x={mx + ox - 55}
                      y={my + 55}
                      width="110"
                      height="40"
                      rx="6"
                      fill="#064e3b"
                      stroke="var(--surface-mid)"
                      strokeWidth="1"
                    />
                    {[-35, 35].map((cx2) => (
                      <g key={cx2}>
                        <circle
                          cx={mx + ox + cx2}
                          cy={my + 25}
                          r="10"
                          fill="var(--surface-light)"
                          stroke="var(--surface-mid)"
                          strokeWidth="0.8"
                        />
                        <circle
                          cx={mx + ox + cx2}
                          cy={my + 105}
                          r="10"
                          fill="var(--surface-light)"
                          stroke="var(--surface-mid)"
                          strokeWidth="0.8"
                        />
                      </g>
                    ))}
                  </g>
                ))}
                <PlantSVG x={mx + 275} y={my - 125} />
              </g>
            );
          })()}

          {/* REST: sofas + coffee table + vending + plants */}
          {(() => {
            const cx = toSVG(8, 2, 14, 8);
            const mx = cx.x + cx.w / 2;
            const my = cx.y + cx.h / 2;
            return (
              <g>
                <rect
                  x={mx - 180}
                  y={my - 60}
                  width="360"
                  height="140"
                  rx="10"
                  fill="var(--surface-mid)"
                  opacity="0.2"
                />
                <SofaSVG x={mx - 50} y={my - 110} />
                <SofaSVG x={mx + 50} y={my + 100} color="#d97706" />
                <CoffeeTableSVG x={mx} y={my} />
                <VendingMachineSVG x={mx + 275} y={my - 100} />
                <PlantSVG x={mx - 250} y={my - 125} />
                <PlantSVG x={mx + 200} y={my + 125} />
              </g>
            );
          })()}

          {/* Rest area employees — idle employees scattered naturally */}
          {(() => {
            const restZ = zones.find((z) => z.archetype === 'rest');
            if (!restZ) return null;
            const rs = toSVG(restZ.cx, restZ.cz, restZ.w, restZ.d);
            const rcx = rs.x + rs.w / 2;
            const rcy = rs.y + rs.h / 2;
            const restEmps = zoneEmployees.get(restZ.zoneId) ?? [];
            return restEmps.map((emp, idx) => {
              if (employeeCeremonyPositions.has(emp.empId)) return null;
              const angle = (idx / Math.max(restEmps.length, 1)) * Math.PI * 1.5 + 0.3;
              const radius = 60 + (idx % 3) * 40;
              const ex = rcx + Math.cos(angle) * radius;
              const ey = rcy + Math.sin(angle) * radius * 0.7;
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
            const s = toSVG(z.cx, z.cz, z.w, z.d);
            const cx = s.x + s.w / 2;
            const cy = s.y + s.h / 2;
            const emps = zoneEmployees.get(z.zoneId) ?? [];
            const qx = s.w * 0.28;
            const qy = s.h * 0.25;
            const quads: [number, number][] = [
              [-qx, -qy],
              [qx, -qy],
              [-qx, qy],
              [qx, qy],
            ];
            return (
              <g key={z.zoneId}>
                {quads.map(([dx, dy], i) => {
                  const emp = emps[i] ?? null;
                  return (
                    <g key={`${dx},${dy}`} transform={`translate(${cx + dx}, ${cy + dy})`}>
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
                      <circle
                        cx="0"
                        cy={dy < 0 ? 32 : -32}
                        r="10"
                        fill="var(--surface-lighter)"
                        stroke="var(--surface-mid)"
                        strokeWidth="1"
                      />
                      {emp && !employeeCeremonyPositions.has(emp.empId) && (
                        <EmployeeNode
                          x={0}
                          y={dy < 0 ? 32 : -32}
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

          {/* Meeting bubble */}
          <MeetingBubble2D ceremony={ceremony} />
        </svg>
      </div>
    </div>
  );
}
