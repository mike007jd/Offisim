import { Alert, AlertDescription, Badge, Button } from '@offisim/ui-core';
/**
 * SkillReview — shows OpenClaw skill details for user review before import.
 * Displayed instead of ManifestReview when the import source is a SKILL.md file.
 */

import type {
  SkillValidationResult as BaseSkillValidationResult,
  InstallPlan,
  SkillRequirements,
} from '@offisim/install-core';
import { AlertTriangle, ExternalLink, FileText, Info, Terminal } from 'lucide-react';

interface SkillReviewProps {
  plan: InstallPlan;
  skillValidation: SkillValidationResult | null;
  onApprove: () => void;
  onCancel: () => void;
}

/** Max characters to show in the instructions preview before truncation. */
const INSTRUCTIONS_PREVIEW_LIMIT = 500;

interface OpenClawSkillCapabilityDescriptor {
  kind: string;
  key: string;
  label: string;
}

interface OpenClawSkillIndex {
  strategy: 'index-first';
  instructionMode: 'deferred';
  summary: string;
  instructionExcerpt: string;
  instructionLength: number;
  requiredCapabilities: readonly string[];
  capabilities: readonly OpenClawSkillCapabilityDescriptor[];
}

type SkillValidationResult = BaseSkillValidationResult & {
  capabilityIndex?: OpenClawSkillIndex;
};

export function SkillReview({ plan, skillValidation, onApprove, onCancel }: SkillReviewProps) {
  const { manifest } = plan;
  const pkg = manifest.package;
  const custom = manifest.custom ?? {};

  const emoji = custom.openclaw_emoji as string | undefined;
  const homepage = custom.openclaw_homepage as string | undefined;
  const supportedOs = custom.openclaw_supported_os as readonly string[] | undefined;
  const userInvocable = custom.openclaw_user_invocable as boolean | undefined;
  const instructions = custom.openclaw_instructions as string | undefined;
  const requirements = custom.openclaw_requirements as SkillRequirements | undefined;
  const skillIndex = (skillValidation?.capabilityIndex ??
    (custom.openclaw_skill_index as OpenClawSkillIndex | undefined)) as
    | OpenClawSkillIndex
    | undefined;

  const hasRequirements =
    (requirements?.bins && requirements.bins.length > 0) ||
    (requirements?.env && requirements.env.length > 0) ||
    (requirements?.config && requirements.config.length > 0);

  const errors = skillValidation?.errors ?? [];
  const warnings = skillValidation?.warnings ?? [];
  const instructionPreview = skillIndex?.instructionExcerpt ?? instructions;

  return (
    <div className="flex flex-col gap-4">
      {/* Skill header */}
      <div className="flex items-start gap-3">
        {emoji && (
          <span className="text-3xl shrink-0 leading-none" aria-hidden>
            {emoji}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-sand font-pixel-body truncate">
            {pkg.title}
          </h3>
          {pkg.summary && <p className="text-sm text-shell mt-0.5">{pkg.summary}</p>}
          {homepage && (
            <a
              href={homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-sea-blue hover:underline mt-1"
            >
              <ExternalLink className="h-3 w-3" />
              {homepage}
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="info">{skillIndex ? 'Index-first' : 'Skill'}</Badge>
          {skillIndex && (
            <Badge variant="outline">{skillIndex.capabilities.length} capabilities</Badge>
          )}
        </div>
      </div>

      {/* Capability index */}
      {skillIndex && (
        <div className="border-2 border-ocean-light p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
              Capability Index
            </h4>
            <Badge variant="info">Deferred full content</Badge>
          </div>
          {skillIndex.capabilities.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {skillIndex.capabilities.map((capability) => (
                <Badge key={`${capability.kind}:${capability.key}`} variant="outline">
                  {capability.label}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-shell">
              This skill does not declare any external capabilities.
            </p>
          )}
          <p className="mt-2 text-xs text-shell">
            Offisim keeps the full instructions deferred until activation. Review happens from the
            index first, then the runtime can load the full body later.
          </p>
          {(supportedOs || typeof userInvocable === 'boolean') && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {supportedOs && supportedOs.length > 0 && (
                <span className="text-shell">
                  Supported OS: <span className="text-sand">{supportedOs.join(', ')}</span>
                </span>
              )}
              {typeof userInvocable === 'boolean' && (
                <span className="text-shell">
                  User invocable: <span className="text-sand">{userInvocable ? 'yes' : 'no'}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Instructions preview */}
      {instructionPreview && (
        <div className="border-2 border-ocean-light p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-3.5 w-3.5 text-ocean-light shrink-0" />
            <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
              Instructions Preview
            </h4>
          </div>
          <div className="max-h-40 overflow-y-auto">
            <pre className="text-xs text-shell whitespace-pre-wrap break-words font-pixel-mono leading-relaxed">
              {instructionPreview.length > INSTRUCTIONS_PREVIEW_LIMIT
                ? `${instructionPreview.slice(0, INSTRUCTIONS_PREVIEW_LIMIT)}...`
                : instructionPreview}
            </pre>
          </div>
        </div>
      )}

      {/* Requirements */}
      {hasRequirements && (
        <div className="border-2 border-ocean-light p-3">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="h-3.5 w-3.5 text-ocean-light shrink-0" />
            <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
              Requirements
            </h4>
          </div>
          <div className="space-y-1.5">
            {requirements?.bins && requirements.bins.length > 0 && (
              <div className="text-xs text-shell">
                <span className="text-ocean-light">Binaries: </span>
                <span className="text-sand">{requirements.bins.join(', ')}</span>
              </div>
            )}
            {requirements?.env && requirements.env.length > 0 && (
              <div className="text-xs text-shell">
                <span className="text-ocean-light">Environment: </span>
                <span className="text-sand">{requirements.env.join(', ')}</span>
              </div>
            )}
            {requirements?.config && requirements.config.length > 0 && (
              <div className="text-xs text-shell">
                <span className="text-ocean-light">Config: </span>
                <span className="text-sand">{requirements.config.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Blocking validation errors */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <p className="font-medium">Blocking issues must be fixed before import:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {errors.map((error) => (
                  <li key={`${error.type}-${error.detail}`}>{error.detail}</li>
                ))}
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-0.5">
              {warnings.map((w) => (
                <li key={`${w.type}-${w.detail}`}>{w.detail}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Info note */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This skill will be imported as a new employee. Offisim keeps a capability index in the
          manifest, and the full instructions stay available for later activation.
        </AlertDescription>
      </Alert>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-ocean-light">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onApprove} disabled={errors.length > 0}>
          Import Skill
        </Button>
      </div>
    </div>
  );
}
