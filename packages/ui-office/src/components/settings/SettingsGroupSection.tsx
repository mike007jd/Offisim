import type { ReactNode } from 'react';

interface SettingsGroupSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsGroupSection({ title, children }: SettingsGroupSectionProps) {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
        <div className="h-px flex-1 bg-border-default" />
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
