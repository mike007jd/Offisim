import { useUiState } from '@/app/ui-state.js';
import { useUnfinishedThreads } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ArrowRight, History, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Top-of-window banner that surfaces unfinished work from a previous session.
 * Running threads invite "Resume", blocked threads invite "Review"; with more
 * than one it summarises the count. Dismissible, and renders nothing when there
 * is nothing to resume.
 */
export function ResumeBar() {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const unfinished = useUnfinishedThreads();
  const dismissed = useUiState((s) => s.resumeDismissed);
  const dismissResume = useUiState((s) => s.dismissResume);
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);
  const setCompany = useUiState((s) => s.setCompany);
  const setProject = useUiState((s) => s.setProject);
  const openThread = useUiState((s) => s.openThread);

  const items = unfinished.data ?? [];
  const shouldShowInSurface = surface === 'office' || surface === 'workspace';
  if (dismissed || items.length === 0 || !shouldShowInSurface) return null;

  const blocked = items.filter((i) => i.state === 'blocked').length;
  const only = items.length === 1 ? items[0] : null;
  const visibleItems = items.slice(0, 2);
  const overflowItems = items.slice(visibleItems.length);
  const extraCount = overflowItems.length;
  const summary = only
    ? only.state === 'blocked'
      ? `Review ${only.name}`
      : `Resume ${only.name}`
    : `${items.length} conversations need attention${blocked ? ` · ${blocked} blocked` : ''}`;

  function go(item: (typeof items)[number]) {
    // Point breadcrumbs at the thread's own scope before opening it, so the
    // top bar doesn't read the wrong company/project. setProject clears the
    // thread selection, so openThread must follow it.
    setCompany(item.companyId);
    setProject(item.projectId);
    if (surface !== 'office') setSurface('office');
    openThread(item.threadId);
    setOverflowOpen(false);
    dismissResume();
    // A running/queued/paused thread has an unfinished plan — kick the graph to
    // resume from its latest persisted checkpoint (fire-and-forget; the run
    // surfaces through the stage pill + activity log). Blocked threads await
    // human review, so they only navigate.
    if (item.state !== 'blocked') {
      void import('@/runtime/desktop-agent-runtime.js')
        .then(({ getDesktopAgentRuntime }) => getDesktopAgentRuntime(item.companyId))
        .then((runtime) => runtime.resume(item.threadId))
        .catch((err: unknown) => {
          console.warn('[ResumeBar] resume failed', { threadId: item.threadId, err });
        });
    }
  }

  return (
    <div className="off-resume" aria-live="polite">
      <Icon icon={History} size="sm" className="off-resume-glyph" />
      <span className="off-resume-text">{summary}</span>
      <span className="off-resume-chips">
        {visibleItems.map((item) => (
          <button
            key={item.threadId}
            type="button"
            className={cn('off-resume-chip off-focusable', `is-${item.state}`)}
            onClick={() => go(item)}
          >
            {item.state === 'blocked' ? 'Review' : 'Resume'} {item.name}
            <Icon icon={ArrowRight} size="sm" />
          </button>
        ))}
        {extraCount > 0 ? (
          <span
            className="off-resume-overflow"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOverflowOpen(false);
            }}
          >
            <button
              type="button"
              className="off-resume-more off-focusable"
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label={`${extraCount} more conversations`}
              onClick={() => setOverflowOpen((open) => !open)}
            >
              +{extraCount}
            </button>
            {overflowOpen ? (
              <span className="off-resume-menu" role="menu">
                {overflowItems.map((item) => (
                  <button
                    key={item.threadId}
                    type="button"
                    role="menuitem"
                    className={cn('off-resume-menu-item off-focusable', `is-${item.state}`)}
                    onClick={() => go(item)}
                  >
                    <span className="off-resume-menu-action">
                      {item.state === 'blocked' ? 'Review' : 'Resume'}
                    </span>
                    <span className="off-resume-menu-name">{item.name}</span>
                    <Icon icon={ArrowRight} size="sm" />
                  </button>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
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
