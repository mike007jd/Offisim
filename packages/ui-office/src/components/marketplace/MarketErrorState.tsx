import { ErrorState } from '@offisim/ui-core';
import { WifiOff } from 'lucide-react';

export interface MarketErrorStateProps {
  readonly error: string;
  readonly onRetry: () => void;
  readonly onBack?: () => void;
  readonly cachedCount?: number;
  readonly variant?: 'center' | 'banner';
}

/**
 * Market unavailable state. The Market surface depends on the platform API; we
 * surface the dependency + retry path at user level rather than dumping raw
 * transport errors.
 */
export function MarketErrorState({
  error,
  onRetry,
  onBack,
  cachedCount,
  variant = 'center',
}: MarketErrorStateProps) {
  const cachedHint =
    cachedCount && cachedCount > 0
      ? ` Showing ${cachedCount} cached listing${cachedCount === 1 ? '' : 's'} below.`
      : '';

  return (
    <div
      className={
        variant === 'banner' ? 'p-sp-7 pb-0' : 'flex h-full items-center justify-center p-6'
      }
    >
      <ErrorState
        variant={variant === 'banner' ? 'banner' : 'default'}
        icon={WifiOff}
        title="Market is unavailable"
        reason={`We couldn't reach the marketplace service. Check that the platform is running or try again in a moment.${cachedHint}`}
        technicalDetail={error}
        retry={{ label: 'Retry', onClick: onRetry }}
        secondaryAction={onBack ? { label: 'Back to Office', onClick: onBack } : undefined}
      />
    </div>
  );
}
