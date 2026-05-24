import type {
  InteractionRequest,
  SkillInstallConfirmInteractionContext,
  SkillMutationAction,
} from '@offisim/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  POPOVER_CARD_SKIN_CLASS,
  cn,
} from '@offisim/ui-core';
import { useMemo, useState } from 'react';

interface SkillInstallConfirmBubbleProps {
  request: InteractionRequest;
  context: SkillInstallConfirmInteractionContext;
  employeeName?: string | null;
  onRespond: (selectedOptionId: string) => Promise<void> | void;
}

const WIDE_SCOPE_RE = /^(bash|network|fs|exec)(:|\*)/iu;
const SECTION_LABEL_CLASS = 'skill-confirm-section-label';
const MUTED_CAPTION_CLASS = 'skill-confirm-muted-caption';
const PREVIEW_PANEL_CLASS = 'skill-confirm-preview-panel';

function isWideScope(tool: string): boolean {
  return WIDE_SCOPE_RE.test(tool);
}

function partitionAssets(paths: readonly string[]): {
  scripts: string[];
  references: string[];
  assets: string[];
  other: string[];
} {
  const scripts: string[] = [];
  const references: string[] = [];
  const assets: string[] = [];
  const other: string[] = [];
  for (const p of paths) {
    if (p.startsWith('scripts/')) scripts.push(p);
    else if (p.startsWith('references/')) references.push(p);
    else if (p.startsWith('assets/')) assets.push(p);
    else other.push(p);
  }
  return { scripts, references, assets, other };
}

function describeSource(
  kind: SkillInstallConfirmInteractionContext['sourceKind'],
  ref: string,
): string {
  switch (kind) {
    case 'git':
      return `Git · ${ref}`;
    case 'upload':
      return `Upload · ${ref}`;
    case 'claude-code':
      return `Claude Code · ${ref}`;
    case 'codex':
      return `Codex · ${ref}`;
    case 'fork':
      return `Fork · ${ref}`;
    case 'self-authored':
      return `Self-authored · ${ref}`;
  }
}

function resolveEmployeeLabel(context: SkillInstallConfirmInteractionContext): string {
  return context.resolvedEmployeeName ?? context.resolvedEmployeeId ?? 'the selected employee';
}

function headerTitle(
  action: SkillMutationAction,
  skillName: string,
  context: SkillInstallConfirmInteractionContext,
): string {
  switch (action) {
    case 'fork':
      return `Fork skill · ${context.parent?.name ?? skillName}`;
    case 'edit':
      return `Edit skill · ${skillName}`;
    case 'create':
      return `Create new skill from ${resolveEmployeeLabel(context)}`;
    case 'install':
      return `Install skill · ${skillName}`;
  }
}

function confirmStateLabel(
  action: SkillMutationAction,
  hasWideScopeTool: boolean,
): { label: string; variant: 'secondary' | 'error' } {
  if (action === 'install' && hasWideScopeTool) {
    return { label: 'Review permissions', variant: 'error' };
  }
  switch (action) {
    case 'fork':
      return { label: 'Confirm fork', variant: 'secondary' };
    case 'edit':
      return { label: 'Confirm edit', variant: 'secondary' };
    case 'create':
      return { label: 'Create skill', variant: 'secondary' };
    case 'install':
      return { label: 'Confirm install', variant: 'secondary' };
  }
}

