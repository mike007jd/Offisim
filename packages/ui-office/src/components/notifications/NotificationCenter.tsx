import { Badge, Button, ScrollArea } from '@offisim/ui-core';
import { Bell, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationCard } from './NotificationCard';

interface NotificationCenterProps {
  onFocusEmployee?: (employeeId: string) => void;
}

/**
 * Bell icon with unread badge and dropdown notification panel.
 * Placed in the Header bar.
 *
 * Self-contained: reads notification state from the shared
 * NotificationProvider context via useNotifications().
 */
export function NotificationCenter({ onFocusEmployee }: NotificationCenterProps) {
  const { notifications, unreadCount, markRead, dismiss, clearAll } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="error"
            className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[9px] flex items-center justify-center"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-1 z-50 w-72 bg-ocean-deep border border-ocean-light rounded-md shadow-lg"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-ocean-light">
            <span className="text-xs font-pixel-body text-shell font-medium">Notifications</span>
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={clearAll}
                title="Clear all"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>

          <ScrollArea className="max-h-80">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-shell/40 font-pixel-body">All clear — no pending notifications.</p>
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
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
