import type { PermissionSummary } from '@offisim/registry-client';
import { Shield } from 'lucide-react';
import { formatRiskLabel } from './marketplace-meta.js';

export interface PermissionsBlockProps {
  permissions: PermissionSummary;
  variant?: 'compact' | 'wide';
}

export function PermissionsBlock({ permissions, variant = 'wide' }: PermissionsBlockProps) {
  if (variant === 'compact') {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
          <Shield className="h-3.5 w-3.5 text-cyan-300" />
          Permissions
        </div>
        <dl className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Risk</dt>
            <dd>{formatRiskLabel(permissions.risk_class)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Filesystem</dt>
            <dd>{permissions.filesystem_scope ?? 'none'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Network</dt>
            <dd>{permissions.network_scope ?? 'none'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Secrets</dt>
            <dd>{permissions.declares_secrets ? 'Declared' : 'None'}</dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Shield className="h-4 w-4 text-cyan-300" />
        Permissions
      </div>
      <dl className="mt-4 space-y-3 text-sm text-slate-300">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Risk</dt>
          <dd>{formatRiskLabel(permissions.risk_class)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Filesystem</dt>
          <dd>{permissions.filesystem_scope ?? 'none'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Network</dt>
          <dd>{permissions.network_scope ?? 'none'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Secrets</dt>
          <dd>{permissions.declares_secrets ? 'Declared' : 'None'}</dd>
        </div>
      </dl>
    </section>
  );
}