export function SkillInstallConfirmBubble({
  request,
  context,
  employeeName,
  onRespond,
}: SkillInstallConfirmBubbleProps) {
  const [showFullBody, setShowFullBody] = useState(false);
  const [pendingOption, setPendingOption] = useState<string | null>(null);
  const partitioned = useMemo(() => partitionAssets(context.assetPaths), [context.assetPaths]);
  const body =
    context.action === 'create' ? (context.skillMdText ?? '') : (context.skillMdBody ?? '');
  const bodyLineCount = useMemo(() => body.split('\n').length, [body]);
  const shouldClampBody = bodyLineCount > 6;
  const hasWideScopeTool = context.allowedTools.some(isWideScope);
  const action: SkillMutationAction = context.action ?? 'install';
  const badge = confirmStateLabel(action, hasWideScopeTool);
  const hasFrontmatterError = action === 'create' && context.frontmatterError !== undefined;

  async function handle(optionId: string) {
    setPendingOption(optionId);
    try {
      await onRespond(optionId);
    } finally {
      setPendingOption(null);
    }
  }

  const scopeLabel =
    context.resolvedScope === 'company'
      ? 'Company (all employees)'
      : `Employee: ${resolveEmployeeLabel(context)}`;

  return (
    <Card
      className={cn(
        POPOVER_CARD_SKIN_CLASS,
        badge.variant === 'error' && 'skill-confirm-card-danger',
      )}
    >
      <CardHeader className="skill-confirm-head">
        <div className="skill-confirm-title-row">
          <CardTitle className="skill-confirm-title">
            {headerTitle(action, context.skillName, context)}
          </CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {employeeName && <span className="skill-confirm-source">From: {employeeName}</span>}
        {action !== 'edit' && action !== 'create' && (
          <p className="skill-confirm-description">{context.skillDescription}</p>
        )}
      </CardHeader>
      <CardContent className="skill-confirm-body">
        {action === 'fork' && context.parent && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>Fork</div>
            <p className="skill-confirm-primary-copy">
              {`"${context.parent.name}@${context.parent.version}" → ${resolveEmployeeLabel(context)}`}
            </p>
            <p className={MUTED_CAPTION_CLASS}>Parent: {context.parent.slug}</p>
          </section>
        )}

        {action === 'edit' && context.bodyDiff && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>Body diff</div>
            <div className="skill-confirm-diff-grid">
              <div>
                <div className={MUTED_CAPTION_CLASS}>Old</div>
                <div className={PREVIEW_PANEL_CLASS}>
                  {context.bodyDiff.oldPreview || (
                    <span className="skill-confirm-empty">(empty)</span>
                  )}
                </div>
              </div>
              <div>
                <div className={MUTED_CAPTION_CLASS}>New</div>
                <div className="skill-confirm-preview-panel" data-tone="success">
                  {context.bodyDiff.newPreview || (
                    <span className="skill-confirm-empty">(empty)</span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {(action === 'install' || action === 'create') && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>Permissions</div>
            {context.allowedTools.length === 0 ? (
              <p className="skill-confirm-muted-caption">No tools declared.</p>
            ) : (
              <div className="skill-confirm-tool-list">
                {context.allowedTools.map((tool) => {
                  const wideScope = isWideScope(tool);
                  return (
                    <span
                      key={tool}
                      className="skill-confirm-tool-chip"
                      data-wide-scope={wideScope ? 'true' : 'false'}
                    >
                      {tool}
                    </span>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {action === 'install' && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>Source</div>
            <p className="skill-confirm-break-copy">
              {describeSource(context.sourceKind, context.sourceRef)}
            </p>
          </section>
        )}

        {action === 'create' && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>Attribution</div>
            <p className="skill-confirm-break-copy">
              Authored by {context.modelKey ?? context.sourceRef}
            </p>
            {context.slug && <p className={MUTED_CAPTION_CLASS}>Slug: {context.slug}</p>}
          </section>
        )}

        {action !== 'edit' && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>Scope</div>
            <p className="skill-confirm-primary-copy">{scopeLabel}</p>
          </section>
        )}

        {action === 'install' &&
          (partitioned.scripts.length > 0 ||
            partitioned.references.length > 0 ||
            partitioned.assets.length > 0) && (
            <section className="skill-confirm-section">
              <div className={SECTION_LABEL_CLASS}>Assets</div>
              <AssetGroup label="scripts/" paths={partitioned.scripts} />
              <AssetGroup label="references/" paths={partitioned.references} />
              <AssetGroup label="assets/" paths={partitioned.assets} />
            </section>
          )}

        {hasFrontmatterError && context.frontmatterError && (
          <section className="skill-confirm-error-section">
            <div>Frontmatter error</div>
            <p>{context.frontmatterError.detail}</p>
            {context.frontmatterError.field && (
              <p data-mono>
                {context.frontmatterError.reason}: {context.frontmatterError.field}
              </p>
            )}
          </section>
        )}

        {(action === 'install' || action === 'create') && body.length > 0 && (
          <section className="skill-confirm-section">
            <div className={SECTION_LABEL_CLASS}>SKILL.md preview</div>
            <div className="skill-confirm-body-preview" data-expanded={showFullBody || undefined}>
              {body}
              {!showFullBody && shouldClampBody && <div className="skill-confirm-body-fade" />}
            </div>
            {shouldClampBody && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowFullBody((s) => !s)}
                className="skill-confirm-toggle"
              >
                {showFullBody ? 'Show less' : 'Show details'}
              </Button>
            )}
          </section>
        )}

        <div className="skill-confirm-actions">
          {request.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={option.id === 'cancel' ? 'outline' : 'secondary'}
              disabled={pendingOption !== null || (hasFrontmatterError && option.id === 'confirm')}
              onClick={() => handle(option.id)}
            >
              {pendingOption === option.id ? 'Working…' : option.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AssetGroup({ label, paths }: { label: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div>
      <div className={MUTED_CAPTION_CLASS}>{label}</div>
      <ul className="skill-confirm-asset-list">
        {paths.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
