import type {
  InteractionRequest,
  SkillInstallConfirmInteractionContext,
  SkillMutationAction,
} from '@offisim/shared-types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@offisim/ui-core';
import { useMemo, useState } from 'react';

interface SkillInstallConfirmBubbleProps {
  request: InteractionRequest;
  context: SkillInstallConfirmInteractionContext;
  employeeName?: string | null;
  onRespond: (selectedOptionId: string) => Promise<void> | void;
}

const WIDE_SCOPE_RE = /^(bash|network|fs|exec)(:|\*)/iu;
const SECTION_LABEL_CLASS = 'text-caption font-semibold uppercase tracking-wide text-text-muted';
const MUTED_CAPTION_CLASS = 'text-caption text-text-muted';
const PREVIEW_PANEL_CLASS =
  'mt-1 whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-surface-muted p-2 text-caption text-text-secondary';

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
    <Card className="border-border-default bg-surface-elevated text-text-primary shadow-overlay">
      <CardHeader className="gap-2 border-b border-border-subtle pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="min-w-0 truncate text-sm text-text-primary">
            {headerTitle(action, context.skillName, context)}
          </CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {employeeName && <span className="text-xs text-text-muted">From: {employeeName}</span>}
        {action !== 'edit' && action !== 'create' && (
          <p className="line-clamp-2 whitespace-pre-wrap text-xs text-text-secondary">
            {context.skillDescription}
          </p>
        )}
      </CardHeader>
      <CardContent className="max-h-96 space-y-3 overflow-y-auto pt-3">
        {action === 'fork' && context.parent && (
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>Fork</div>
            <p className="text-xs text-text-primary">
              {`"${context.parent.name}@${context.parent.version}" → ${resolveEmployeeLabel(context)}`}
            </p>
            <p className={MUTED_CAPTION_CLASS}>Parent: {context.parent.slug}</p>
          </section>
        )}

        {action === 'edit' && context.bodyDiff && (
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>Body diff</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <div className={MUTED_CAPTION_CLASS}>Old</div>
                <div className={PREVIEW_PANEL_CLASS}>
                  {context.bodyDiff.oldPreview || <span className="text-text-muted">(empty)</span>}
                </div>
              </div>
              <div>
                <div className={MUTED_CAPTION_CLASS}>New</div>
                <div className="mt-1 whitespace-pre-wrap break-words rounded-md border border-success/40 bg-success-muted p-2 text-caption text-success">
                  {context.bodyDiff.newPreview || <span className="text-text-muted">(empty)</span>}
                </div>
              </div>
            </div>
          </section>
        )}

        {(action === 'install' || action === 'create') && (
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>Permissions</div>
            {context.allowedTools.length === 0 ? (
              <p className="text-xs text-text-muted">No tools declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {context.allowedTools.map((tool) => {
                  const wideScope = isWideScope(tool);
                  return (
                    <span
                      key={tool}
                      className={
                        wideScope
                          ? 'rounded-md border border-error/50 bg-error-muted px-2 py-0.5 text-caption font-medium text-error'
                          : 'rounded-md border border-border-subtle bg-surface-muted px-2 py-0.5 text-caption text-text-secondary'
                      }
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
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>Source</div>
            <p className="break-all text-xs text-text-primary">
              {describeSource(context.sourceKind, context.sourceRef)}
            </p>
          </section>
        )}

        {action === 'create' && (
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>Attribution</div>
            <p className="break-all text-xs text-text-primary">
              Authored by {context.modelKey ?? context.sourceRef}
            </p>
            {context.slug && <p className={MUTED_CAPTION_CLASS}>Slug: {context.slug}</p>}
          </section>
        )}

        {action !== 'edit' && (
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>Scope</div>
            <p className="text-xs text-text-primary">{scopeLabel}</p>
          </section>
        )}

        {action === 'install' &&
          (partitioned.scripts.length > 0 ||
            partitioned.references.length > 0 ||
            partitioned.assets.length > 0) && (
            <section className="space-y-1.5">
              <div className={SECTION_LABEL_CLASS}>Assets</div>
              <AssetGroup label="scripts/" paths={partitioned.scripts} />
              <AssetGroup label="references/" paths={partitioned.references} />
              <AssetGroup label="assets/" paths={partitioned.assets} />
            </section>
          )}

        {hasFrontmatterError && context.frontmatterError && (
          <section className="space-y-1.5 rounded-md border border-error/40 bg-error-muted p-3">
            <div className="text-caption font-semibold uppercase tracking-wide text-error">
              Frontmatter error
            </div>
            <p className="text-xs text-error">{context.frontmatterError.detail}</p>
            {context.frontmatterError.field && (
              <p className="font-mono text-caption text-error">
                {context.frontmatterError.reason}: {context.frontmatterError.field}
              </p>
            )}
          </section>
        )}

        {(action === 'install' || action === 'create') && body.length > 0 && (
          <section className="space-y-1.5">
            <div className={SECTION_LABEL_CLASS}>SKILL.md preview</div>
            <div
              className={cn(
                'whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-surface-muted p-3 text-xs',
                showFullBody
                  ? 'max-h-64 overflow-y-auto text-text-primary'
                  : 'relative max-h-20 overflow-hidden text-text-secondary',
              )}
            >
              {body}
              {!showFullBody && shouldClampBody && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-muted to-transparent" />
              )}
            </div>
            {shouldClampBody && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowFullBody((s) => !s)}
                className="h-auto p-0 text-caption font-medium"
              >
                {showFullBody ? 'Show less' : 'Show details'}
              </Button>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
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
      <ul className="ml-2 mt-0.5 space-y-0.5 text-xs text-text-secondary">
        {paths.map((p) => (
          <li key={p} className="font-mono text-caption text-text-secondary">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
