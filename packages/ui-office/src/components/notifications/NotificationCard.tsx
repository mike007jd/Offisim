import { Button, cn } from '@offisim/ui-core';
import { AlertCircle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import type { Notification } from '../../hooks/useNotifications';

interface NotificationCardProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onFocusEmployee?: (employeeId: string) => void;
}

const LEVEL_STYLES: Record<Notification['level'], { icon: typeof Info; iconClassName: string }> = {
  info: { icon: Info, iconClassName: 'text-accent' },
  success: { icon: CheckCircle, iconClassName: 'text-ok' },
  warning: { icon: AlertCircle, iconClassName: 'text-warn' },
  error: { icon: XCircle, iconClassName: 'text-danger' },
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
  const { icon: Icon, iconClassName } = LEVEL_STYLES[notification.level];

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
      className={cn(
        'flex items-start gap-2 border-b border-line-soft p-2 transition-colors hover:bg-surface-sunken',
        notification.read ? 'opacity-60' : '',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-auto flex-1 items-start justify-start gap-2 rounded-none p-0 text-left"
        onClick={handleClick}
      >
        <Icon className={cn('mt-0.5 size-4 shrink-0', iconClassName)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium leading-tight text-ink-1">
            {notification.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-fs-micro leading-tight text-ink-3">
            {notification.message}
          </p>
          <span className="mt-0.5 block text-fs-micro text-ink-3">
            {formatTimestamp(notification.timestamp)}
          </span>
        </div>
      </Button>
      {notification.dismissable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-4 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.notificationId);
          }}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
