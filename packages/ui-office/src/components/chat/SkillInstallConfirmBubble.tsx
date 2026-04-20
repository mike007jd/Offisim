import type {
  InteractionRequest,
  SkillInstallConfirmInteractionContext,
  SkillMutationAction,
} from '@offisim/shared-types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';
import { useMemo, useState } from 'react';

interface SkillInstallConfirmBubbleProps {
  request: InteractionRequest;
  context: SkillInstallConfirmInteractionContext;
  employeeName?: string | null;
  onRespond: (selectedOptionId: string) => Promise<void> | void;
}

const WIDE_SCOPE_RE = /^(bash|network|fs|exec)(:|\*)/iu;

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
  }
}

function resolveEmployeeLabel(context: SkillInstallConfirmInteractionContext): string {
  return (
    context.resolvedEmployeeName ?? context.resolvedEmployeeId ?? 'the selected employee'
  );
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
  const body = context.skillMdBody ?? '';
  const hasWideScopeTool = context.allowedTools.some(isWideScope);
  const action: SkillMutationAction = context.action ?? 'install';
  const badge = confirmStateLabel(action, hasWideScopeTool);

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
    <Card className="border-white/10 bg-black/30 backdrop-blur-md">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm text-white">
            {headerTitle(action, context.skillName, context)}
          </CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {employeeName && <span className="text-xs text-slate-400">From: {employeeName}</span>}
        {action !== 'edit' && (
          <p className="whitespace-pre-wrap text-xs text-slate-300">{context.skillDescription}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {action === 'fork' && context.parent && (
          <section className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Fork
            </div>
            <p className="text-xs text-slate-200">
              {`"${context.parent.name}@${context.parent.version}" → ${resolveEmployeeLabel(context)}`}
            </p>
            <p className="text-[11px] text-slate-500">Parent: {context.parent.slug}</p>
          </section>
        )}

        {action === 'edit' && context.bodyDiff && (
          <section className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Body diff
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <div className="text-[11px] text-slate-400">Old</div>
                <div className="mt-1 rounded-md border border-white/10 bg-black/30 p-2 text-[11px] text-slate-300 whitespace-pre-wrap break-words">
                  {context.bodyDiff.oldPreview || <span className="text-slate-500">(empty)</span>}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">New</div>
                <div className="mt-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-100 whitespace-pre-wrap break-words">
                  {context.bodyDiff.newPreview || <span className="text-slate-500">(empty)</span>}
                </div>
              </div>
            </div>
          </section>
        )}

        {action === 'install' && (
          <section className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Permissions
            </div>
            {context.allowedTools.length === 0 ? (
              <p className="text-xs text-slate-500">No tools declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {context.allowedTools.map((tool) => (
                  <span
                    key={tool}
                    className={
                      isWideScope(tool)
                        ? 'rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-200'
                        : 'rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-200'
                    }
                    data-wide-scope={isWideScope(tool) ? 'true' : 'false'}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {action === 'install' && (
          <section className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Source
            </div>
            <p className="break-all text-xs text-slate-200">
              {describeSource(context.sourceKind, context.sourceRef)}
            </p>
          </section>
        )}

        {action !== 'edit' && (
          <section className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Scope
            </div>
            <p className="text-xs text-slate-200">{scopeLabel}</p>
          </section>
        )}

        {action === 'install' &&
          (partitioned.scripts.length > 0 ||
            partitioned.references.length > 0 ||
            partitioned.assets.length > 0) && (
            <section className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Assets
              </div>
              <AssetGroup label="scripts/" paths={partitioned.scripts} />
              <AssetGroup label="references/" paths={partitioned.references} />
              <AssetGroup label="assets/" paths={partitioned.assets} />
            </section>
          )}

        {action === 'install' && body.length > 0 && (
          <section className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              SKILL.md preview
            </div>
            <div
              className={
                showFullBody
                  ? 'rounded-md border border-white/10 bg-black/30 p-3 text-xs text-slate-200 whitespace-pre-wrap break-words max-h-96 overflow-y-auto'
                  : 'relative max-h-[120px] overflow-hidden rounded-md border border-white/10 bg-black/30 p-3 text-xs text-slate-200 whitespace-pre-wrap break-words'
              }
            >
              {body}
              {!showFullBody && body.split('\n').length > 6 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/80 to-transparent" />
              )}
            </div>
            {body.split('\n').length > 6 && (
              <button
                type="button"
                onClick={() => setShowFullBody((s) => !s)}
                className="text-[11px] text-sky-300 hover:text-sky-200"
              >
                {showFullBody ? 'Show less' : 'Show full'}
              </button>
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
              disabled={pendingOption !== null}
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
      <div className="text-[11px] text-slate-400">{label}</div>
      <ul className="ml-2 mt-0.5 space-y-0.5 text-xs text-slate-200">
        {paths.map((p) => (
          <li key={p} className="font-mono text-[11px] text-slate-300">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
