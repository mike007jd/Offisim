import { cn } from '@/lib/utils.js';
import { type ReactNode, useId } from 'react';

interface FieldRowProps {
  label: ReactNode;
  hint?: ReactNode;
  warn?: boolean;
  className?: string;
  htmlFor?: string;
  children: (props: { id: string }) => ReactNode;
}

export function FieldRow({
  label,
  hint,
  warn = false,
  className,
  htmlFor,
  children,
}: FieldRowProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  return (
    <div className={cn('off-field', className)}>
      <label className="off-field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id })}
      {hint ? <p className={cn('off-field-hint', warn && 'is-warn')}>{hint}</p> : null}
    </div>
  );
}
