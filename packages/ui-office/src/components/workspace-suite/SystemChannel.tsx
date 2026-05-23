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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-line-soft px-2 pr-3">
        <span className="grid size-8 place-items-center rounded-r-sm bg-violet-surface text-violet ring-1 ring-line">
          <Sparkles className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-fs-base font-semibold text-ink-1">System</div>
          <div className="text-fs-micro font-medium text-ink-3">
            Notifications · runtime · hr · market · install
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clearAll}
            title="Mark all read"
            aria-label="Mark all read"
            className="grid size-8 place-items-center rounded-r-sm text-ink-3 transition-colors hover:bg-surface-sunken hover:text-ink-1"
          >
            <Check className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenActivityLog?.()}
            title="Open Activity Log"
            aria-label="Open Activity Log"
            className="grid size-8 place-items-center rounded-r-sm text-ink-3 transition-colors hover:bg-surface-sunken hover:text-ink-1"
          >
            <Activity className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        {notifications.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-fs-sm text-ink-4">
            All clear — no system notifications.
          </div>
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

      <div className="flex items-center justify-center gap-1.5 border-t border-line bg-surface-2 px-5 py-2.5 text-fs-meta text-ink-4">
        <Shield className="size-3" aria-hidden="true" />
        System channel is read-only — actions live on each card
      </div>
    </div>
  );
}
