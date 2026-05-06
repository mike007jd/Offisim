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
    <section className="space-y-3 border-t border-border-default pt-4 first:border-t-0 first:pt-0">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="space-y-3">{children}</div>
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
      className={`rounded-xl border border-border-default bg-surface-elevated p-4 ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">
            {title}
          </p>
          {description ? <p className="mt-2 text-sm text-text-secondary">{description}</p> : null}
        </div>
        {icon ? (
          <div className="rounded-lg border border-border-focus bg-accent-muted p-2 text-accent-text">
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
      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted"
    >
      {children}
    </label>
  );
}

export function surfaceInputProps(className = '') {
  return `h-10 rounded-lg border-border-default bg-surface text-text-primary placeholder:text-text-muted focus-visible:ring-border-focus ${className}`;
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
