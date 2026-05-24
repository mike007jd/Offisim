import {
  Button,
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  cn,
} from '@offisim/ui-core';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationCard } from './NotificationCard';

interface NotificationCenterProps {
  onFocusEmployee?: (employeeId: string) => void;
  onOpenActivityLog?: () => void;
}

/**
 * Diegetic notification surface (V3): a quiet round button anchored beside the
 * stage cost readout — no bell+count header chrome, no status-bar count segment.
 * Unread state is a small quiet dot only. The list opens as a popover reusing
 * the existing notification cards.
 *
 * Self-contained: reads notification state from the shared
 * NotificationProvider context via useNotifications().
 */
export function NotificationCenter({
  onFocusEmployee,
  onOpenActivityLog,
}: NotificationCenterProps) {
  const { notifications, unreadCount, markRead, dismiss, clearAll } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="iconSm"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          className="notification-trigger"
        >
          <span
            aria-hidden="true"
            className={cn('notification-trigger-dot', unreadCount > 0 && 'is-unread')}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="notification-popover"
        stackId="notification-center"
      >
        <div className="notification-popover-head">
          <span data-slot="title">Notifications</span>
          {notifications.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              className="notification-clear-button"
              onClick={clearAll}
              title="Clear all"
              aria-label="Clear all notifications"
            >
              <Trash2 data-icon="inline-start" />
            </Button>
          )}
        </div>

        <ScrollArea className="notification-list">
          {notifications.length === 0 ? (
            <EmptyState
              title="All clear"
              description="No pending notifications."
              variant="compact"
            />
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
        </ScrollArea>

        <div className="notification-popover-foot">
          <p>Full history lives in Activity Log.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsOpen(false);
              onOpenActivityLog?.();
            }}
            aria-label="Open activity log"
            className="notification-activity-button"
          >
            Open Activity Log
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
