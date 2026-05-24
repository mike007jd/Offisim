import type { ReactNode } from 'react';

interface SettingsGroupSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsGroupSection({ title, children }: SettingsGroupSectionProps) {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-fs-meta font-semibold uppercase tracking-ls-capsr text-ink-4">
          {title}
        </span>
        <div className="h-px flex-1 bg-border-default" />
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
