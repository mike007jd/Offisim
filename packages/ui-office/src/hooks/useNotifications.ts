import { useContext } from 'react';
import { NotificationContext } from '../runtime/notification-provider';

export interface Notification {
  notificationId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  source: 'runtime' | 'market' | 'install' | 'hr';
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
 * Reads notification state from the shared NotificationProvider context.
 *
 * All consumers (NotificationCenter, Workspace system channel, etc.) share
 * a single state instance — markRead/dismiss/clearAll propagate everywhere.
 */
export function useNotifications(): UseNotificationsResult {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within <NotificationProvider>');
  }
  return ctx;
}
