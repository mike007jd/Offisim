import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@offisim/ui-core';
import {
  ClipboardCheck,
  Lightbulb,
  MessageSquarePlus,
  Pause,
  Play,
  Rocket,
  Square,
  Users,
} from 'lucide-react';
import { useCallback, useState } from 'react';

export type MeetingStatus = 'idle' | 'running' | 'paused';

export interface MeetingControlsProps {
  /** Current meeting ID, null when no meeting is active. */
  meetingId: string | null;
  /** Current meeting status when managed by a parent hook. */
  status?: MeetingStatus;
  /** Called when boss wants to pause the meeting. */
  onPause: () => void;
  /** Called when boss wants to resume a paused meeting. */
  onResume: () => void;
  /** Called when boss wants to end the meeting immediately. */
  onEnd: () => void;
  /** Called when boss wants to inject a comment into the meeting. */
  onInject: (comment: string) => void;
  /** Called when boss changes the meeting type selection. */
  onMeetingTypeChange?: (type: MeetingType) => void;
}

const STATUS_VARIANTS: Record<MeetingStatus, 'default' | 'success' | 'warning'> = {
  idle: 'default',
  running: 'success',
  paused: 'warning',
};

const STATUS_LABELS: Record<MeetingStatus, string> = {
  idle: 'No active meeting',
  running: 'In progress',
  paused: 'Paused',
};

const MEETING_TYPES = [
  { value: 'brainstorm', label: 'Brainstorm', Icon: Lightbulb },
  { value: 'kickoff', label: 'Kickoff', Icon: Rocket },
  { value: 'standup', label: 'Standup', Icon: Users },
  { value: 'review', label: 'Review', Icon: ClipboardCheck },
] as const;

export type MeetingType = (typeof MEETING_TYPES)[number]['value'];

/**
 * MeetingControls — boss-facing meeting control panel.
 *
 * Renders Pause / Resume / End / Inject buttons based on the
 * current meeting status. Listens to meeting.state.changed events
 * to track status automatically.
 */
export function MeetingControls({
  meetingId,
  status: statusProp,
  onPause,
  onResume,
  onEnd,
  onInject,
  onMeetingTypeChange,
}: MeetingControlsProps) {
  const [injectText, setInjectText] = useState('');
  const [showInjectInput, setShowInjectInput] = useState(false);
  const [meetingType, setMeetingType] = useState<MeetingType>('brainstorm');

  const handleMeetingTypeChange = useCallback(
    (type: MeetingType) => {
      setMeetingType(type);
      onMeetingTypeChange?.(type);
    },
    [onMeetingTypeChange],
  );

  const status: MeetingStatus = statusProp ?? (meetingId ? 'running' : 'idle');

  const handleInjectSubmit = useCallback(() => {
    const trimmed = injectText.trim();
    if (trimmed) {
      onInject(trimmed);
      setInjectText('');
      setShowInjectInput(false);
    }
  }, [injectText, onInject]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleInjectSubmit();
      }
      if (e.key === 'Escape') {
        setShowInjectInput(false);
        setInjectText('');
      }
    },
    [handleInjectSubmit],
  );

  if (status === 'idle') return null;

  return (
    <Card className="meeting-controls">
      <CardHeader className="meeting-controls-header">
        <div>
          <CardTitle>Meeting</CardTitle>
          <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="meeting-controls-body">
          {/* Meeting type selector */}
          <div className="meeting-controls-types">
            {MEETING_TYPES.map(({ value, label, Icon }) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleMeetingTypeChange(value)}
                className="meeting-controls-type"
                data-active={meetingType === value ? 'true' : 'false'}
              >
                <Icon data-icon="inline-start" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
          <div className="meeting-controls-actions">
            {status === 'running' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onPause}
                  title="Pause meeting"
                  className="meeting-controls-action"
                >
                  <Pause data-icon="inline-start" aria-hidden="true" />
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEnd}
                  title="End meeting"
                  className="meeting-controls-action"
                >
                  <Square data-icon="inline-start" aria-hidden="true" />
                  End
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowInjectInput((prev) => !prev)}
                  title="Inject comment"
                  className="meeting-controls-action"
                >
                  <MessageSquarePlus data-icon="inline-start" aria-hidden="true" />
                  Comment
                </Button>
              </>
            )}
            {status === 'paused' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onResume}
                  title="Resume meeting"
                  className="meeting-controls-action"
                >
                  <Play data-icon="inline-start" aria-hidden="true" />
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEnd}
                  title="End meeting"
                  className="meeting-controls-action"
                >
                  <Square data-icon="inline-start" aria-hidden="true" />
                  End
                </Button>
              </>
            )}
          </div>
          {showInjectInput && status === 'running' && (
            <div className="meeting-controls-inject">
              <Input
                type="text"
                className="meeting-controls-input"
                placeholder="Type your comment..."
                value={injectText}
                onChange={(e) => setInjectText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button
                size="sm"
                variant="default"
                onClick={handleInjectSubmit}
                disabled={!injectText.trim()}
              >
                Send
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
