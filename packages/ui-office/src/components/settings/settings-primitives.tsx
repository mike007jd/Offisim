import { Card, CardContent } from '@offisim/ui-core';
import type { ReactNode } from 'react';

export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-sp-3">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-fs-sm leading-relaxed text-ink-3">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      <Card className="rounded-r-md border-line-soft bg-surface-1 shadow-elev-1">
        <CardContent className="flex flex-col gap-sp-4 p-sp-7">{children}</CardContent>
      </Card>
    </section>
  );
}

export function SurfaceCard({
  title,
  description,
  icon,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-r-md border border-line-soft bg-surface-1 p-sp-7 shadow-elev-1 ${className}`}
    >
      <div className="mb-sp-5 flex items-start justify-between gap-sp-4">
        <div>
          <p className="text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">{title}</p>
          {description ? <p className="mt-2 text-fs-sm text-ink-3">{description}</p> : null}
        </div>
        {icon ? (
          <div className="rounded-r-md border border-accent-ring bg-accent-surface p-2 text-accent">
            {icon}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function SectionLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-fs-meta font-semibold uppercase tracking-ls-caps text-ink-4"
    >
      {children}
    </label>
  );
}

export function surfaceInputProps(className = '') {
  return `h-10 rounded-r-sm border-line bg-surface-1 text-ink-1 placeholder:text-ink-4 focus:border-accent focus-visible:ring-accent-ring ${className}`;
}

export function formatCompatibilityLabel(value?: string) {
  switch (value) {
    case 'anthropic':
    case 'anthropic-compatible':
      return 'Anthropic-compatible';
    case 'openai':
      return 'OpenAI';
    case 'openai-compat':
    case 'openai-compatible':
      return 'OpenAI-compatible';
    case 'native':
      return 'Native transport';
    default:
      return 'Custom surface';
  }
}

export function formatSurfaceLabel(value?: string) {
  switch (value) {
    case 'coding-plan':
      return 'Coding plan';
    case 'general':
      return 'General API';
    default:
      return 'Runtime surface';
  }
}

export function capabilitySummary(
  capabilities:
    | {
        streaming?: boolean;
        thinking?: boolean;
        toolCalls?: boolean;
        toolStreaming?: boolean;
        codingPlan?: boolean;
      }
    | undefined,
) {
  const labels: string[] = [];
  if (capabilities?.streaming) labels.push('streaming');
  if (capabilities?.thinking) labels.push('thinking');
  if (capabilities?.toolCalls) labels.push('tools');
  if (capabilities?.toolStreaming) labels.push('tool stream');
  if (capabilities?.codingPlan) labels.push('coding plan');
  return labels.length > 0 ? labels.join(' • ') : 'manual configuration';
}
