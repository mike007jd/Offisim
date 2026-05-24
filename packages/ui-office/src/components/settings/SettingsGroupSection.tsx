import type { ReactNode } from 'react';

interface SettingsGroupSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsGroupSection({ title, children }: SettingsGroupSectionProps) {
  return (
    <div className="settings-group-section">
      <div className="settings-group-section-head">
        <span>{title}</span>
        <div />
      </div>
      <div className="settings-group-section-body">{children}</div>
    </div>
  );
}
