import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { RuntimeBundle } from '../lib/browser-runtime';
import type { UnfinishedThread } from './OffisimRuntimeProvider';

export function useUnfinishedThreadDetection(opts: {
  companyId: string;
  version: number;
  detectionDoneRef: MutableRefObject<boolean>;
  runtimeRef: MutableRefObject<RuntimeBundle | null>;
  setUnfinishedThreads: Dispatch<SetStateAction<UnfinishedThread[]>>;
}): void {
  const { companyId, version, detectionDoneRef, runtimeRef, setUnfinishedThreads } = opts;

  useEffect(() => {
    if (detectionDoneRef.current) return;
    const runtime = runtimeRef.current;
    if (!runtime?.repos) return;

    detectionDoneRef.current = true;

    void (async () => {
      try {
        const threads = await runtime.repos.threads.findByCompany(companyId, { status: 'running' });
        if (threads.length === 0) {
          setUnfinishedThreads([]);
          return;
        }
        const allProjects = await runtime.repos.projects.findByCompany(companyId);
        const enriched: UnfinishedThread[] = threads.map((thread) => {
          const project = allProjects.find((entry) => entry.thread_id === thread.thread_id);
          return {
            threadId: thread.thread_id,
            projectName: project?.name ?? thread.thread_id,
          };
        });
        setUnfinishedThreads(enriched);
      } catch {
        // Startup detection must never block runtime initialization.
      }
    })();
  }, [companyId, detectionDoneRef, runtimeRef, setUnfinishedThreads, version]);
}
