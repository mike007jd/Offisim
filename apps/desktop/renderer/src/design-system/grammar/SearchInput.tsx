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
    <div className={cn('off-search-input-wrap', className)}>
      <Search className="off-search-input-icon" />
      <Input
        className="off-search-input"
        value={value}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </div>
  );
}
