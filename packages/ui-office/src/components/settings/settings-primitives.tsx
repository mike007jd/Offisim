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
    <section className="settings-section">
      <header className="settings-section-head">
        <div className="settings-section-title-wrap">
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      <Card className="settings-section-card">
        <CardContent className="settings-section-card-content">{children}</CardContent>
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
    <Card className={cn('settings-surface-card', className)}>
      <CardHeader className="settings-surface-card-head">
        <div className="settings-surface-card-copy">
          <CardTitle className="settings-surface-card-title">{title}</CardTitle>
          {description ? (
            <CardDescription className="settings-surface-card-description">
              {description}
            </CardDescription>
          ) : null}
        </div>
        {icon ? <div className="settings-surface-card-icon">{icon}</div> : null}
      </CardHeader>
      <CardContent className="settings-surface-card-content">{children}</CardContent>
    </Card>
  );
}

export function SectionLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="settings-section-label">
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
    <div className={cn('settings-field', className)}>
      <SectionLabel htmlFor={id}>{label}</SectionLabel>
      {children}
      {note ? <SettingsFieldNote>{note}</SettingsFieldNote> : null}
    </div>
  );
}

export function SettingsFieldNote({ children }: { children: ReactNode }) {
  return <p className="settings-field-note">{children}</p>;
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
    <div className={cn('settings-control-grid', className)} data-columns={columns}>
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
    <Alert variant={tone} className={cn('settings-notice', className)}>
      {icon}
      <AlertDescription className="settings-notice-description">{children}</AlertDescription>
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
    <div className="settings-stat-card" data-tone={tone}>
      <div className="settings-stat-card-label">{label}</div>
      <div className="settings-stat-card-value">{value}</div>
    </div>
  );
}

export function surfaceInputProps(className = '') {
  return cn('settings-surface-input', className);
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
