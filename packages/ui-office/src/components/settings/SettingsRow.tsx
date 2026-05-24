import type { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="flex h-12 items-center rounded-r-md px-2 hover:bg-surface-sunken">
      <div className="min-w-0 flex-1">
        <span className="text-fs-sm text-ink-1">{label}</span>
        {description && <p className="mt-0.5 text-fs-meta text-ink-4">{description}</p>}
      </div>
      <div className="ml-4 flex-shrink-0">{children}</div>
    </div>
  );
}
