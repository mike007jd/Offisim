import type { PermissionSummary } from '@aics/registry-client';
import { FolderOpen, KeyRound, Shield, Wifi } from 'lucide-react';
import { RiskBadge } from './RiskBadge.js';

export function PermissionsPanel({ permissions }: { permissions: PermissionSummary }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Shield size={16} />
        Permissions
      </h3>
      <div className="space-y-2 text-sm">
        {permissions.risk_class && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">Risk class:</span>
            <RiskBadge risk={permissions.risk_class} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)]">
            Filesystem: {permissions.filesystem_scope ?? 'none'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)]">Network: {permissions.network_scope ?? 'none'}</span>
        </div>
        {permissions.declares_secrets && (
          <div className="flex items-center gap-2 text-yellow-700">
            <KeyRound size={14} />
            <span>Requires secret bindings after install</span>
          </div>
        )}
      </div>
    </div>
  );
}
