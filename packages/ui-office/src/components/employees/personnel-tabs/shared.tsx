import { EmptyState, cn } from '@offisim/ui-core';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function TabScrollShell({ children }: { children: ReactNode }) {
  return (
    <div data-personnel-tab-scroll className="personnel-tab-scroll-shell">
      <div className="personnel-tab-scroll-inner">{children}</div>
    </div>
  );
}

export function TabSelectionEmpty({ message }: { message: string }) {
  return (
    <div className="personnel-tab-empty">
      <EmptyState variant="compact" title={message} />
    </div>
  );
}

export function PersonnelTabSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('personnel-tab-section', className)}>
      <header>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function PersonnelField({
  label,
  htmlFor,
  note,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('personnel-field', className)}>
      <PersonnelFieldLabel htmlFor={htmlFor}>{label}</PersonnelFieldLabel>
      {children}
      {note ? <PersonnelFieldNote>{note}</PersonnelFieldNote> : null}
    </div>
  );
}

export function PersonnelFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  const className = 'personnel-field-label';
  if (!htmlFor) {
    return <span className={className}>{children}</span>;
  }
  return (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  );
}

export function PersonnelFieldNote({ children }: { children: ReactNode }) {
  return <p className="personnel-field-note">{children}</p>;
}

export function PersonnelReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <PersonnelField label={label}>
      <div className="personnel-readonly-field">{value}</div>
    </PersonnelField>
  );
}

export function PersonnelSaveBar({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('personnel-save-bar', className)} {...props}>
      <div>{children}</div>
    </div>
  );
}
