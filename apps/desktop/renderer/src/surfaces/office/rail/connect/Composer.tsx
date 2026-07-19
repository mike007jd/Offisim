import { ComposerSettingsMenu } from '@/assistant/composer/ComposerSettingsMenu.js';
import type { Employee } from '@/data/types.js';
import { ChatComposerInput } from '@/design-system/grammar/ChatComposerInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { parseMentions } from '@/runtime/collaboration/collaboration-context.js';
import type { CollaborationReplyPolicy } from '@offisim/shared-types';
import { RotateCw, SendHorizontal, Square, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ConnectEnhanceButton } from './ConnectEnhanceButton.js';

export function Composer({
  threadId,
  threadTitle,
  scope,
  replyPolicy,
  employees,
  participantIds,
  running,
  roundInfo,
  onSend,
  onStartRound,
  onContinueRound,
  onStop,
  onAskTeam,
}: {
  threadId: string | null;
  threadTitle: string;
  scope: 'direct' | 'group';
  replyPolicy: CollaborationReplyPolicy;
  employees: readonly Employee[];
  participantIds: string[];
  running: boolean;
  roundInfo: {
    lastRound: { roundId: string; completed: boolean } | null;
    speakerLimit: number;
    /** Whether a boss-authored message exists to continue the round from. */
    hasBossTrigger: boolean;
  } | null;
  onSend: (body: string) => Promise<void>;
  onStartRound: (body: string) => Promise<void>;
  onContinueRound: () => Promise<void>;
  onStop: () => void;
  onAskTeam: (() => void) | null;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const isRoundtable = scope === 'group' && replyPolicy === 'roundtable';

  // Participants the composer can @mention (group members / the direct employee).
  const mentionParticipants = useMemo(
    () =>
      participantIds
        .map((id) => employees.find((e) => e.id === id))
        .filter((e): e is Employee => e != null)
        .map((e) => ({ employeeId: e.id, name: e.name })),
    [participantIds, employees],
  );
  const mentioned = useMemo(
    () => parseMentions(text, mentionParticipants),
    [text, mentionParticipants],
  );

  async function doSend(): Promise<void> {
    if (!trimmed || sending) return;
    const body = text;
    setSending(true);
    setError(null);
    try {
      if (isRoundtable) await onStartRound(body);
      else await onSend(body);
      setText('');
    } catch (err) {
      // Send failure: keep the text + surface a Retry.
      setError(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void doSend();
    }
  }

  const sendDisabled = !trimmed || sending;
  // mentions-only group with no mention: Send just posts (no auto-fire); offer
  // Ask team as the explicit responder action.
  const showAskTeam =
    scope === 'group' && replyPolicy === 'mentions_only' && mentioned.length === 0 && !!onAskTeam;

  return (
    <div className="off-ws-composer off-connect-composer">
      {error ? (
        <div className="off-connect-send-error">
          <span>{error}</span>
          <button
            type="button"
            className="off-connect-retry off-focusable"
            onClick={() => void doSend()}
          >
            <Icon icon={RotateCw} size="sm" />
            Retry
          </button>
        </div>
      ) : null}
      {roundInfo ? (
        <div className="off-connect-round-bar">
          <span className="off-connect-round-info">
            Roundtable · up to {roundInfo.speakerLimit} speaker
            {roundInfo.speakerLimit === 1 ? '' : 's'}
            {roundInfo.lastRound?.completed ? ' · round capped' : ''}
          </span>
          {roundInfo.lastRound?.completed && roundInfo.hasBossTrigger ? (
            <button
              type="button"
              className="off-connect-btn is-primary off-focusable"
              disabled={running}
              onClick={() => void onContinueRound()}
            >
              Continue round
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="off-ws-composer-shell">
        <div className="off-ws-input-wrap">
          <ChatComposerInput
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isRoundtable
                ? 'Message the team, then Start round…'
                : scope === 'group'
                  ? 'Message the team — @mention to ask someone…'
                  : 'Message…'
            }
            aria-label="Message"
          />
          <ConnectEnhanceButton
            threadId={threadId}
            value={text}
            threadTitle={threadTitle}
            scope={scope}
            employees={employees}
            onApply={setText}
          />
        </div>
        <div className="off-ws-composer-footer">
          <div className="off-ws-composer-footer-start">
            {showAskTeam ? (
              <button
                type="button"
                className="off-connect-ask off-focusable"
                onClick={onAskTeam ?? undefined}
                disabled={running}
                title="Ask team"
              >
                <Icon icon={Users} size="sm" />
                Ask team
              </button>
            ) : null}
            {threadId ? <ComposerSettingsMenu threadId={threadId} showMode={false} /> : null}
          </div>
          <div className="off-ws-composer-footer-end">
            {running ? (
              <button
                type="button"
                className="off-ws-send off-connect-stop off-focusable"
                onClick={onStop}
                aria-label="Stop"
                title="Stop"
              >
                <Icon icon={Square} size="sm" />
              </button>
            ) : (
              <button
                type="button"
                className="off-ws-send off-focusable"
                onClick={() => void doSend()}
                disabled={sendDisabled}
                aria-label={isRoundtable ? 'Send and start round' : 'Send'}
                title={isRoundtable ? 'Send and start round' : 'Send'}
              >
                <Icon icon={SendHorizontal} size="sm" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
