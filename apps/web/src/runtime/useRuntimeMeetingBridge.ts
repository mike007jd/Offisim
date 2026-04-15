import type { RuntimeEvent } from '@offisim/shared-types';
import { useEffect, type MutableRefObject } from 'react';
import type { InMemoryEventBus } from '@offisim/core/browser';
import type { RuntimeBundle } from '../lib/browser-runtime';

async function loadHumanMessage() {
  const { HumanMessage } = await import('@langchain/core/messages');
  return HumanMessage;
}

export function useRuntimeMeetingBridge(opts: {
  eventBusRef: MutableRefObject<InMemoryEventBus>;
  runtimeRef: MutableRefObject<RuntimeBundle | null>;
  setIsRunning: (running: boolean) => void;
  setError: (message: string | null) => void;
}): void {
  const { eventBusRef, runtimeRef, setIsRunning, setError } = opts;

  useEffect(() => {
    const eventBus = eventBusRef.current;

    async function runPausedMeetingAction(
      meetingId: string,
      action: (
        runtime: RuntimeBundle,
        threadId: string | undefined,
        HumanMessage: Awaited<ReturnType<typeof loadHumanMessage>>,
      ) => Promise<void>,
    ): Promise<void> {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      const meeting = await runtime.repos?.meetings.findById(meetingId);
      if (!meeting || meeting.status !== 'paused') return;

      setIsRunning(true);
      try {
        const HumanMessage = await loadHumanMessage();
        await action(runtime, meeting.thread_id ?? undefined, HumanMessage);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsRunning(false);
      }
    }

    const unsubPause = eventBus.on('meeting.interrupt.pause', () => {
      runtimeRef.current?.orch?.interruptMeeting('pause');
    });

    const unsubInject = eventBus.on('meeting.interrupt.inject', (event: RuntimeEvent) => {
      const payload = event.payload as { comment?: string } | undefined;
      runtimeRef.current?.orch?.interruptMeeting('inject', payload?.comment);
    });

    const unsubResume = eventBus.on('meeting.interrupt.resume', (event: RuntimeEvent) => {
      const meetingId = (event.payload as { meetingId?: string } | undefined)?.meetingId;
      if (!meetingId) return;

      void (async () => {
        await runPausedMeetingAction(
          meetingId,
          async (runtime, threadId, HumanMessage) => {
            await runtime.orch.resumeMeeting(meetingId, [new HumanMessage('Resume meeting')], threadId);
          },
        );
      })();
    });

    const unsubEnd = eventBus.on('meeting.interrupt.end', (event: RuntimeEvent) => {
      const runtime = runtimeRef.current;
      const orch = runtime?.orch;
      const meetingId = (event.payload as { meetingId?: string } | undefined)?.meetingId;
      if (!orch || !meetingId) return;

      void (async () => {
        const meeting = await runtime.repos?.meetings.findById(meetingId);
        if (!meeting) return;

        if (meeting.status === 'paused') {
          await runPausedMeetingAction(
            meetingId,
            async (nextRuntime, threadId, HumanMessage) => {
              await nextRuntime.orch.endPausedMeeting(
                meetingId,
                [new HumanMessage('End meeting')],
                threadId,
              );
            },
          );
          return;
        }

        orch.interruptMeeting('end');
      })();
    });

    return () => {
      unsubPause();
      unsubInject();
      unsubResume();
      unsubEnd();
    };
  }, [eventBusRef, runtimeRef, setError, setIsRunning]);
}
