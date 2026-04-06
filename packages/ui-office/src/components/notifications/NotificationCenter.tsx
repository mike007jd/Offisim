import { Badge, Button, ScrollArea } from '@offisim/ui-core';
import { Bell, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationCard } from './NotificationCard';

interface NotificationCenterProps {
  onFocusEmployee?: (employeeId: string) => void;
  onOpenActivityLog?: () => void;
}

/**
 * Bell icon with unread badge and dropdown notification panel.
 * Placed in the Header bar.
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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="error"
            className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[10px] flex items-center justify-center"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <div className="absolute right-full top-1/2 z-50 mr-2 w-72 -translate-y-1/2 rounded-md border border-ocean-light bg-ocean-deep shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ocean-light">
            <span className="text-xs font-pixel-body text-shell font-medium">Notifications</span>
            <div className="flex items-center gap-1">
              {onOpenActivityLog && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenActivityLog();
                  }}
                >
                  Activity Log
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={clearAll}
                  title="Clear all"
                  aria-label="Clear all notifications"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="max-h-80">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-shell/40 font-pixel-body">
                  All clear — no pending notifications.
                </p>
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
