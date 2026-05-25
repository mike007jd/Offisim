import { Input } from '@/design-system/primitives/input.js';
import { cn } from '@/lib/utils.js';
import { Search } from 'lucide-react';
import type { ChangeEvent } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Sunken search field with a leading icon — the shared filter-strip search. */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-[10px] top-1/2 size-[14px] -translate-y-1/2 text-[var(--off-ink-4)]" />
      <Input
        className="h-[30px] bg-[var(--off-surface-sunken)] pl-[30px]"
        value={value}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  );
}
