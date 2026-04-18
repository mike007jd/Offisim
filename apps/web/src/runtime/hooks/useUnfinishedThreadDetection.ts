import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { RuntimeBundle } from '../../lib/browser-runtime';

export interface UnfinishedThread {
  threadId: string;
  projectName: string;
}

export interface UseUnfinishedThreadDetectionResult {
  unfinishedThreads: UnfinishedThread[];
  dismissUnfinishedThreads: () => void;
  resumeThread: (threadId: string) => Promise<void>;
}

export function useUnfinishedThreadDetection({
  runtime,
  runtimeRef,
  detectionDoneRef,
  companyId,
  version,
  setIsRunning,
  setError,
}: {
  runtime: RuntimeBundle | null;
  runtimeRef: MutableRefObject<RuntimeBundle | null>;
  detectionDoneRef: MutableRefObject<boolean>;
  companyId: string;
  version: number;
  setIsRunning: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}): UseUnfinishedThreadDetectionResult {
  const [unfinishedThreads, setUnfinishedThreads] = useState<UnfinishedThread[]>([]);

  useEffect(() => {
    if (detectionDoneRef.current) return;
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
  }, [runtime, companyId, detectionDoneRef, version]);

  const dismissUnfinishedThreads = useCallback(() => setUnfinishedThreads([]), []);

  const resumeThread = useCallback(
    async (threadId: string): Promise<void> => {
      const current = runtimeRef.current;
      if (!current?.orch) return;
      setIsRunning(true);
      setError(null);
      try {
        await current.orch.resumePlan(threadId, { skipCompletedSteps: true });
        setUnfinishedThreads((prev) => prev.filter((t) => t.threadId !== threadId));
      } catch (err) {
        console.error('Failed to resume thread:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRunning(false);
      }
    },
    [runtimeRef, setIsRunning, setError],
  );

  return { unfinishedThreads, dismissUnfinishedThreads, resumeThread };
}
