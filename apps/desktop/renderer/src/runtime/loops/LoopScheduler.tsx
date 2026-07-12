import { useUiState } from '@/app/ui-state.js';
import { startLoopAsParallelProjectRun } from '@/assistant/runtime/loop-send-execution.js';
import { buildLoopService, useLoops } from '@/data/loops.js';
import { getRepos } from '@/runtime/repos.js';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { decideLoopSchedule } from './loop-scheduler-policy.js';

const SCHEDULER_POLL_MS = 15_000;

/** Foreground-only scheduler. App downtime/background slots are advanced
 * without dispatch, so there is never a catch-up burst. */
export function LoopScheduler() {
  const companyId = useUiState((state) => state.companyId) || null;
  const projectId = useUiState((state) => state.projectId) || null;
  const loops = useLoops(companyId);
  const queryClient = useQueryClient();
  const eligibleSinceRef = useRef(Date.now());
  const inFlightRef = useRef(new Set<string>());

  const tick = useCallback(async () => {
    if (!companyId) return;
    const service = buildLoopService(await getRepos());
    const nowMs = Date.now();
    const visible = document.visibilityState === 'visible';
    await Promise.all(
      (loops.data ?? []).map(async (loop) => {
        if (inFlightRef.current.has(loop.loopId)) return;
        const decision = decideLoopSchedule({
          loop,
          nowMs,
          eligibleSinceMs: eligibleSinceRef.current,
          visible,
          hasProject: Boolean(projectId),
        });
        if (decision === 'wait') return;
        inFlightRef.current.add(loop.loopId);
        try {
          if (decision === 'skip') {
            await service.skipMissedSchedule(loop.loopId);
            return;
          }
          const revisionId = loop.currentRevisionId;
          if (!revisionId || !projectId) return;
          const result = await startLoopAsParallelProjectRun({
            loopId: loop.loopId,
            revisionId,
            title: loop.title,
            companyId,
            projectId,
          });
          await service.completeScheduledRun(loop.loopId, `Started · ${result.missionId}`);
          toast.success(`Scheduled Loop started: ${loop.title}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await service.completeScheduledRun(loop.loopId, `Failed · ${message}`);
          toast.error(`Scheduled Loop failed: ${loop.title}`);
        } finally {
          inFlightRef.current.delete(loop.loopId);
          await queryClient.invalidateQueries({ queryKey: ['loops', companyId] });
        }
      }),
    );
  }, [companyId, loops.data, projectId, queryClient]);

  useEffect(() => {
    eligibleSinceRef.current = Date.now();
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      eligibleSinceRef.current = Date.now();
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => void tick(), SCHEDULER_POLL_MS);
    void tick();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [tick]);

  return null;
}
