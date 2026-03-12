import { Shield, FolderOpen, Wifi, KeyRound } from 'lucide-react';
import type { PermissionSummary } from '@aics/registry-client';
import { RiskBadge } from './RiskBadge';

export function PermissionsPanel({ permissions }: { permissions: PermissionSummary }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Shield size={16} />
        Permissions
      </h3>
      <div className="space-y-2 text-sm">
        {permissions.risk_class && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Risk class:</span>
            <RiskBadge risk={permissions.risk_class} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-gray-400" />
          <span className="text-gray-600">
            Filesystem: {permissions.filesystem_scope ?? 'none'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-gray-400" />
          <span className="text-gray-600">
            Network: {permissions.network_scope ?? 'none'}
          </span>
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
