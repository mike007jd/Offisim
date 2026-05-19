import type { NotificationPayload, RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, type ToastItem } from '@offisim/ui-core';
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
import { useOffisimRuntimeServices } from './offisim-runtime-context';

const MAX_NOTIFICATIONS = 50;
const MAX_TOASTS = 4;

export const NotificationContext = createContext<UseNotificationsResult | null>(null);

/**
 * Single source of truth for notification state.
 *
 * Must be mounted as a child of OffisimRuntimeProvider (needs EventBus).
 * All calls to useNotifications() read from this context, ensuring
 * markRead/dismiss/clearAll propagate everywhere instantly.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const previousCompanyIdRef = useRef(activeCompanyId);

  useEffect(() => {
    if (previousCompanyIdRef.current !== activeCompanyId) {
      previousCompanyIdRef.current = activeCompanyId;
      setNotifications([]);
      setToasts([]);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    const off = eventBus.on('notification.', (e: RuntimeEvent<NotificationPayload>) => {
      if (e.type === 'notification.created') {
        const notification: Notification = {
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
        };
        setNotifications((prev) => {
          const next = [notification, ...prev];
          return next.slice(0, MAX_NOTIFICATIONS);
        });
        setToasts((prev) =>
          [
            {
              id: e.payload.notificationId,
              title: e.payload.title,
              message: e.payload.message,
              variant: e.payload.level,
            },
            ...prev.filter((toast) => toast.id !== e.payload.notificationId),
          ].slice(0, MAX_TOASTS),
        );
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

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
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

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastBanner toasts={toasts} onDismiss={dismissToast} durationMs={4_000} />
    </NotificationContext.Provider>
  );
}
