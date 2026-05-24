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
    <div className="install-manifest">
      {/* Package header */}
      <div className="install-manifest-header">
        <div className="install-manifest-title">
          <h3>{pkg.title}</h3>
          <p>
            {pkg.id} &middot; v{pkg.version}
          </p>
          {pkg.publisher?.display_name && (
            <p data-slot="publisher">
              by {pkg.publisher.display_name}
              {pkg.publisher.creator_handle ? ` (@${pkg.publisher.creator_handle})` : ''}
            </p>
          )}
        </div>
        <Badge variant={riskConfig.variant}>{riskConfig.label}</Badge>
      </div>

      {/* Summary */}
      {pkg.summary && <p className="install-manifest-summary">{pkg.summary}</p>}

      {/* Permissions */}
      <div className="install-manifest-section">
        <h4>Permissions</h4>

        <div className="install-manifest-row">
          <HardDrive data-icon="inline-start" aria-hidden="true" />
          <span>
            Filesystem: <strong>{perms.filesystem_scope}</strong>
          </span>
        </div>

        <div className="install-manifest-row">
          <Globe data-icon="inline-start" aria-hidden="true" />
          <span>
            Network: <strong>{perms.network_scope}</strong>
          </span>
        </div>

        <div className="install-manifest-row">
          <KeyRound data-icon="inline-start" aria-hidden="true" />
          <span>
            Secrets: <strong>{perms.declares_secrets ? 'Yes' : 'None'}</strong>
          </span>
        </div>

        <div className="install-manifest-row">
          <Shield data-icon="inline-start" aria-hidden="true" />
          <span>
            Risk class: <strong>{perms.risk_class.replace('_', ' ')}</strong>
          </span>
        </div>
      </div>

      {/* Required MCP Servers */}
      {manifest.requirements.required_mcps.length > 0 && (
        <div className="install-manifest-section">
          <h4>Required MCP Servers</h4>
          {manifest.requirements.required_mcps.map((mcp) => (
            <div key={mcp} className="install-manifest-row">
              <Server data-icon="inline-start" aria-hidden="true" />
              <strong>{mcp}</strong>
            </div>
          ))}
          <Alert variant="warning">
            <AlertTriangle data-icon="inline-start" aria-hidden="true" />
            <AlertDescription>
              This package requires the MCP servers listed above. Ensure they are configured in your
              local runtime before installing.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Confirmation reasons */}
      {confirmationReasons.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle data-icon="inline-start" aria-hidden="true" />
          <AlertDescription>
            <ul className="install-manifest-reasons">
              {confirmationReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Compatibility info */}
      <div className="install-manifest-meta">
        <span>Runtime: {manifest.compatibility.runtime_range}</span>
        <span>&middot;</span>
        <span>Schema: {manifest.compatibility.schema_version}</span>
        <span>&middot;</span>
        <span>License: {pkg.license}</span>
      </div>

      {/* Actions */}
      <div className="install-manifest-actions">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onApprove}>Approve &amp; Continue</Button>
      </div>
    </div>
  );
}
