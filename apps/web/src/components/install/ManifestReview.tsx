/**
 * ManifestReview — shows package metadata and permissions for user review.
 * Part of the install dialog flow (step: 'review').
 */

import { Shield, AlertTriangle, Globe, HardDrive, KeyRound } from 'lucide-react';
import type { InstallPlan } from '@aics/install-core';
import type { RiskClass } from '@aics/asset-schema';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

interface ManifestReviewProps {
  plan: InstallPlan;
  onApprove: () => void;
  onCancel: () => void;
}

const RISK_CLASS_CONFIG: Record<RiskClass, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  data_asset: { label: 'Data Asset', variant: 'success' },
  logic_asset: { label: 'Logic Asset', variant: 'warning' },
  privileged_asset: { label: 'Privileged Asset', variant: 'error' },
};

export function ManifestReview({ plan, onApprove, onCancel }: ManifestReviewProps) {
  const { manifest, confirmationReasons } = plan;
  const pkg = manifest.package;
  const perms = manifest.permissions;
  const riskConfig = RISK_CLASS_CONFIG[perms.risk_class] ?? { label: perms.risk_class, variant: 'secondary' as const };

  return (
    <div className="flex flex-col gap-4">
      {/* Package header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-text-primary truncate">{pkg.title}</h3>
          <p className="text-sm text-text-secondary mt-0.5">
            {pkg.id} &middot; v{pkg.version}
          </p>
          {pkg.publisher?.display_name && (
            <p className="text-xs text-text-muted mt-0.5">
              by {pkg.publisher.display_name}
              {pkg.publisher.creator_handle ? ` (@${pkg.publisher.creator_handle})` : ''}
            </p>
          )}
        </div>
        <Badge variant={riskConfig.variant}>{riskConfig.label}</Badge>
      </div>

      {/* Summary */}
      {pkg.summary && (
        <p className="text-sm text-text-secondary">{pkg.summary}</p>
      )}

      {/* Permissions */}
      <div className="rounded-md border border-border p-3 space-y-2">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">Permissions</h4>

        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <HardDrive className="h-3.5 w-3.5 shrink-0" />
          <span>Filesystem: <span className="text-text-primary font-medium">{perms.filesystem_scope}</span></span>
        </div>

        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span>Network: <span className="text-text-primary font-medium">{perms.network_scope}</span></span>
        </div>

        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <span>Secrets: <span className="text-text-primary font-medium">{perms.declares_secrets ? 'Yes' : 'None'}</span></span>
        </div>

        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          <span>Risk class: <span className="text-text-primary font-medium">{perms.risk_class.replace('_', ' ')}</span></span>
        </div>
      </div>

      {/* Confirmation reasons */}
      {confirmationReasons.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-0.5">
              {confirmationReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Compatibility info */}
      <div className="flex flex-wrap gap-1.5 text-xs text-text-muted">
        <span>Runtime: {manifest.compatibility.runtime_range}</span>
        <span>&middot;</span>
        <span>Schema: {manifest.compatibility.schema_version}</span>
        <span>&middot;</span>
        <span>License: {pkg.license}</span>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onApprove}>
          Approve &amp; Continue
        </Button>
      </div>
    </div>
  );
}
