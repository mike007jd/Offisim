import { useUiState } from '@/app/ui-state.js';
import { useDeliverables } from '@/data/queries.js';
import {
  type MissionTransition,
  missionKeys,
  useMission,
  useMissionAttempts,
  useMissionCriteria,
  useMissionEvaluations,
  useMissionTransition,
} from '@/data/missions.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { EmptyState, ErrorState, SkeletonRows, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleDot,
  CircleHelp,
  Clock,
  FileCode2,
  Hourglass,
  type LucideIcon,
  Pause,
  Play,
  Loader2,
  Rocket,
  ShieldAlert,
  Target,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/** Mission statuses where the run loop is live (drives query polling). */
const ACTIVE_STATUSES = new Set(['running', 'verifying', 'repairing']);

/** Subscribe to the MissionRunManager's in-flight set for THIS mission, so the
 *  Start button reflects an in-flight run across navigation (the run lives in the
 *  manager, not this component). */
function useMissionRunning(missionId: string): boolean {
  return useSyncExternalStore(
    missionRunManager.subscribe,
    () => missionRunManager.isRunning(missionId),
  );
}
import {
  type CriterionStatusView,
  type MissionStatusView,
  type StatusGlyph,
  controlAvailability,
  criterionStatusView,
  evaluatorLabel,
  latestEvaluationByCriterion,
  missionStatusView,
  parseEvidenceRefs,
  parseMissionBudget,
  summarizeIncompletion,
} from './mission-domain.js';

/**
 * UX-002 Mission Control (PRD §24.3) — observe + control a single mission. Folds
 * UX-003 (criteria + evaluation + evidence), UX-004 (artifacts), UX-005
 * (budget/usage) and UX-006 (pause/resume/cancel). All reads come from the real
 * mission repos; every control goes through MissionService (the §18 single
 * writer) via `useMissionTransition`, disabled when illegal from the current
 * state with a reason.
 */

const STATUS_GLYPH_ICON: Record<StatusGlyph, LucideIcon> = {
  draft: CircleDashed,
  ready: CircleDot,
  running: Loader2,
  verifying: Loader2,
  paused: Pause,
  blocked: ShieldAlert,
  failed: XCircle,
  completed: CheckCircle2,
  cancelled: Ban,
  waiting: Hourglass,
};

const CRITERION_GLYPH_ICON: Record<CriterionStatusView['glyph'], LucideIcon> = {
  pass: CheckCircle2,
  fail: XCircle,
  blocked: ShieldAlert,
  pending: CircleDashed,
  error: CircleAlert,
  skip: CircleHelp,
};

function MissionStatusBadge({ view }: { view: MissionStatusView }) {
  const GlyphIcon = STATUS_GLYPH_ICON[view.glyph];
  return (
    <span className={cn('off-mission-status', `is-${view.tone}`)}>
      <Icon icon={GlyphIcon} size="sm" className={view.active ? 'off-mission-spin' : undefined} />
      {view.label}
    </span>
  );
}

interface MissionControlProps {
  missionId: string;
  onBack: () => void;
}

