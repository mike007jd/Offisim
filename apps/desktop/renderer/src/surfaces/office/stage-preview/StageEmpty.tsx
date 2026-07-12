import { Icon } from '@/design-system/icons/Icon.js';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function StageEmpty({
  title,
  detail,
  icon,
  action,
}: {
  title: string;
  detail: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="off-stage-empty">
      {icon ? <Icon icon={icon} size="md" className="off-stage-empty-icon" /> : null}
      <strong>{title}</strong>
      <span>{detail}</span>
      {action ? <div className="off-stage-empty-action">{action}</div> : null}
    </div>
  );
}
