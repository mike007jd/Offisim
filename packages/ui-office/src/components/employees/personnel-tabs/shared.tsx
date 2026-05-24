import { EmptyState, cn } from '@offisim/ui-core';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function TabScrollShell({ children }: { children: ReactNode }) {
  return (
    <div data-personnel-tab-scroll className="h-full overflow-y-auto px-6 py-6">
      <div className="w-full">{children}</div>
    </div>
  );
}

export function TabSelectionEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
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
    <section className={cn('border-b border-line-soft py-sp-5', className)}>
      <header className="mb-sp-3">
        <h3 className="text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3">
          {title}
        </h3>
        {description ? <p className="mt-1 text-fs-meta text-ink-4">{description}</p> : null}
      </header>
      <div className="flex flex-col gap-sp-3">{children}</div>
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
    <div className={cn('flex flex-col gap-1.5', className)}>
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
  const className = 'text-fs-meta font-medium text-ink-2';
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
  return <p className="text-fs-meta text-ink-4">{children}</p>;
}

export function PersonnelReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <PersonnelField label={label}>
      <div className="min-h-9 rounded-r-sm border border-line-soft bg-surface-1 px-3 py-2 text-fs-sm text-ink-1">
        {value}
      </div>
    </PersonnelField>
  );
}

export function PersonnelSaveBar({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'shrink-0 border-t border-line-soft bg-surface-2 px-sp-5 py-3 shadow-overlay',
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-center justify-between gap-3">{children}</div>
    </div>
  );
}
