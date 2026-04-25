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
        <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
        <p className="mt-3 text-[11px] uppercase tracking-wider text-slate-500">
          Available in a follow-up change
        </p>
      </div>
    </div>
  );
}

export function TabScrollShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
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
