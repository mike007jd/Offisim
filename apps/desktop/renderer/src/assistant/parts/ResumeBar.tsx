import { useUiState } from '@/app/ui-state.js';
import { useUnfinishedThreads } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ensureProjectBoundForRun } from '@/runtime/ensure-default-workspace.js';
import { getRepos } from '@/runtime/repos.js';
import { ArrowRight, History, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Top-of-window banner that surfaces unfinished work from a previous session.
 * Running threads invite "Resume", blocked threads invite "Review"; with more
 * than one it summarises the count. Dismissible, and renders nothing when there
 * is nothing to resume.
 */
export function ResumeBar() {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const resumeSeq = useRef(0);
  const unfinished = useUnfinishedThreads();
  const dismissed = useUiState((s) => s.resumeDismissed);
  const dismissResume = useUiState((s) => s.dismissResume);
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);
  const setScope = useUiState((s) => s.setScope);
  const openThread = useUiState((s) => s.openThread);

  const items = unfinished.data ?? [];
  const shouldShowInSurface = surface === 'office' || surface === 'workspace';
  if (dismissed || items.length === 0 || !shouldShowInSurface) return null;

  const blocked = items.filter((i) => i.state === 'blocked').length;
  const only = items.length === 1 ? items[0] : null;
  const visibleItems = items.slice(0, 2);
  const overflowItems = items.slice(visibleItems.length);
  const extraCount = overflowItems.length;
  const scopeText = (item: (typeof items)[number]) =>
    [item.companyName, item.projectName].filter(Boolean).join(' · ');
  const summary = only
    ? only.state === 'blocked'
      ? `Review failure: ${only.name}${scopeText(only) ? ` · ${scopeText(only)}` : ''}`
      : `Resume ${only.name}${scopeText(only) ? ` · ${scopeText(only)}` : ''}`
    : `${items.length} conversations need attention${blocked ? ` · ${blocked} blocked` : ''}`;

  async function resolveResumeProjectId(item: (typeof items)[number]): Promise<string | null> {
    const repos = await getRepos();
    const company = await repos.companies.findById(item.companyId);
    if (!company) throw new Error('Company no longer exists.');
    if (item.state === 'blocked') {
      const projectId = item.projectId.trim() || null;
      if (!projectId) return null;
      const project = await repos.projects.findById(projectId);
      if (!project) throw new Error('Project no longer exists.');
      if (project.company_id !== item.companyId) {
        throw new Error('Project does not belong to company.');
      }
      return projectId;
    }
    return ensureProjectBoundForRun(repos, item.companyId, item.projectId || null);
  }

  function go(item: (typeof items)[number]) {
    // Point breadcrumbs at the thread's own scope before opening it, then open
    // the thread after setScope clears any stale selection.
    const seq = ++resumeSeq.current;
    setOverflowOpen(false);
    void resolveResumeProjectId(item)
      .then((projectId) => {
        if (seq !== resumeSeq.current) return;
        setScope(item.companyId, projectId ?? '');
        if (surface !== 'office') setSurface('office');
        openThread(item.threadId);
        if (item.state === 'blocked') return;
        void import('@/runtime/desktop-agent-runtime.js')
          .then(({ getDesktopAgentRuntime }) => getDesktopAgentRuntime(item.companyId))
          .then(async (runtime) => {
            const result = await runtime.resume(item.threadId, projectId);
            if (seq !== resumeSeq.current) return;
            dismissResume();
            if (!result) {
              toast('Conversation already completed', {
                description: 'The saved run had no unfinished turn to resume.',
              });
            }
          })
          .catch((err: unknown) => {
            if (seq !== resumeSeq.current) return;
            console.warn('[ResumeBar] resume failed', { threadId: item.threadId, err });
            toast.error('Conversation resume failed', {
              description: err instanceof Error ? err.message : 'Could not restart the run.',
            });
            void unfinished.refetch();
          });
      })
      .catch((err: unknown) => {
        if (seq !== resumeSeq.current) return;
        console.warn('[ResumeBar] could not resolve resume project', {
          threadId: item.threadId,
          err,
        });
        toast.error("Conversation can't resume", {
          description: err instanceof Error ? err.message : 'Could not bind a project.',
        });
      });
    // A running/queued/paused thread has an unfinished plan — kick the graph to
    // resume from its latest persisted checkpoint (fire-and-forget; the run
    // surfaces through the stage pill + activity log). Blocked threads await
    // human review, so they only navigate.
  }

  return (
    <div className="off-resume" aria-live="polite">
      <Icon icon={History} size="sm" className="off-resume-glyph" />
      <span className="off-resume-text">{summary}</span>
      <span className="off-resume-chips">
        {visibleItems.map((item) => {
          const action = item.state === 'blocked' ? 'Review failure' : 'Resume';
          return (
            <button
              key={item.threadId}
              type="button"
              className={cn('off-resume-chip off-focusable', `is-${item.state}`)}
              title={`${action} ${item.name}${scopeText(item) ? ` · ${scopeText(item)}` : ''}`}
              onClick={() => go(item)}
            >
              <span className="off-resume-chip-text">
                {action} {item.name}
              </span>
              <Icon icon={ArrowRight} size="sm" />
            </button>
          );
        })}
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
                      {item.state === 'blocked' ? 'Review failure' : 'Resume'}
                    </span>
                    <span className="off-resume-menu-name">
                      {item.name}
                      {scopeText(item) ? ` · ${scopeText(item)}` : ''}
                    </span>
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
