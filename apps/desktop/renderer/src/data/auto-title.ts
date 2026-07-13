import type { QueryClient } from '@tanstack/react-query';
import { reposOrNull } from './adapters.js';

/** Persisted default title for a freshly created chat thread (DB schema default
 *  + core auto-title fallback contract). A thread still carrying this value has
 *  never been titled, so it is eligible for auto-titling. */
const DEFAULT_THREAD_TITLE = 'New thread';

/** Sidebar rows are single-line; keep titles short enough to read at a glance
 *  while still carrying the gist of the first ask. Counted in code points so
 *  CJK and emoji never split a character. */
const MAX_TITLE_CHARS = 48;

/**
 * Derive a concise conversation title from the user's first message. Strips the
 * markdown noise that makes a poor sidebar label (code fences, list/heading
 * markers, emphasis, wrapping quotes), collapses to one line, and smart-truncates.
 * Returns null when nothing usable remains (caller keeps the default title).
 */
export function deriveThreadTitle(raw: string): string | null {
  if (!raw) return null;
  let text = raw;
  // Fenced code blocks never make good titles — drop them whole.
  text = text.replace(/```[\s\S]*?```/g, ' ');
  // Inline code: keep the content, drop the backticks.
  text = text.replace(/`([^`]+)`/g, '$1');
  // Leading markdown block markers (heading / list / ordered-list / quote, with
  // an optional task-list checkbox), only when followed by space so real
  // content like "2026 Q3" is preserved.
  text = text.replace(
    /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]?\][ \t]+)?|\d+[.)][ \t]+|>[ \t]+)/gm,
    '',
  );
  // Emphasis / strikethrough markers.
  text = text.replace(/[*_~]+/g, '');
  // Collapse every run of whitespace (incl. newlines) to a single space.
  text = text.replace(/\s+/g, ' ').trim();
  // Strip wrapping quotes (ASCII + common CJK/smart quotes).
  text = text.replace(/^["'“”‘’「『（(]+|["'“”‘’」』）)]+$/g, '').trim();
  if (!text) return null;
  return smartTruncate(text, MAX_TITLE_CHARS);
}

function smartTruncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const window = chars.slice(0, max).join('');
  // Prefer a word boundary, but only when it keeps a meaningful head (avoids
  // titling on a stray early space). CJK has no spaces → hard cut at `max`.
  const lastSpace = window.lastIndexOf(' ');
  const head = lastSpace > max * 0.5 ? window.slice(0, lastSpace) : window;
  return `${head.trimEnd()}…`;
}

/**
 * Auto-title a thread from its first user message, idempotently.
 *
 * No-op when the thread is missing, the user has renamed it
 * (`title_set_by_user`), or it already carries a non-default title — so the
 * first usable message wins and later messages never re-title. Writes through
 * the `{ byUser: false }` contract, which independently refuses to clobber a
 * manual rename, then invalidates the conversation-list queries that feed both
 * the Office rail and the Workspace messenger (shared `['threads', projectId]`
 * key + the recent/unfinished list).
 */
export async function autoTitleThreadFromFirstMessage(input: {
  threadId: string;
  projectId: string | null;
  firstUserText: string;
  queryClient: QueryClient;
}): Promise<string | null> {
  const title = deriveThreadTitle(input.firstUserText);
  if (!title) return null;
  const repos = await reposOrNull();
  if (!repos) return null;
  const existing = await repos.chatThreads.findById(input.threadId);
  if (!existing) return null;
  if (existing.title_set_by_user === 1) return null;
  const current = existing.title?.trim();
  if (current && current !== DEFAULT_THREAD_TITLE) return null;

  const result = await repos.chatThreads.updateTitle(input.threadId, title, { byUser: false });
  if (!result.persisted || result.title_set_by_user === 1) return null;
  await Promise.all([
    input.queryClient.invalidateQueries({ queryKey: ['threads', input.projectId] }),
    input.queryClient.invalidateQueries({ queryKey: ['unfinished-threads'] }),
  ]);
  return result.title;
}
