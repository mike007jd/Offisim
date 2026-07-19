import type { StageViewTarget } from '@/app/ui-state.js';
import { WorkBench } from '@/surfaces/office/scene/work-bench/WorkBench.js';
import { StageEmpty } from '@/surfaces/office/stage-preview/StageEmpty.js';

export function LogsView({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'logs' }>;
}) {
  if (!target.detail)
    return (
      <StageEmpty title="No log detail" detail="The latest tool has no structured detail yet." />
    );
  return (
    <div className="off-stage-logs">
      <WorkBench detail={target.detail} status={target.status ?? 'done'} />
    </div>
  );
}
