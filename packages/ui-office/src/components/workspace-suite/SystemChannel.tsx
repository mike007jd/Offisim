import { Button } from '@offisim/ui-core';
import { Activity, Check, Shield, Sparkles } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationCard } from '../notifications/NotificationCard';

export interface SystemChannelProps {
  onFocusEmployee?: (employeeId: string) => void;
  onOpenActivityLog?: () => void;
}

/**
 * System bot channel — the existing NotificationCenter feed re-surfaced as a
 * read-only chat channel. Same `NotificationPayload` source (runtime / hr /
 * market / install · info / success / warning / error). The channel itself is
 * read-only; each card's actions live on the card and route to the owning
 * surface. No new data source.
 */
export function SystemChannel({ onFocusEmployee, onOpenActivityLog }: SystemChannelProps) {
  const { notifications, markRead, dismiss, clearAll } = useNotifications();

  return (
    <div className="system-channel">
      <div className="system-channel-head">
        <span className="system-channel-avatar">
          <Sparkles data-icon="avatar" aria-hidden="true" />
        </span>
        <div className="system-channel-copy">
          <div className="system-channel-title">System</div>
          <div className="system-channel-meta">Notifications · runtime · hr · market · install</div>
        </div>
        <div className="system-channel-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clearAll}
            title="Mark all read"
            aria-label="Mark all read"
            className="system-channel-action"
          >
            <Check data-icon="action" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenActivityLog?.()}
            title="Open Activity Log"
            aria-label="Open Activity Log"
            className="system-channel-action"
          >
            <Activity data-icon="action" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="system-channel-feed">
        {notifications.length === 0 ? (
          <div className="system-channel-empty">All clear — no system notifications.</div>
        ) : (
          notifications.map((n) => (
            <NotificationCard
              key={n.notificationId}
              notification={n}
              onDismiss={dismiss}
              onMarkRead={markRead}
              onFocusEmployee={onFocusEmployee}
            />
          ))
        )}
      </div>

      <div className="system-channel-foot">
        <Shield data-icon="foot" aria-hidden="true" />
        System channel is read-only — actions live on each card
      </div>
    </div>
  );
}
