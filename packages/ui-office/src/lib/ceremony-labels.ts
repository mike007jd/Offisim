import type { CeremonyPhase } from '../hooks/useSceneOrchestrator';
import { getPhaseColor } from './ceremony-visuals';

export const CEREMONY_LABELS: Record<CeremonyPhase, { label: string; color: string } | null> = {
  idle: null,
  gathering: { label: '团队集合中', color: getPhaseColor('gathering') },
  analyzing: { label: 'Boss 分析需求', color: getPhaseColor('analyzing') },
  planning: { label: 'PM 制定计划', color: getPhaseColor('planning') },
  dispatching: { label: '分派任务中', color: getPhaseColor('dispatching') },
  working: { label: '员工执行中', color: getPhaseColor('working') },
  reporting: { label: '汇报总结中', color: getPhaseColor('reporting') },
  dismissing: { label: '散会中', color: getPhaseColor('dismissing') },
};
