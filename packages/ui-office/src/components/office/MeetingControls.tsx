import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  cn,
} from '@offisim/ui-core';
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
    <Card className="border-line-soft">
      <CardHeader className="pb-sp-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-fs-sm uppercase tracking-ls-caps text-ink-3">
            Meeting
          </CardTitle>
          <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-sp-2">
          {/* Meeting type selector */}
          <div className="flex gap-sp-1">
            {MEETING_TYPES.map(({ value, label, Icon }) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleMeetingTypeChange(value)}
                className={cn(
                  'h-7 gap-sp-1 rounded-r-sm px-sp-2 text-fs-micro',
                  meetingType === value
                    ? 'border border-focus bg-accent-surface text-accent'
                    : 'border border-transparent text-ink-3 hover:text-ink-2',
                )}
              >
                <Icon className="size-3" />
                {label}
              </Button>
            ))}
          </div>
          <div className="flex gap-sp-1">
            {status === 'running' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onPause}
                  title="Pause meeting"
                  className="gap-sp-1"
                >
                  <Pause className="size-3" />
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEnd}
                  title="End meeting"
                  className="gap-sp-1"
                >
                  <Square className="size-3" />
                  End
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowInjectInput((prev) => !prev)}
                  title="Inject comment"
                  className="gap-sp-1"
                >
                  <MessageSquarePlus className="size-3" />
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
                  className="gap-sp-1"
                >
                  <Play className="size-3" />
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEnd}
                  title="End meeting"
                  className="gap-sp-1"
                >
                  <Square className="size-3" />
                  End
                </Button>
              </>
            )}
          </div>
          {showInjectInput && status === 'running' && (
            <div className="flex gap-sp-1">
              <Input
                type="text"
                className="h-8 flex-1 border-line-soft bg-transparent px-sp-2 py-sp-1 text-fs-micro text-ink-2 placeholder:text-ink-3 focus:border-focus"
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
