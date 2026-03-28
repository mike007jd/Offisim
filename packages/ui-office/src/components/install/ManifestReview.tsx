import { Alert, AlertDescription, Badge, Button } from '@offisim/ui-core';
/**
 * ManifestReview — shows package metadata and permissions for user review.
 * Part of the install dialog flow (step: 'review').
 */

import type { RiskClass } from '@offisim/asset-schema';
import type { InstallPlan } from '@offisim/install-core';
import { AlertTriangle, Globe, HardDrive, KeyRound, Server, Shield } from 'lucide-react';

interface ManifestReviewProps {
  plan: InstallPlan;
  onApprove: () => void;
  onCancel: () => void;
}

const RISK_CLASS_CONFIG: Record<
  RiskClass,
  { label: string; variant: 'success' | 'warning' | 'error' }
> = {
  data_asset: { label: 'Data Asset', variant: 'success' },
  logic_asset: { label: 'Logic Asset', variant: 'warning' },
  privileged_asset: { label: 'Privileged Asset', variant: 'error' },
};

export function ManifestReview({ plan, onApprove, onCancel }: ManifestReviewProps) {
  const { manifest, confirmationReasons } = plan;
  const pkg = manifest.package;
  const perms = manifest.permissions;
  const riskConfig = RISK_CLASS_CONFIG[perms.risk_class] ?? {
    label: perms.risk_class,
    variant: 'secondary' as const,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Package header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-sand truncate">{pkg.title}</h3>
          <p className="text-sm text-shell mt-0.5">
            {pkg.id} &middot; v{pkg.version}
          </p>
          {pkg.publisher?.display_name && (
            <p className="text-xs text-ocean-light mt-0.5">
              by {pkg.publisher.display_name}
              {pkg.publisher.creator_handle ? ` (@${pkg.publisher.creator_handle})` : ''}
            </p>
          )}
        </div>
        <Badge variant={riskConfig.variant}>{riskConfig.label}</Badge>
      </div>

      {/* Summary */}
      {pkg.summary && <p className="text-sm text-shell">{pkg.summary}</p>}

      {/* Permissions */}
      <div className="border-2 border-ocean-light p-3 space-y-2">
        <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
          Permissions
        </h4>

        <div className="flex items-center gap-2 text-sm text-shell">
          <HardDrive className="h-3.5 w-3.5 shrink-0" />
          <span>
            Filesystem: <span className="text-sand font-medium">{perms.filesystem_scope}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-shell">
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span>
            Network: <span className="text-sand font-medium">{perms.network_scope}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-shell">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <span>
            Secrets:{' '}
            <span className="text-sand font-medium">{perms.declares_secrets ? 'Yes' : 'None'}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-shell">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          <span>
            Risk class:{' '}
            <span className="text-sand font-medium">{perms.risk_class.replace('_', ' ')}</span>
          </span>
        </div>
      </div>

      {/* Required MCP Servers */}
      {manifest.requirements.required_mcps.length > 0 && (
        <div className="border-2 border-ocean-light p-3 space-y-2">
          <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
            Required MCP Servers
          </h4>
          {manifest.requirements.required_mcps.map((mcp) => (
            <div key={mcp} className="flex items-center gap-2 text-sm text-shell">
              <Server className="h-3.5 w-3.5 shrink-0" />
              <span className="text-sand font-medium">{mcp}</span>
            </div>
          ))}
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <span className="text-xs">
                This package requires the MCP servers listed above. Ensure they are configured in
                your local runtime before installing.
              </span>
            </AlertDescription>
          </Alert>
        </div>
      )}

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
      <div className="flex flex-wrap gap-1.5 text-xs text-ocean-light">
        <span>Runtime: {manifest.compatibility.runtime_range}</span>
        <span>&middot;</span>
        <span>Schema: {manifest.compatibility.schema_version}</span>
        <span>&middot;</span>
        <span>License: {pkg.license}</span>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-ocean-light">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onApprove}>Approve &amp; Continue</Button>
      </div>
    </div>
  );
}
