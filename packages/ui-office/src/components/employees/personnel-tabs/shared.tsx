import { EmptyState } from '@offisim/ui-core';
import type { ReactNode } from 'react';

interface PlaceholderTabProps {
  title: string;
  description: string;
}

export function PlaceholderTab({ title, description }: PlaceholderTabProps) {
  return (
    <div className="flex h-full items-start justify-center px-6 py-10">
      <div className="max-w-md text-center">
        <h3 className="text-fs-lg font-semibold text-ink-1">{title}</h3>
        <p className="mt-2 text-fs-sm text-ink-3">{description}</p>
        <p className="mt-3 text-fs-meta uppercase tracking-wider text-ink-4">
          Available in a follow-up change
        </p>
      </div>
    </div>
  );
}

export function TabScrollShell({ children }: { children: ReactNode }) {
  return (
    <div data-personnel-tab-scroll className="h-full overflow-y-auto px-6 py-6">
      <div className="w-full">{children}</div>
    </div>
  );
}

export function TabSelectionEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <EmptyState variant="compact" title={message} />
    </div>
  );
}
