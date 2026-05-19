import { useCallback } from 'react';
import type { MeetingRunStatus } from '../../hooks/useMeeting';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
import { MeetingControls } from './MeetingControls';

interface MeetingControlsAutoWiredProps {
  meetingId: string | null;
  status: MeetingRunStatus;
}

/**
 * Auto-wired MeetingControls that reads meeting state from EventBus
 * and dispatches meeting interrupt commands via EventBus.
 */
export function MeetingControlsAutoWired({ meetingId, status }: MeetingControlsAutoWiredProps) {
  const { eventBus } = useOffisimRuntimeServices();

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
      status={status}
      onPause={() => emit('pause')}
      onResume={() => emit('resume')}
      onEnd={() => emit('end')}
      onInject={(comment) => emit('inject', { comment })}
    />
  );
}
