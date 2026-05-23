import { EmptyState } from '@offisim/ui-core';
import { CheckCircle, Package, Search, Upload, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface MarketEmptyStateProps {
  readonly variant: 'no-results' | 'no-installed' | 'no-updates' | 'no-published' | 'unavailable';
  readonly onAction: () => void;
  readonly actionLabel: string;
}

const VARIANT_CONFIG: Record<
  MarketEmptyStateProps['variant'],
  { icon: LucideIcon; title: string; description: string }
> = {
  'no-results': {
    icon: Search,
    title: 'No packages found',
    description: 'Try adjusting your search or filters to find what you need.',
  },
  'no-installed': {
    icon: Package,
    title: 'No packages installed',
    description: 'Browse the store to discover and install packages for your workspace.',
  },
  'no-updates': {
    icon: CheckCircle,
    title: 'All packages up to date',
    description: 'Every installed package is running the latest version.',
  },
  'no-published': {
    icon: Upload,
    title: 'No published packages',
    description: 'Share your creations with the community by publishing a package.',
  },
  unavailable: {
    icon: WifiOff,
    title: 'No cached packages',
    description: 'The marketplace service is offline and there are no cached listings to show.',
  },
};

export function MarketEmptyState({ variant, onAction, actionLabel }: MarketEmptyStateProps) {
  const config = VARIANT_CONFIG[variant];
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={config.icon}
        title={config.title}
        description={config.description}
        primaryAction={actionLabel ? { label: actionLabel, onClick: onAction } : undefined}
      />
    </div>
  );
}
