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
    section: 'rounded-r-md border border-line-soft bg-surface-2 p-3',
    header: 'mb-2 flex items-center gap-1.5 text-fs-meta font-semibold text-ink-1',
    icon: 'size-3.5',
    dl: 'flex flex-col gap-1.5 text-fs-meta text-ink-3',
    row: 'flex justify-between gap-2',
    dt: 'text-ink-4',
  },
  wide: {
    section: 'rounded-r-md border border-line-soft bg-surface-2 p-sp-5',
    header: 'flex items-center gap-2 text-fs-sm font-semibold text-ink-1',
    icon: 'size-4',
    dl: 'mt-3 flex flex-col gap-2.5 text-fs-sm text-ink-3',
    row: '',
    dt: 'text-fs-meta font-semibold uppercase tracking-wide text-ink-4',
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
