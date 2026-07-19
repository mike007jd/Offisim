import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { RotateCw, Square } from 'lucide-react';
import type { ConnectViewMessage } from './collaboration-data.js';

import { timeLabelFrom } from './ThreadRow.js';
export interface TranscriptRow extends ConnectViewMessage {
  /** A live speaker turn id, when this row is the in-flight stream for a turn. */
  turnId?: string;
  /** True when this row is the synthetic single-pending placeholder. */
  pending?: boolean;
  /** Live error to surface a Retry control. */
  error?: string;
}

export function MessageRow({
  row,
  employee,
  onRetry,
  onStop,
}: {
  row: TranscriptRow;
  employee: Employee | null;
  onRetry?: () => void;
  onStop?: () => void;
}) {
  const isMe = row.author === 'boss';
  const name = isMe ? 'You' : (employee?.name ?? row.senderLabel ?? 'Teammate');
  // Persisted rows carry an ISO createdAt; live streaming rows carry '' (no
  // stamp until the row persists), so the label simply hides for them.
  const timeLabel = timeLabelFrom(row.createdAt);
  if (row.pending) {
    return (
      <div className="off-ws-msg-row">
        <span className="off-ws-msg-from">
          {employee ? (
            <EmployeeAvatar
              seed={employee.id}
              appearance={employee.appearance}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={22}
              brand={employee.kind === 'external'}
            />
          ) : null}
          <span className="off-ws-msg-nm">{name}</span>
        </span>
        <div className="off-ws-bubble is-thinking">
          <span className="off-ws-thinking-dots" aria-label="Typing">
            <i />
            <i />
            <i />
          </span>
          {onStop ? (
            <button type="button" className="off-connect-turn-stop off-focusable" onClick={onStop}>
              <Icon icon={Square} size="sm" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('off-ws-msg-row', isMe && 'is-me')}>
      {!isMe ? (
        <span className="off-ws-msg-from">
          {employee ? (
            <EmployeeAvatar
              seed={employee.id}
              appearance={employee.appearance}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={22}
              brand={employee.kind === 'external'}
            />
          ) : null}
          <span className="off-ws-msg-nm">{name}</span>
          {row.status === 'failed' ? <span className="off-ws-msg-rl">failed</span> : null}
          {row.status === 'interrupted' ? <span className="off-ws-msg-rl">stopped</span> : null}
        </span>
      ) : null}
      {row.body.trim() ? (
        <div className={cn('off-ws-bubble', isMe && 'is-me')}>{row.body}</div>
      ) : row.status === 'failed' ? (
        <div className="off-ws-bubble off-connect-bubble-err">
          {row.error || 'This reply failed.'}
        </div>
      ) : null}
      {timeLabel ? (
        <span className="off-ws-bubble-time" title={new Date(row.createdAt).toLocaleString()}>
          {timeLabel}
        </span>
      ) : null}
      {row.status === 'failed' && onRetry ? (
        <button type="button" className="off-connect-retry off-focusable" onClick={onRetry}>
          <Icon icon={RotateCw} size="sm" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
