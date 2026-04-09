import type { ReactNode } from 'react';

interface SettingsGroupSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsGroupSection({ title, children }: SettingsGroupSectionProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </span>
        <div className="flex-1 h-px bg-white/10" />
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
