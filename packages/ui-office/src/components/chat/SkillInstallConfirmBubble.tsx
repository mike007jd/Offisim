import type {
  InteractionRequest,
  SkillInstallConfirmInteractionContext,
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
      : `Employee: ${context.resolvedEmployeeName ?? context.resolvedEmployeeId ?? 'selected employee'}`;

  return (
    <Card className="border-white/10 bg-black/30 backdrop-blur-md">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm text-white">Install skill · {context.skillName}</CardTitle>
          <Badge variant={hasWideScopeTool ? 'error' : 'secondary'}>
            {hasWideScopeTool ? 'Review permissions' : 'Confirm install'}
          </Badge>
        </div>
        {employeeName && <span className="text-xs text-slate-400">From: {employeeName}</span>}
        <p className="whitespace-pre-wrap text-xs text-slate-300">{context.skillDescription}</p>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <section className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Source
          </div>
          <p className="break-all text-xs text-slate-200">
            {describeSource(context.sourceKind, context.sourceRef)}
          </p>
        </section>

        <section className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Scope
          </div>
          <p className="text-xs text-slate-200">{scopeLabel}</p>
        </section>

        {(partitioned.scripts.length > 0 ||
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

        {body.length > 0 && (
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
