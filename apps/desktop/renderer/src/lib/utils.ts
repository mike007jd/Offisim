import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "note-reader" / "qa_engineer" → "Note Reader" / "Qa Engineer" — plain
 *  title-cased words from a kebab/snake slug (no acronym handling). */
export function titleizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Escape a literal string for embedding in a RegExp pattern. */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Two-letter initials from a display name. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '??').toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** Compact relative time label, e.g. "2h ago", "now". */
export function relativeTime(at: number, from = Date.now()): string {
  const diff = at - from;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'now';
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return fmt.format(Math.trunc(diff / ms), unit);
  }
  return 'now';
}

/** Tightest age label for chat rows and bubbles: "now", "5m", "3h", "2d".
 *  Use where the surrounding copy already establishes that the value is an age. */
export function compactAge(atMs: number, from = Date.now()): string {
  if (!Number.isFinite(atMs)) return '';
  const diff = Math.max(0, from - atMs);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'now';
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}
