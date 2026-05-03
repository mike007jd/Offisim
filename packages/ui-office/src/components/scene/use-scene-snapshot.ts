import { UNASSIGNED_ZONE_ID } from '@offisim/shared-types';
import { useCallback, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator';
import {
  DEFAULT_BUBBLE_TEXT,
  getPhaseColor,
  prepareWaitingDisplay,
} from '../../lib/ceremony-visuals';
import { SeatRegistry } from '../../lib/seat-registry.js';
import { STATE_LABELS } from '../../lib/state-labels';
import { isEmployeeBlocked } from '../../runtime/use-active-employee-count.js';
import { type AgentState, useAgentStates } from '../../runtime/use-agent-states';
import { useTheme } from '../../theme/theme-provider.js';
import { useCompany } from '../company/CompanyContext.js';
import { getAvatarImage, getBrandAvatarImage } from './office-2d-avatar-cache';
import { EMPLOYEE_RADIUS, worldToCanvas, zoneToCanvasRect } from './office-2d-canvas-geometry';
import {
  type EmployeeRenderData,
  type PrefabRenderData,
  type SceneSnapshot,
  type ZoneRenderData,
  buildStatusColors,
  resolveStatusColor,
} from './office-2d-canvas-renderer';
import { SceneHitMap } from './office-2d-hitmap';
import { ARCHETYPE_FALLBACK_MAP, archetypeToCategory } from './office-2d-render-registry';
import { resolveEmployeeSceneZoneId } from './office3d-shared.js';

interface Params {
  ceremony: CeremonyState;
  needsRedrawRef: MutableRefObject<boolean>;
}

interface Returns {
  sceneData: SceneSnapshot;
  hitMap: SceneHitMap;
  dropTargetZoneIds: string[];
  employeeRenderData: ReadonlyArray<EmployeeRenderData>;
  zoneEmployees: ReadonlyMap<string, ReadonlyArray<{ empId: string }>>;
}

export function useSceneSnapshot({ ceremony, needsRedrawRef }: Params): Returns {
  const agents = useAgentStates();
  const { activeCompanyId } = useCompany();
  const { zones } = useCompanyZones();
  const { instances: prefabInstances } = usePrefabInstances();
  const { resolvedTheme } = useTheme();
  const companyId = activeCompanyId ?? '';
  const statusColors = useMemo(() => buildStatusColors(resolvedTheme), [resolvedTheme]);

  const seatRegistry = useMemo(
    () =>
      SeatRegistry.build(
        prefabInstances.map((e) => e.instance),
        zones,
      ),
    [prefabInstances, zones],
  );

  const resolveZone = useCallback(
    (agent: { role: string; workstationId?: string | null }) =>
      resolveEmployeeSceneZoneId(agent, zones),
    [zones],
  );

  const zoneEmployees = useMemo(() => {
    type AgentValue = NonNullable<ReturnType<typeof agents.get>>;
    type Entry = { empId: string; agent: AgentValue; seed: string };
    const map = new Map<string, Entry[]>();
    for (const z of zones) map.set(z.zoneId, []);
    const restZone = zones.find((z) => z.archetype === 'rest');
    const restId = restZone?.zoneId ?? UNASSIGNED_ZONE_ID;
    for (const [empId, agent] of agents) {
      const zoneId =
        !agent.workstationId && agent.state === 'idle' ? restId : resolveZone(agent);
      map.get(zoneId)?.push({ agent, seed: agent.avatarSeed, empId });
    }
    return map;
  }, [agents, zones, resolveZone]);

  const zoneRenderData: ReadonlyArray<ZoneRenderData> = useMemo(
    () =>
      zones.map((z) => {
        const rect = zoneToCanvasRect(z.cx, z.cz, z.w, z.d);
        return {
          zoneId: z.zoneId,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          accentColor: z.accentColor,
          label: z.label,
          isInfrastructure: z.deskSlots === 0,
        };
      }),
    [zones],
  );

  const prefabRenderData: ReadonlyArray<PrefabRenderData> = useMemo(() => {
    if (prefabInstances.length > 0) {
      return prefabInstances.map((inst) => {
        const pos = worldToCanvas(inst.instance.position_x, inst.instance.position_y);
        return {
          prefabId: inst.definition.prefabId,
          category: inst.definition.category,
          x: pos.x,
          y: pos.y,
          rotation: inst.instance.rotation,
        };
      });
    }
    return zones.map((z) => {
      const rect = zoneToCanvasRect(z.cx, z.cz, z.w, z.d);
      const archetype = z.archetype as string;
      const fallbackType = ARCHETYPE_FALLBACK_MAP[archetype] ?? 'workstation';
      return {
        prefabId: `${fallbackType}-fallback`,
        category: archetypeToCategory(archetype),
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        rotation: 0,
      };
    });
  }, [prefabInstances, zones]);

  const triggerRedraw = useCallback(() => {
    needsRedrawRef.current = true;
  }, [needsRedrawRef]);

  const loadAvatar = useCallback(
    (
      agent: Pick<AgentState, 'isExternal' | 'brandKey' | 'appearance'>,
      seed: string,
      cId: string,
    ) =>
      agent.isExternal
        ? getBrandAvatarImage(agent.brandKey, cId, triggerRedraw)
        : getAvatarImage(seed, cId, agent.appearance, triggerRedraw),
    [triggerRedraw],
  );

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
    const mtgRect = zoneToCanvasRect(-10, -8, 14, 6);
    const mtgCx = mtgRect.x + mtgRect.w / 2;
    const mtgCy = mtgRect.y + mtgRect.h / 2;
    const restRect = zoneToCanvasRect(8, 2, 14, 8);
    const restCx = restRect.x + restRect.w / 2;
    const restCy = restRect.y + restRect.h / 2;
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
        // keep at workstation — no override
      } else if (isDispatched && ceremony.phase === 'dispatching') {
        const agent = agents.get(empId);
        const zoneId = agent ? resolveZone(agent) : UNASSIGNED_ZONE_ID;
        const zone = zones.find((z) => z.zoneId === zoneId);
        if (zone) {
          const zoneEmps = zoneEmployees.get(zoneId) ?? [];
          const zoneIndex = zoneEmps.findIndex((entry) => entry.empId === empId);
          const seat = seatRegistry.getSeat(zone.zoneId, Math.max(zoneIndex, 0));
          const [worldX, , worldZ] = seat?.position ?? [zone.cx, 0, zone.cz];
          positions.set(empId, worldToCanvas(worldX, worldZ));
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
    resolveZone,
    seatRegistry,
    zoneEmployees,
  ]);

  const employeeRenderData: ReadonlyArray<EmployeeRenderData> = useMemo(() => {
    const result: EmployeeRenderData[] = [];
    const push = (entry: {
      empId: string;
      x: number;
      y: number;
      agent: AgentState;
      seed: string;
    }) => {
      const { agent } = entry;
      result.push({
        employeeId: entry.empId,
        x: entry.x,
        y: entry.y,
        name: agent.name,
        avatarImage: loadAvatar(agent, entry.seed, companyId),
        statusColor: resolveStatusColor(agent.state, statusColors),
        state: agent.state,
        stateLabel: STATE_LABELS[agent.state] ?? null,
        isBlocked: isEmployeeBlocked(agent.state),
        isSuccess: agent.state === 'success',
        isWorking:
          agent.state === 'executing' || agent.state === 'thinking' || agent.state === 'searching',
        isActive: agent.state !== 'idle',
        isExternal: agent.isExternal,
        brandKey: agent.brandKey,
      });
    };

    const restZone = zones.find((z) => z.archetype === 'rest');
    if (restZone) {
      const restEmps = zoneEmployees.get(restZone.zoneId) ?? [];
      restEmps.forEach((emp, idx) => {
        if (employeeCeremonyPositions.has(emp.empId)) return;
        const [worldX, , worldZ] = seatRegistry.getRestSeat(zones, idx);
        const pos = worldToCanvas(worldX, worldZ);
        push({ empId: emp.empId, x: pos.x, y: pos.y, agent: emp.agent, seed: emp.seed });
      });
    }

    for (const z of zones.filter((z) => z.deskSlots > 0)) {
      const emps = zoneEmployees.get(z.zoneId) ?? [];
      emps.forEach((emp, idx) => {
        if (employeeCeremonyPositions.has(emp.empId)) return;
        const seat = seatRegistry.getSeat(z.zoneId, idx);
        const [worldX, , worldZ] = seat?.position ?? [z.cx, 0, z.cz];
        const pos = worldToCanvas(worldX, worldZ);
        push({ empId: emp.empId, x: pos.x, y: pos.y + 32, agent: emp.agent, seed: emp.seed });
      });
    }

    for (const [empId, pos] of employeeCeremonyPositions) {
      const agent = agents.get(empId);
      if (!agent) continue;
      push({ empId, x: pos.x, y: pos.y, agent, seed: agent.avatarSeed });
    }
    return result;
  }, [
    zones,
    zoneEmployees,
    employeeCeremonyPositions,
    seatRegistry,
    agents,
    companyId,
    loadAvatar,
    statusColors,
  ]);

  const sceneData: SceneSnapshot = useMemo(() => {
    let managerMarker = null;
    if (ceremony.managerVisible && ceremony.managerPosition) {
      const pos = worldToCanvas(ceremony.managerPosition[0], ceremony.managerPosition[2]);
      managerMarker = { x: pos.x, y: pos.y };
    }
    let meetingBubble = null;
    if (
      ceremony.phase !== 'idle' &&
      (ceremony.bubbleText || ceremony.waitingRelationships.length > 0)
    ) {
      const mtgRect = zoneToCanvasRect(-10, -8, 14, 6);
      const bx = mtgRect.x + mtgRect.w / 2;
      const by = mtgRect.y - 30;
      const { labels, extraCount } = prepareWaitingDisplay(ceremony.waitingRelationships);
      meetingBubble = {
        x: bx,
        y: by,
        phaseColor: getPhaseColor(ceremony.phase),
        bubbleText: ceremony.bubbleText || DEFAULT_BUBBLE_TEXT,
        participantCount: ceremony.participantIds.size,
        waitingLabels: labels,
        extraWaitingCount: extraCount,
      };
    }
    return {
      zones: zoneRenderData,
      prefabs: prefabRenderData,
      employees: employeeRenderData,
      ceremony: { phase: ceremony.phase, isActive: ceremonyActive },
      managerMarker,
      meetingBubble,
    };
  }, [
    zoneRenderData,
    prefabRenderData,
    employeeRenderData,
    ceremony.phase,
    ceremony.managerVisible,
    ceremony.managerPosition,
    ceremony.bubbleText,
    ceremony.waitingRelationships,
    ceremony.participantIds.size,
    ceremonyActive,
  ]);

  const hitMap = useMemo(() => {
    const employees = employeeRenderData.map((emp) => ({
      employeeId: emp.employeeId,
      cx: emp.x,
      cy: emp.y,
      radius: EMPLOYEE_RADIUS,
    }));
    const zoneEntries = zoneRenderData.map((z) => ({
      zoneId: z.zoneId,
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h,
    }));
    return new SceneHitMap(employees, zoneEntries);
  }, [employeeRenderData, zoneRenderData]);

  const dropTargetZoneIds = useMemo(
    () => zones.filter((z) => z.deskSlots > 0).map((z) => z.zoneId),
    [zones],
  );

  return { sceneData, hitMap, dropTargetZoneIds, employeeRenderData, zoneEmployees };
}
