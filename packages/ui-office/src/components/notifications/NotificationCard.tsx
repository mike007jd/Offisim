import { Button } from '@offisim/ui-core';
import { AlertCircle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import type { Notification } from '../../hooks/useNotifications';

interface NotificationCardProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onFocusEmployee?: (employeeId: string) => void;
}

const LEVEL_ICONS: Record<Notification['level'], typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertCircle,
  error: XCircle,
};

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationCard({
  notification,
  onDismiss,
  onMarkRead,
  onFocusEmployee,
}: NotificationCardProps) {
  const Icon = LEVEL_ICONS[notification.level];

  const handleClick = () => {
    if (!notification.read) {
      onMarkRead(notification.notificationId);
    }
    if (notification.employeeId && onFocusEmployee) {
      onFocusEmployee(notification.employeeId);
    }
  };

  return (
    <div
      className="notification-card"
      data-level={notification.level}
      data-read={notification.read ? 'true' : 'false'}
    >
      <Button
        type="button"
        variant="ghost"
        className="notification-card-main"
        onClick={handleClick}
      >
        <Icon data-icon="notification-level" aria-hidden="true" />
        <div data-slot="copy">
          <p data-slot="title">{notification.title}</p>
          <p data-slot="message">{notification.message}</p>
          <span data-slot="time">{formatTimestamp(notification.timestamp)}</span>
        </div>
      </Button>
      {notification.dismissable && (
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          className="notification-card-dismiss"
          aria-label="Dismiss notification"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.notificationId);
          }}
        >
          <X data-icon="notification-dismiss" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
