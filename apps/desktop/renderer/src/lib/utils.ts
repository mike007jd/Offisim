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

/** Lowercase hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `bytes` is typed Uint8Array<ArrayBufferLike>; copy into a plain ArrayBuffer
  // so digest's BufferSource type is satisfied under TS 5.7+ (no SharedArrayBuffer).
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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
