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
const SECTION_LABEL_CLASS = 'text-fs-meta font-semibold uppercase tracking-wide text-ink-4';
const MUTED_CAPTION_CLASS = 'text-fs-meta text-ink-4';
const PREVIEW_PANEL_CLASS =
  'mt-1 whitespace-pre-wrap break-words rounded-r-sm border border-line-soft bg-surface-2 p-2 text-fs-meta text-ink-3';

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
    <Card className={cn(POPOVER_CARD_SKIN_CLASS, badge.variant === 'error' && 'border-danger')}>
      <CardHeader className="gap-2 border-b border-line-soft pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="min-w-0 truncate text-fs-sm text-ink-1">
            {headerTitle(action, context.skillName, context)}
          </CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {employeeName && <span className="text-fs-meta text-ink-4">From: {employeeName}</span>}
        {action !== 'edit' && action !== 'create' && (
          <p className="line-clamp-2 whitespace-pre-wrap text-fs-meta text-ink-3">
            {context.skillDescription}
          </p>
        )}
      </CardHeader>
      <CardContent className="max-h-96 flex flex-col gap-3 overflow-y-auto pt-3">
        {action === 'fork' && context.parent && (
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>Fork</div>
            <p className="text-fs-meta text-ink-1">
              {`"${context.parent.name}@${context.parent.version}" → ${resolveEmployeeLabel(context)}`}
            </p>
            <p className={MUTED_CAPTION_CLASS}>Parent: {context.parent.slug}</p>
          </section>
        )}

        {action === 'edit' && context.bodyDiff && (
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>Body diff</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <div className={MUTED_CAPTION_CLASS}>Old</div>
                <div className={PREVIEW_PANEL_CLASS}>
                  {context.bodyDiff.oldPreview || <span className="text-ink-4">(empty)</span>}
                </div>
              </div>
              <div>
                <div className={MUTED_CAPTION_CLASS}>New</div>
                <div className="mt-1 whitespace-pre-wrap break-words rounded-r-sm border border-ok/40 bg-ok-surface p-2 text-fs-meta text-ok">
                  {context.bodyDiff.newPreview || <span className="text-ink-4">(empty)</span>}
                </div>
              </div>
            </div>
          </section>
        )}

        {(action === 'install' || action === 'create') && (
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>Permissions</div>
            {context.allowedTools.length === 0 ? (
              <p className="text-fs-meta text-ink-4">No tools declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {context.allowedTools.map((tool) => {
                  const wideScope = isWideScope(tool);
                  return (
                    <span
                      key={tool}
                      className={
                        wideScope
                          ? 'rounded-r-sm border border-danger/50 bg-danger-surface px-2 py-0.5 text-fs-meta font-medium text-danger'
                          : 'rounded-r-sm border border-line-soft bg-surface-2 px-2 py-0.5 text-fs-meta text-ink-3'
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
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>Source</div>
            <p className="break-all text-fs-meta text-ink-1">
              {describeSource(context.sourceKind, context.sourceRef)}
            </p>
          </section>
        )}

        {action === 'create' && (
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>Attribution</div>
            <p className="break-all text-fs-meta text-ink-1">
              Authored by {context.modelKey ?? context.sourceRef}
            </p>
            {context.slug && <p className={MUTED_CAPTION_CLASS}>Slug: {context.slug}</p>}
          </section>
        )}

        {action !== 'edit' && (
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>Scope</div>
            <p className="text-fs-meta text-ink-1">{scopeLabel}</p>
          </section>
        )}

        {action === 'install' &&
          (partitioned.scripts.length > 0 ||
            partitioned.references.length > 0 ||
            partitioned.assets.length > 0) && (
            <section className="flex flex-col gap-1.5">
              <div className={SECTION_LABEL_CLASS}>Assets</div>
              <AssetGroup label="scripts/" paths={partitioned.scripts} />
              <AssetGroup label="references/" paths={partitioned.references} />
              <AssetGroup label="assets/" paths={partitioned.assets} />
            </section>
          )}

        {hasFrontmatterError && context.frontmatterError && (
          <section className="flex flex-col gap-1.5 rounded-r-sm border border-danger/40 bg-danger-surface p-3">
            <div className="text-fs-meta font-semibold uppercase tracking-wide text-danger">
              Frontmatter error
            </div>
            <p className="text-fs-meta text-danger">{context.frontmatterError.detail}</p>
            {context.frontmatterError.field && (
              <p className="font-mono text-fs-meta text-danger">
                {context.frontmatterError.reason}: {context.frontmatterError.field}
              </p>
            )}
          </section>
        )}

        {(action === 'install' || action === 'create') && body.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <div className={SECTION_LABEL_CLASS}>SKILL.md preview</div>
            <div
              className={cn(
                'whitespace-pre-wrap break-words rounded-r-sm border border-line-soft bg-surface-2 p-3 text-fs-meta',
                showFullBody
                  ? 'max-h-64 overflow-y-auto text-ink-1'
                  : 'relative max-h-20 overflow-hidden text-ink-3',
              )}
            >
              {body}
              {!showFullBody && shouldClampBody && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-2 to-transparent" />
              )}
            </div>
            {shouldClampBody && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowFullBody((s) => !s)}
                className="h-auto p-0 text-fs-meta font-medium"
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
      <ul className="ml-2 mt-0.5 flex flex-col gap-0.5 text-fs-meta text-ink-3">
        {paths.map((p) => (
          <li key={p} className="font-mono text-fs-meta text-ink-3">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
