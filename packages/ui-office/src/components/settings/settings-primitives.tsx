import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@offisim/ui-core';
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
        <CardContent className="flex flex-col gap-sp-4 p-sp-5">{children}</CardContent>
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
    <Card className={cn('rounded-r-md border-line-soft bg-surface-1 shadow-elev-1', className)}>
      <CardHeader className="flex-row items-start justify-between gap-sp-4 p-sp-5 pb-sp-3">
        <div className="min-w-0">
          <CardTitle className="text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="mt-2 text-fs-sm text-ink-3">{description}</CardDescription>
          ) : null}
        </div>
        {icon ? (
          <div className="rounded-r-md border border-accent-ring bg-accent-surface p-2 text-accent">
            {icon}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-sp-5 pt-0">{children}</CardContent>
    </Card>
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

export function SettingsField({
  id,
  label,
  note,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <SectionLabel htmlFor={id}>{label}</SectionLabel>
      {children}
      {note ? <SettingsFieldNote>{note}</SettingsFieldNote> : null}
    </div>
  );
}

export function SettingsFieldNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-fs-meta leading-relaxed text-ink-4">{children}</p>;
}

export function SettingsControlGrid({
  children,
  columns = 2,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-sp-4',
        columns === 2 && 'md:grid-cols-2',
        columns === 3 && 'md:grid-cols-2 xl:grid-cols-3',
        columns === 4 && 'md:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsNotice({
  tone = 'default',
  icon,
  children,
  className,
}: {
  tone?: 'default' | 'warning' | 'success' | 'destructive';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert variant={tone} className={cn('rounded-r-sm px-3 py-2 text-fs-meta', className)}>
      {icon}
      <AlertDescription className="text-fs-meta leading-relaxed">{children}</AlertDescription>
    </Alert>
  );
}

export function SettingsStatCard({
  label,
  value,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-r-sm border px-3 py-3',
        tone === 'warning'
          ? 'border-warn/30 bg-warn-surface text-warn'
          : 'border-line bg-surface-1 text-ink-1',
      )}
    >
      <div
        className={cn('text-fs-meta font-medium', tone === 'warning' ? 'text-warn' : 'text-ink-3')}
      >
        {label}
      </div>
      <div className="mt-1 text-fs-sm font-semibold">{value}</div>
    </div>
  );
}

export function surfaceInputProps(className = '') {
  return cn(
    'h-10 rounded-r-sm border-line bg-surface-1 text-ink-1 placeholder:text-ink-4 focus:border-accent focus-visible:ring-accent-ring',
    className,
  );
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
