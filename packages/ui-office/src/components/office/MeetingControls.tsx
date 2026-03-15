import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@aics/ui-core';
import { MessageSquarePlus, Pause, Play, Square } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useEventStream } from '../../runtime/use-event-stream';

export type MeetingStatus = 'idle' | 'running' | 'paused';

export interface MeetingControlsProps {
  /** Current meeting ID, null when no meeting is active. */
  meetingId: string | null;
  /** Called when boss wants to pause the meeting. */
  onPause: () => void;
  /** Called when boss wants to resume a paused meeting. */
  onResume: () => void;
  /** Called when boss wants to end the meeting immediately. */
  onEnd: () => void;
  /** Called when boss wants to inject a comment into the meeting. */
  onInject: (comment: string) => void;
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

/**
 * MeetingControls — boss-facing meeting control panel.
 *
 * Renders Pause / Resume / End / Inject buttons based on the
 * current meeting status. Listens to meeting.state.changed events
 * to track status automatically.
 */
export function MeetingControls({
  meetingId,
  onPause,
  onResume,
  onEnd,
  onInject,
}: MeetingControlsProps) {
  const [injectText, setInjectText] = useState('');
  const [showInjectInput, setShowInjectInput] = useState(false);

  // Derive meeting status from events
  const meetingEvents = useEventStream('meeting.state.changed');
  const latestEvent = meetingEvents.length > 0 ? meetingEvents[meetingEvents.length - 1] : null;

  let status: MeetingStatus = 'idle';
  if (meetingId && latestEvent) {
    const payload = latestEvent.payload as { next: string };
    if (payload.next === 'running') status = 'running';
    else if (payload.next === 'paused') status = 'paused';
    else if (payload.next === 'completed' || payload.next === 'cancelled') status = 'idle';
  } else if (meetingId) {
    status = 'running';
  }

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
    <Card className="border-shell/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-pixel-display uppercase tracking-wider text-shell">
            Meeting
          </CardTitle>
          <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {status === 'running' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onPause}
                  title="Pause meeting"
                  className="gap-1"
                >
                  <Pause className="h-3 w-3" />
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEnd}
                  title="End meeting"
                  className="gap-1"
                >
                  <Square className="h-3 w-3" />
                  End
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowInjectInput((prev) => !prev)}
                  title="Inject comment"
                  className="gap-1"
                >
                  <MessageSquarePlus className="h-3 w-3" />
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
                  className="gap-1"
                >
                  <Play className="h-3 w-3" />
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEnd}
                  title="End meeting"
                  className="gap-1"
                >
                  <Square className="h-3 w-3" />
                  End
                </Button>
              </>
            )}
          </div>
          {showInjectInput && status === 'running' && (
            <div className="flex gap-1.5">
              <input
                type="text"
                className="flex-1 rounded border border-shell/20 bg-transparent px-2 py-1 text-xs text-shell placeholder:text-shell/40 focus:outline-none focus:ring-1 focus:ring-shell/40"
                placeholder="Type your comment..."
                value={injectText}
                onChange={(e) => setInjectText(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
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
