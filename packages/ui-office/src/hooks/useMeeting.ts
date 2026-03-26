import type {
  MeetingActionCreatedPayload,
  MeetingStatePayload,
  RuntimeEvent,
} from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

/** Meeting runtime status — mirrors MeetingControls.MeetingStatus but scoped to this hook. */
export type MeetingRunStatus = 'idle' | 'running' | 'paused';

export interface MeetingActionItem {
  actionItemId: string;
  meetingId: string;
  description: string;
  assigneeEmployeeId: string;
  priority: 'high' | 'medium' | 'low';
  dependsOn: string[];
  createdAt: number;
}

export interface MeetingTranscriptEntry {
  id: string;
  participantId: string;
  content: string;
  timestamp: number;
}

export interface MeetingState {
  meetingId: string | null;
  status: MeetingRunStatus;
  participantIds: string[];
  startTime: number | null;
  actions: MeetingActionItem[];
  transcript: MeetingTranscriptEntry[];
}

const INITIAL_STATE: MeetingState = {
  meetingId: null,
  status: 'idle',
  participantIds: [],
  startTime: null,
  actions: [],
  transcript: [],
};

export interface UseMeetingReturn {
  meetingState: MeetingState;
  /** Derived: duration in seconds since meeting started, null when idle. */
  duration: number | null;
  /** Convenience alias. */
  isActive: boolean;
}

/**
 * useMeeting — subscribes to meeting.state.changed and meeting.action.created events.
 * Tracks status, participants, action items and running duration.
 *
 * Follows the same batched-RAF pattern used by useEventStream to avoid
 * flooding the React scheduler during rapid event bursts.
 */
export function useMeeting(): UseMeetingReturn {
  const { eventBus } = useAicsRuntime();
  const [state, setState] = useState<MeetingState>(INITIAL_STATE);
  const [duration, setDuration] = useState<number | null>(null);

  // Keep a stable ref for the timer so we can clear it across renders.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Unique ID counter for transcript entries (no uuid dep needed).
  const entryCountRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(
    (from: number) => {
      stopTimer();
      startTimeRef.current = from;
      setDuration(Math.floor((Date.now() - from) / 1000));
      timerRef.current = setInterval(() => {
        if (startTimeRef.current !== null) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
    },
    [stopTimer],
  );

  useEffect(() => {
    // meeting.state.changed — track status + participants
    const unsubState = eventBus.on(
      'meeting.state.changed',
      (event: RuntimeEvent<MeetingStatePayload>) => {
        const { meetingId, next, participantIds } = event.payload;

        setState((prev) => {
          let newStatus: MeetingRunStatus = 'idle';
          if (next === 'running') newStatus = 'running';
          else if (next === 'paused') newStatus = 'paused';
          else if (next === 'completed' || next === 'cancelled') newStatus = 'idle';

          const nowIdle = newStatus === 'idle';
          return {
            ...prev,
            meetingId: nowIdle ? null : meetingId,
            status: newStatus,
            participantIds: nowIdle ? [] : [...participantIds],
            // Reset transcript + actions when meeting ends
            actions: nowIdle ? [] : prev.actions,
            transcript: nowIdle ? [] : prev.transcript,
            startTime:
              newStatus === 'running' && prev.status !== 'running'
                ? event.timestamp
                : prev.startTime,
          };
        });

        if (next === 'running') {
          startTimer(event.timestamp);
        } else if (next === 'paused') {
          stopTimer();
        } else if (next === 'completed' || next === 'cancelled') {
          stopTimer();
          startTimeRef.current = null;
          setDuration(null);
        }
      },
    );

    // meeting.action.created — append action items
    const unsubAction = eventBus.on(
      'meeting.action.created',
      (event: RuntimeEvent<MeetingActionCreatedPayload>) => {
        const { meetingId, actionItemId, description, assigneeEmployeeId, priority, dependsOn } =
          event.payload;

        const item: MeetingActionItem = {
          actionItemId,
          meetingId,
          description,
          assigneeEmployeeId,
          priority,
          dependsOn,
          createdAt: event.timestamp,
        };

        setState((prev) => ({
          ...prev,
          actions: [...prev.actions, item],
        }));
      },
    );

    // meeting.transcript.entry (optional supplementary event — no-op if unused)
    const unsubTranscript = eventBus.on('meeting.transcript.', (event: RuntimeEvent) => {
      const payload = event.payload as {
        participantId?: string;
        content?: string;
      };
      if (!payload?.participantId || !payload?.content) return;

      entryCountRef.current += 1;
      const entry: MeetingTranscriptEntry = {
        id: `te-${entryCountRef.current}`,
        participantId: payload.participantId,
        content: payload.content,
        timestamp: event.timestamp,
      };

      setState((prev) => ({
        ...prev,
        transcript: [...prev.transcript.slice(-99), entry],
      }));
    });

    return () => {
      unsubState();
      unsubAction();
      unsubTranscript();
      stopTimer();
    };
  }, [eventBus, startTimer, stopTimer]);

  return {
    meetingState: state,
    duration,
    isActive: state.status !== 'idle',
  };
}