export function MissionControl({ missionId, onBack }: MissionControlProps) {
  const companyId = useUiState((s) => s.companyId);
  const queryClient = useQueryClient();
  const isRunning = useMissionRunning(missionId);
  // Pass the in-memory run flag so the detail query starts polling the instant
  // Start is clicked (before the first `running` row lands).
  const mission = useMission(missionId, isRunning);
  const missionStatus = mission.data?.status;
  // Poll the loop-written rows while the run is live (in-memory flag OR an active
  // DB status — the flag covers the gap before the first `running` row lands).
  const active = isRunning || (missionStatus ? ACTIVE_STATUSES.has(missionStatus) : false);
  const criteria = useMissionCriteria(missionId, active);
  const attempts = useMissionAttempts(missionId, active);
  const evaluations = useMissionEvaluations(missionId, active);
  const transition = useMissionTransition(companyId || null);

  // On an actual running↔idle EDGE (not the initial mount or unrelated re-renders),
  // refresh the mission + its rows: a fresh start flips the detail query off its
  // cached `ready`, and the terminal status/rows land the moment the loop ends.
  const prevIsRunning = useRef(isRunning);
  useEffect(() => {
    if (prevIsRunning.current === isRunning) return;
    prevIsRunning.current = isRunning;
    queryClient.invalidateQueries({ queryKey: missionKeys.detail(missionId) });
    queryClient.invalidateQueries({ queryKey: missionKeys.attempts(missionId) });
    queryClient.invalidateQueries({ queryKey: missionKeys.evaluations(missionId) });
    queryClient.invalidateQueries({ queryKey: missionKeys.criteria(missionId) });
  }, [isRunning, missionId, queryClient]);

  const threadId = mission.data?.thread_id ?? null;
  const deliverables = useDeliverables(threadId);

  const statusView = useMemo(
    () => (mission.data ? missionStatusView(mission.data.status) : null),
    [mission.data],
  );

  const latestEval = useMemo(
    () => latestEvaluationByCriterion(criteria.data ?? [], evaluations.data ?? []),
    [criteria.data, evaluations.data],
  );

  const incompletion = useMemo(
    () => summarizeIncompletion(criteria.data ?? [], evaluations.data ?? []),
    [criteria.data, evaluations.data],
  );

  const budget = useMemo(
    () => (mission.data ? parseMissionBudget(mission.data.budget_json) : null),
    [mission.data],
  );

  const currentAttempt = useMemo(() => {
    const list = attempts.data ?? [];
    if (mission.data?.current_attempt_id) {
      return list.find((a) => a.attempt_id === mission.data?.current_attempt_id) ?? null;
    }
    return list[list.length - 1] ?? null;
  }, [attempts.data, mission.data?.current_attempt_id]);

  async function runTransition(action: MissionTransition) {
    try {
      if (action === 'cancel') {
        // Nudge the in-flight agent run to return promptly so the spinner clears
        // with the cancel rather than lingering until the agent finishes on its own.
        missionRunManager.requestAbort(missionId);
      }
      await transition.mutateAsync({ missionId, action });
      toast.success(
        action === 'pause' ? 'Mission paused' : action === 'resume' ? 'Mission resumed' : 'Mission cancelled',
      );
    } catch (error) {
      toast.error('Could not update mission', { description: safeErrorMessage(error) });
    }
  }

  async function handleStart() {
    if (!companyId) {
      toast.error('Select a company first');
      return;
    }
    try {
      // Hands the run off to the manager (it continues off this component's
      // lifecycle); the status badge + criteria then track it via the polling.
      await missionRunManager.start(missionId, companyId);
    } catch (error) {
      toast.error('Could not start mission', { description: safeErrorMessage(error) });
    }
  }

  if (mission.isError) {
    return (
      <div className="off-mission-detail">
        <ErrorState
          title="Couldn't load mission"
          detail={errorDetail(mission.error, 'The mission failed to load.')}
          onRetry={() => void mission.refetch()}
        />
      </div>
    );
  }

  if (mission.isLoading || !mission.data || !statusView) {
    return (
      <div className="off-mission-detail">
        <SkeletonRows rows={6} />
      </div>
    );
  }

  const m = mission.data;
  const startAvail = controlAvailability('start', m.status);
  const pauseAvail = controlAvailability('pause', m.status);
  const resumeAvail = controlAvailability('resume', m.status);
  const cancelAvail = controlAvailability('cancel', m.status);

  return (
    <div className="off-mission-detail">
      <header className="off-mission-detail-head">
        <Button variant="subtle" size="sm" onClick={onBack}>
          <Icon icon={ArrowLeft} size="sm" />
          Missions
        </Button>
        <div className="off-mission-detail-title">
          <Icon icon={Target} size="sm" />
          <span className="off-mission-detail-name">{m.title}</span>
        </div>
        <MissionStatusBadge view={statusView} />
        <div className="off-mission-controls">
          <Button
            variant="default"
            size="sm"
            disabled={!startAvail.enabled || isRunning}
            title={isRunning ? 'Mission is running' : startAvail.reason}
            onClick={() => void handleStart()}
          >
            <Icon icon={isRunning ? Loader2 : Rocket} size="sm" className={isRunning ? 'off-mission-spin' : undefined} />
            {isRunning ? 'Running' : 'Start'}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={!pauseAvail.enabled || transition.isPending}
            title={pauseAvail.reason}
            onClick={() => void runTransition('pause')}
          >
            <Icon icon={Pause} size="sm" />
            Pause
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={!resumeAvail.enabled || transition.isPending}
            title={resumeAvail.reason}
            onClick={() => void runTransition('resume')}
          >
            <Icon icon={Play} size="sm" />
            Resume
          </Button>
          <Button
            variant="outlineDanger"
            size="sm"
            disabled={!cancelAvail.enabled || transition.isPending}
            title={cancelAvail.reason}
            onClick={() => void runTransition('cancel')}
          >
            <Icon icon={Ban} size="sm" />
            Cancel
          </Button>
        </div>
      </header>

      <div className="off-mission-detail-body">
        {/* Phase + attempt strip */}
        <div className="off-mission-phase">
          <div className="off-mission-phase-cell">
            <CapsLabel>Phase</CapsLabel>
            <span className="off-mission-phase-v">{statusView.label}</span>
          </div>
          <div className="off-mission-phase-cell">
            <CapsLabel>Attempt</CapsLabel>
            <span className="off-mission-phase-v">
              {currentAttempt ? `#${currentAttempt.attempt_number}` : '—'}
              {currentAttempt ? (
                <span className="off-mission-phase-sub"> · {currentAttempt.status}</span>
              ) : null}
            </span>
          </div>
          <div className="off-mission-phase-cell">
            <CapsLabel>Required passed</CapsLabel>
            <span className="off-mission-phase-v">
              {incompletion.requiredPassed}/{incompletion.requiredTotal}
            </span>
          </div>
        </div>

        {/* Goal */}
        <section className="off-mission-card">
          <CapsLabel>Goal</CapsLabel>
          <p className="off-mission-goal">{m.goal}</p>
        </section>

        {/* Why not complete */}
        {m.status !== 'completed' && incompletion.blockers.length > 0 ? (
          <section className="off-mission-card off-mission-why">
            <div className="off-mission-why-head">
              <Icon icon={Clock} size="sm" />
              <CapsLabel>Why it isn’t complete yet</CapsLabel>
            </div>
            <ul className="off-mission-why-list">
              {incompletion.blockers.map((b) => (
                <li key={b.criterionId} className="off-mission-why-item">
                  <span className="off-mission-why-status">{criterionStatusView(b.status).label}</span>
                  <span className="off-mission-why-desc">{b.description}</span>
                  {b.latestSummary ? (
                    <span className="off-mission-why-sum">{b.latestSummary}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : m.status === 'completed' ? (
          <section className="off-mission-card off-mission-why is-done">
            <div className="off-mission-why-head">
              <Icon icon={CheckCircle2} size="sm" />
              <CapsLabel>All required criteria passed</CapsLabel>
            </div>
          </section>
        ) : null}

        {/* Criteria */}
        <section className="off-mission-card">
          <div className="off-mission-card-head">
            <CapsLabel>Done-when criteria</CapsLabel>
            <span className="off-rail-sec-count">{criteria.data?.length ?? 0}</span>
          </div>
          {criteria.isLoading ? (
            <SkeletonRows rows={3} />
          ) : criteria.data && criteria.data.length > 0 ? (
            <ul className="off-mission-criteria-list">
              {criteria.data.map((c) => {
                const view = criterionStatusView(c.status);
                const GlyphIcon = CRITERION_GLYPH_ICON[view.glyph];
                const ev = latestEval.get(c.criterion_id);
                const evidence = ev ? parseEvidenceRefs(ev.evidence_refs_json) : [];
                return (
                  <li key={c.criterion_id} className={cn('off-mission-crit', `is-${view.tone}`)}>
                    <div className="off-mission-crit-top">
                      <span className={cn('off-mission-crit-status', `is-${view.tone}`)}>
                        <Icon icon={GlyphIcon} size="sm" />
                        {view.label}
                      </span>
                      <span className="off-mission-crit-desc">{c.description}</span>
                      {c.required === 1 ? (
                        <span className="off-mission-crit-req">Required</span>
                      ) : (
                        <span className="off-mission-crit-opt">Optional</span>
                      )}
                    </div>
                    <div className="off-mission-crit-meta">
                      <span className="off-mission-crit-eval">{evaluatorLabel(c.evaluator_id)}</span>
                      {ev ? <span className="off-mission-crit-sum">{ev.summary}</span> : null}
                    </div>
                    {evidence.length > 0 ? (
                      <div className="off-mission-crit-evidence">
                        {evidence.map((ref) => (
                          <span key={ref} className="off-mission-evidence-chip">
                            {ref}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="off-mission-empty-line">No criteria on this mission.</p>
          )}
        </section>

        {/* Artifacts (UX-004) + Budget/usage (UX-005) side by side */}
        <div className="off-mission-split">
          <section className="off-mission-card">
            <div className="off-mission-card-head">
              <CapsLabel>Artifacts</CapsLabel>
              <span className="off-rail-sec-count">{deliverables.data?.length ?? 0}</span>
            </div>
            {!threadId ? (
              <p className="off-mission-empty-line">This mission has no thread yet.</p>
            ) : deliverables.isLoading ? (
              <SkeletonRows rows={2} />
            ) : deliverables.isError ? (
              <p className="off-field-hint is-warn">
                {errorDetail(deliverables.error, 'Artifacts failed to load.')}
              </p>
            ) : deliverables.data && deliverables.data.length > 0 ? (
              <ul className="off-mission-artifacts">
                {deliverables.data.map((d) => (
                  <li key={d.id} className="off-mission-artifact">
                    <Icon icon={FileCode2} size="sm" />
                    <span className="off-mission-artifact-name">{d.name}</span>
                    {d.format ? <span className="off-fmt-tag">{d.format}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="off-mission-empty-line">
                No deliverables published yet. Artifacts the run publishes will appear here.
              </p>
            )}
          </section>

          <section className="off-mission-card">
            <div className="off-mission-card-head">
              <Icon icon={Wallet} size="sm" />
              <CapsLabel>Budget &amp; usage</CapsLabel>
            </div>
            <dl className="off-mission-budget">
              <div className="off-mission-budget-row">
                <dt>Token budget</dt>
                <dd>{budget?.tokenBudget ? budget.tokenBudget.toLocaleString() : 'No limit set'}</dd>
              </div>
              <div className="off-mission-budget-row">
                <dt>Attempts run</dt>
                <dd>{attempts.data?.length ?? 0}</dd>
              </div>
            </dl>
            <p className="off-field-hint">
              Live per-attempt token spend lands on the run records once the mission runs. This
              panel reflects the authored budget and the recorded attempt count.
            </p>
          </section>
        </div>

        {/* Honest empty if nothing has run */}
        {(attempts.data?.length ?? 0) === 0 && m.status === 'ready' && !isRunning ? (
          <EmptyState
            icon={Target}
            title="Mission is ready"
            description="Nothing has run yet. Start the mission to run it against its acceptance criteria."
            action={{ label: 'Start mission', onClick: () => void handleStart() }}
          />
        ) : null}
      </div>
    </div>
  );
}
