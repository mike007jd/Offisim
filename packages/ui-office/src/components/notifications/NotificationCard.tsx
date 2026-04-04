import { Button } from '@offisim/ui-core';
import { AlertCircle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import type { Notification } from '../../hooks/useNotifications';

interface NotificationCardProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onFocusEmployee?: (employeeId: string) => void;
}

const LEVEL_STYLES: Record<Notification['level'], { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: 'text-blue-400' },
  success: { icon: CheckCircle, color: 'text-green-400' },
  warning: { icon: AlertCircle, color: 'text-yellow-400' },
  error: { icon: XCircle, color: 'text-red-400' },
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
  const { icon: Icon, color } = LEVEL_STYLES[notification.level];

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
      className={`flex items-start gap-2 p-2 border-b border-ocean-light/50 transition-colors hover:bg-ocean-deep/50 ${
        notification.read ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        className="flex flex-1 items-start gap-2 border-0 bg-transparent p-0 text-left appearance-none cursor-pointer"
        onClick={handleClick}
      >
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-pixel-body text-shell leading-tight truncate">
            {notification.title}
          </p>
          <p className="text-[10px] text-shell/60 leading-tight mt-0.5 line-clamp-2">
            {notification.message}
          </p>
          <span className="text-[10px] text-shell/40 mt-0.5 block">
            {formatTimestamp(notification.timestamp)}
          </span>
        </div>
      </button>
      {notification.dismissable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-4 w-4 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.notificationId);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
