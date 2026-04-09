import { CheckCircle, Package, Search, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface MarketEmptyStateProps {
  readonly variant: 'no-results' | 'no-installed' | 'no-updates' | 'no-published';
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
};

export function MarketEmptyState({ variant, onAction, actionLabel }: MarketEmptyStateProps) {
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <Icon className="h-12 w-12 text-slate-500" />
      <h3 className="text-lg font-semibold text-slate-300">{config.title}</h3>
      <p className="max-w-sm text-center text-sm text-slate-500">{config.description}</p>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 rounded-lg bg-white/[0.06] px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
