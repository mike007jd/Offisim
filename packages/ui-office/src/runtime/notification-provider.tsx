import type { NotificationPayload, RuntimeEvent } from '@aics/shared-types';
import {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import type { Notification, UseNotificationsResult } from '../hooks/useNotifications';
import { useAicsRuntime } from './aics-runtime-context';

const MAX_NOTIFICATIONS = 50;

export const NotificationContext = createContext<UseNotificationsResult | null>(null);

/**
 * Single source of truth for notification state.
 *
 * Must be mounted as a child of AicsRuntimeProvider (needs EventBus).
 * All calls to useNotifications() read from this context, ensuring
 * markRead/dismiss/clearAll propagate everywhere instantly.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const previousCompanyIdRef = useRef(activeCompanyId);

  useEffect(() => {
    if (previousCompanyIdRef.current !== activeCompanyId) {
      previousCompanyIdRef.current = activeCompanyId;
      setNotifications([]);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    const off = eventBus.on('notification.', (e: RuntimeEvent<NotificationPayload>) => {
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
          return next.slice(0, MAX_NOTIFICATIONS);
        });
      }
    });
    return off;
  }, [eventBus]);

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

  const value = useMemo<UseNotificationsResult>(
    () => ({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      markRead,
      dismiss,
      clearAll,
    }),
    [notifications, markRead, dismiss, clearAll],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
