import {
  ListRow,
  ListRowAvatar,
  ListRowMeta,
  ListRowSubtitle,
  ListRowTitle,
} from '@/components/ListRow.js';
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
      <ListRow as="div" className="off-ws-msg-row">
        <ListRowAvatar className="off-ws-msg-from">
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
          <ListRowTitle className="off-ws-msg-nm">{name}</ListRowTitle>
        </ListRowAvatar>
        <ListRowSubtitle as="div" className="off-ws-bubble is-thinking">
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
        </ListRowSubtitle>
      </ListRow>
    );
  }
  return (
    <ListRow as="div" selected={isMe} selectedClassName="is-me" className="off-ws-msg-row">
      {!isMe ? (
        <ListRowAvatar className="off-ws-msg-from">
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
          <ListRowTitle className="off-ws-msg-nm">{name}</ListRowTitle>
          {row.status === 'failed' ? <span className="off-ws-msg-rl">failed</span> : null}
          {row.status === 'interrupted' ? <span className="off-ws-msg-rl">stopped</span> : null}
        </ListRowAvatar>
      ) : null}
      {row.body.trim() ? (
        <ListRowSubtitle as="div" className={cn('off-ws-bubble', isMe && 'is-me')}>
          {row.body}
        </ListRowSubtitle>
      ) : row.status === 'failed' ? (
        <ListRowSubtitle as="div" className="off-ws-bubble off-connect-bubble-err">
          {row.error || 'This reply failed.'}
        </ListRowSubtitle>
      ) : null}
      {timeLabel ? (
        <ListRowMeta
          className="off-ws-bubble-time"
          title={new Date(row.createdAt).toLocaleString()}
        >
          {timeLabel}
        </ListRowMeta>
      ) : null}
      {row.status === 'failed' && onRetry ? (
        <button type="button" className="off-connect-retry off-focusable" onClick={onRetry}>
          <Icon icon={RotateCw} size="sm" />
          Retry
        </button>
      ) : null}
    </ListRow>
  );
}
