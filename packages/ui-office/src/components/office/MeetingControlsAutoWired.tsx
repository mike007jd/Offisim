import { useCallback } from 'react';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useEventStream } from '../../runtime/use-event-stream';
import { MeetingControls } from './MeetingControls';

/**
 * Auto-wired MeetingControls that reads meeting state from EventBus
 * and dispatches meeting interrupt commands via EventBus.
 */
export function MeetingControlsAutoWired() {
  const { eventBus } = useOffisimRuntime();
  const meetingEvents = useEventStream('meeting.state.changed', 1);
  const latest = meetingEvents[0] ?? null;

  const meetingId = (latest?.payload as { meetingId?: string } | undefined)?.meetingId ?? null;

  const emit = useCallback(
    (type: string, detail?: Record<string, unknown>) => {
      eventBus.emit({
        type: `meeting.interrupt.${type}`,
        entityId: meetingId ?? '',
        entityType: 'company',
        companyId: '',
        timestamp: Date.now(),
        payload: { meetingId, ...detail },
      });
    },
    [eventBus, meetingId],
  );

  return (
    <MeetingControls
      meetingId={meetingId}
      onPause={() => emit('pause')}
      onResume={() => emit('resume')}
      onEnd={() => emit('end')}
      onInject={(comment) => emit('inject', { comment })}
    />
  );
}
