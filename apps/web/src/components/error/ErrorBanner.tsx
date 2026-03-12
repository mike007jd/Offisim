import { AlertCircle, X } from 'lucide-react';
import { Button } from '../ui/button';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <div className="flex items-center gap-3 bg-lobster-red/10 border-b-2 border-lobster-red/30 px-4 py-2 text-sm text-lobster-red">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          className="text-lobster-red hover:text-lobster-red"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 hover:opacity-70"
        aria-label="Dismiss error"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
