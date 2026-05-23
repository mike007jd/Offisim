import type { RiskClass } from '@offisim/asset-schema';
import type { PermissionSummary } from '@offisim/registry-client';
import { Shield } from 'lucide-react';
import { formatRiskLabel } from './marketplace-meta.js';

export interface PermissionsBlockProps {
  permissions: PermissionSummary;
  variant?: 'compact' | 'wide';
}

const VARIANT_STYLES = {
  compact: {
    section: 'rounded-2xl border border-border-default bg-surface-muted p-3',
    header: 'mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary',
    icon: 'h-3.5 w-3.5',
    dl: 'flex flex-col gap-1.5 text-xs text-text-secondary',
    row: 'flex justify-between gap-2',
    dt: 'text-text-muted',
  },
  wide: {
    section: 'rounded-2xl border border-border-default bg-surface-muted p-4',
    header: 'flex items-center gap-2 text-sm font-semibold text-text-primary',
    icon: 'h-4 w-4',
    dl: 'mt-4 flex flex-col gap-3 text-sm text-text-secondary',
    row: '',
    dt: 'text-xs uppercase tracking-wide text-text-muted',
  },
} as const;

const FIELDS: Array<{
  key: keyof PermissionSummary;
  label: string;
  format: (v: PermissionSummary[keyof PermissionSummary]) => string;
}> = [
  { key: 'risk_class', label: 'Risk', format: (v) => formatRiskLabel(v as RiskClass | undefined) },
  {
    key: 'filesystem_scope',
    label: 'Filesystem',
    format: (v) => (v as string | undefined) ?? 'none',
  },
  { key: 'network_scope', label: 'Network', format: (v) => (v as string | undefined) ?? 'none' },
  { key: 'declares_secrets', label: 'Secrets', format: (v) => (v ? 'Declared' : 'None') },
];

export function PermissionsBlock({ permissions, variant = 'wide' }: PermissionsBlockProps) {
  const s = VARIANT_STYLES[variant];

  return (
    <section className={s.section}>
      <div className={s.header}>
        <Shield className={`${s.icon} text-accent`} />
        Permissions
      </div>
      <dl className={s.dl}>
        {FIELDS.map(({ key, label, format }) => (
          <div key={key} className={s.row}>
            <dt className={s.dt}>{label}</dt>
            <dd>{format(permissions[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
