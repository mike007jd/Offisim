import type { NotificationPayload, RuntimeEvent } from '@aics/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

const MAX_NOTIFICATIONS = 50;

export interface Notification {
  notificationId: string;
  level: NotificationPayload['level'];
  title: string;
  message: string;
  source: NotificationPayload['source'];
  actionUrl?: string;
  employeeId?: string;
  dismissable: boolean;
  timestamp: number;
  read: boolean;
}

export interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

/**
 * Subscribes to `notification.created` events on the EventBus and maintains
 * a notification queue with read/unread tracking.
 *
 * Max 50 notifications, FIFO eviction.
 */
export function useNotifications(): UseNotificationsResult {
  const { eventBus } = useAicsRuntime();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const off = eventBus.on(
      'notification.',
      (e: RuntimeEvent<NotificationPayload>) => {
        if (e.type === 'notification.created') {
          setNotifications((prev) => {
            const next = [
              {
                notificationId: e.payload.notificationId,
                level: e.payload.level,
                title: e.payload.title,
                message: e.payload.message,
                source: e.payload.source,
                actionUrl: e.payload.actionUrl,
                employeeId: e.payload.employeeId,
                dismissable: e.payload.dismissable,
                timestamp: e.payload.timestamp,
                read: false,
              },
              ...prev,
            ];
            // FIFO eviction: keep most recent MAX_NOTIFICATIONS
            return next.slice(0, MAX_NOTIFICATIONS);
          });
        }
      },
    );
    return off;
  }, [eventBus]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.notificationId === id ? { ...n, read: true } : n)),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.notificationId !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return { notifications, unreadCount, markRead, dismiss, clearAll };
}
