import { AlertCircle, X } from 'lucide-react';
import { Button } from '../ui/button';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <div className="flex items-center gap-3 bg-error/10 border-b border-error/30 px-4 py-2 text-sm text-error">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      {onRetry && (
        <Button variant="ghost" size="sm" className="text-error hover:text-error" onClick={onRetry}>
          Retry
        </Button>
      )}
      <button onClick={onDismiss} className="shrink-0 hover:opacity-70">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
