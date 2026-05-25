import { useUiState } from '@/app/ui-state.js';
import { useUnfinishedThreads } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ArrowRight, History, X } from 'lucide-react';

/**
 * Top-of-window banner that surfaces unfinished work from a previous session.
 * Running threads invite "Resume", blocked threads invite "Review"; with more
 * than one it summarises the count. Dismissible, and renders nothing when there
 * is nothing to resume.
 */
export function ResumeBar() {
  const unfinished = useUnfinishedThreads();
  const dismissed = useUiState((s) => s.resumeDismissed);
  const dismissResume = useUiState((s) => s.dismissResume);
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);
  const openThread = useUiState((s) => s.openThread);

  const items = unfinished.data ?? [];
  if (dismissed || items.length === 0) return null;

  const blocked = items.filter((i) => i.state === 'blocked').length;
  const only = items.length === 1 ? items[0] : null;
  const summary = only
    ? only.state === 'blocked'
      ? `Review ${only.name}`
      : `Resume ${only.name}`
    : `${items.length} conversations need attention${blocked ? ` · ${blocked} blocked` : ''}`;

  function go(threadId: string) {
    if (surface !== 'office') setSurface('office');
    openThread(threadId);
    dismissResume();
  }

  return (
    <div className="off-resume" aria-live="polite">
      <Icon icon={History} size="sm" className="off-resume-glyph" />
      <span className="off-resume-text">{summary}</span>
      <span className="off-resume-chips">
        {items.map((item) => (
          <button
            key={item.threadId}
            type="button"
            className={cn('off-resume-chip off-focusable', `is-${item.state}`)}
            onClick={() => go(item.threadId)}
          >
            {item.state === 'blocked' ? 'Review' : 'Resume'} {item.name}
            <Icon icon={ArrowRight} size="sm" />
          </button>
        ))}
      </span>
      <button
        type="button"
        className="off-resume-x off-focusable"
        aria-label="Dismiss"
        onClick={dismissResume}
      >
        <Icon icon={X} size="sm" />
      </button>
    </div>
  );
}
