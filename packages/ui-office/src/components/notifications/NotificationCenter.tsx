import { Button, ScrollArea, cn } from '@offisim/ui-core';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative size-7 rounded-full bg-surface-1/80 text-ink-4 shadow-elev-1 backdrop-blur-sm hover:border-line-strong hover:text-ink-2"
      >
        <span
          aria-hidden="true"
          className={cn('size-1.5 rounded-full', unreadCount > 0 ? 'bg-danger' : 'bg-ink-4')}
        />
      </Button>

      {isOpen && (
        <div className="absolute bottom-9 right-0 z-50 w-72 overflow-hidden rounded-r-lg border border-line-strong bg-surface-1 shadow-elev-3">
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5">
            <span className="text-fs-micro font-bold uppercase tracking-wide text-ink-3">
              Notifications
            </span>
            {notifications.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="grid size-5 place-items-center rounded-r-sm text-ink-4 transition-colors hover:bg-surface-sunken hover:text-ink-2"
                onClick={clearAll}
                title="Clear all"
                aria-label="Clear all notifications"
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>

          <ScrollArea className="max-h-80">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-fs-meta text-ink-4">All clear — no pending notifications.</p>
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

          <div className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-2">
            <p className="text-fs-meta text-ink-4">Full history lives in Activity Log.</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsOpen(false);
                onOpenActivityLog?.();
              }}
              aria-label="Open activity log"
              className={cn(
                'h-7 shrink-0 rounded-r-sm px-2 text-fs-meta font-semibold text-accent',
                'transition-colors hover:bg-accent-surface',
              )}
            >
              Open Activity Log
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
