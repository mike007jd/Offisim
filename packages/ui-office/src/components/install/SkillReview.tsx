import { Alert, AlertDescription, Badge, Button } from '@aics/ui-core';
/**
 * SkillReview — shows OpenClaw skill details for user review before import.
 * Displayed instead of ManifestReview when the import source is a SKILL.md file.
 */

import type { InstallPlan, SkillRequirements, SkillValidationResult } from '@aics/install-core';
import { AlertTriangle, ExternalLink, FileText, Info, Terminal } from 'lucide-react';

interface SkillReviewProps {
  plan: InstallPlan;
  skillValidation: SkillValidationResult | null;
  onApprove: () => void;
  onCancel: () => void;
}

/** Max characters to show in the instructions preview before truncation. */
const INSTRUCTIONS_PREVIEW_LIMIT = 500;

export function SkillReview({ plan, skillValidation, onApprove, onCancel }: SkillReviewProps) {
  const { manifest } = plan;
  const pkg = manifest.package;
  const custom = manifest.custom ?? {};

  const emoji = custom.openclaw_emoji as string | undefined;
  const homepage = custom.openclaw_homepage as string | undefined;
  const instructions = custom.openclaw_instructions as string | undefined;
  const requirements = custom.openclaw_requirements as SkillRequirements | undefined;

  const hasRequirements =
    (requirements?.bins && requirements.bins.length > 0) ||
    (requirements?.env && requirements.env.length > 0) ||
    (requirements?.config && requirements.config.length > 0);

  const warnings = skillValidation?.warnings ?? [];

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
        <Badge variant="info">Skill</Badge>
      </div>

      {/* Instructions preview */}
      {instructions && (
        <div className="border-2 border-ocean-light p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-3.5 w-3.5 text-ocean-light shrink-0" />
            <h4 className="text-xs font-medium text-ocean-light uppercase tracking-wide font-pixel-body">
              Instructions
            </h4>
          </div>
          <div className="max-h-40 overflow-y-auto">
            <pre className="text-xs text-shell whitespace-pre-wrap break-words font-pixel-mono leading-relaxed">
              {instructions.length > INSTRUCTIONS_PREVIEW_LIMIT
                ? `${instructions.slice(0, INSTRUCTIONS_PREVIEW_LIMIT)}...`
                : instructions}
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
          This skill will be imported as a new employee. The skill's instructions become the
          employee's persona.
        </AlertDescription>
      </Alert>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-ocean-light">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onApprove}>Import Skill</Button>
      </div>
    </div>
  );
}
