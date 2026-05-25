import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Two-letter initials from a display name. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** Compact relative time label, e.g. "2h ago", "Just now". */
export function relativeTime(at: number, from = Date.now()): string {
  const diff = at - from;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'Just now';
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return 'Just now';
}
