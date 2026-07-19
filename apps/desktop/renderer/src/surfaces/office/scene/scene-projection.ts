import {
  type FlowCueTarget,
  type SceneCueFrame,
  type SceneInk,
  type WorkloadChipTone,
  bundleEmphasis,
  flowCueText,
} from '@/assistant/runtime/scene-cue-projection.js';
import { OFFICE_DELIVERY_WORLD } from './office-visual-language.js';

type FlowCue = SceneCueFrame['flows'][number];

export const WORKLOAD_CHIP_INK: Record<WorkloadChipTone, SceneInk> = {
  work: 'work',
  wait: 'approval',
  risk: 'risk',
  done: 'artifact',
};

export interface SceneFlowLane<Point> {
  readonly id: string;
  readonly cue: FlowCue;
  readonly from: Point;
  readonly to: Point;
  readonly laneKey: string;
  readonly slot: number;
  readonly label: string;
  readonly showLabel: boolean;
  readonly emphasis: number;
  readonly phase: number;
  readonly labelPosition: Point;
}

export function projectFlowLanes<Point>(
  flows: SceneCueFrame['flows'],
  projection: {
    sourceFor: (cue: FlowCue) => Point | null;
    targetFor: (target: FlowCueTarget) => Point;
    phaseFor: (cue: FlowCue) => number;
    labelPositionFor: (from: Point, to: Point, slot: number) => Point;
  },
): SceneFlowLane<Point>[] {
  const labelSlots = new Map<string, number>();
  const lanes: SceneFlowLane<Point>[] = [];
  for (const cue of flows) {
    const from = projection.sourceFor(cue);
    if (from == null) continue;
    const to = projection.targetFor(cue.target);
    const laneKey = `${cue.employeeId}|${cue.target}`;
    const slot = labelSlots.get(laneKey) ?? 0;
    labelSlots.set(laneKey, slot + 1);
    lanes.push({
      id: `${cue.employeeId}|${cue.target}|${cue.kind}`,
      cue,
      from,
      to,
      laneKey,
      slot,
      label: flowCueText(cue),
      showLabel: cue.kind !== 'failure',
      emphasis: bundleEmphasis(cue),
      phase: projection.phaseFor(cue),
      labelPosition: projection.labelPositionFor(from, to, slot),
    });
  }
  return lanes;
}

export function projectActiveFlowTargets(
  flows: SceneCueFrame['flows'],
  include: (cue: FlowCue) => boolean = () => true,
): FlowCueTarget[] {
  const targets = new Set<FlowCueTarget>();
  for (const cue of flows) {
    if (include(cue)) targets.add(cue.target);
  }
  return [...targets].sort();
}

export function projectFlowTargetPoint(
  target: FlowCueTarget,
  geometry:
    | { readonly mode: '2d'; readonly floorW: number; readonly floorD: number }
    | { readonly mode: '3d' },
): readonly [number, number] {
  if (target === 'delivery') return [OFFICE_DELIVERY_WORLD.x, OFFICE_DELIVERY_WORLD.z];
  if (geometry.mode === '2d') {
    switch (target) {
      case 'tool':
        return [geometry.floorW / 2 - 4.8, -geometry.floorD / 2 + 3.2];
      case 'review':
        return [-geometry.floorW / 2 + 4.2, -geometry.floorD / 2 + 3.3];
      case 'user':
        return [0, geometry.floorD / 2 - 1.7];
      default:
        return [0, 0];
    }
  }
  switch (target) {
    case 'tool':
      return [10.4, -9.0];
    case 'review':
      return [-6.4, -7.4];
    case 'user':
      return [0, 13.4];
    default:
      return [0, 0];
  }
}
