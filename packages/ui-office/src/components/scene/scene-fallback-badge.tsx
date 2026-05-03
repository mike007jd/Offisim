import { badgeVariants, cn } from '@offisim/ui-core';

interface SceneFallbackBadgeProps {
  onRetry: () => void;
}

export function SceneFallbackBadge({ onRetry }: SceneFallbackBadgeProps) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className={cn(
        badgeVariants({ variant: 'warning', size: 'sm' }),
        'absolute right-3 bottom-3 z-10 gap-2 transition-opacity hover:opacity-80',
      )}
    >
      <span>3D unavailable</span>
      <span aria-hidden>·</span>
      <span className="font-semibold">Retry</span>
    </button>
  );
}
