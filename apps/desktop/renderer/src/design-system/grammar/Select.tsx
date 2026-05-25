import { cn } from '@/lib/utils.js';
import type { SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: ReadonlyArray<SelectOption>;
  sunken?: boolean;
  className?: string;
}

export function Select({ options, sunken = false, className, ...props }: SelectProps) {
  return (
    <select className={cn('off-select off-focusable', sunken && 'is-sunken', className)} {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
