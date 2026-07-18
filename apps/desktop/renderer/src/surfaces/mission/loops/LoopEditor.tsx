import { useUiState } from '@/app/ui-state.js';
import { startLoopAsParallelProjectRun } from '@/assistant/runtime/loop-send-execution.js';
import {
  compileLoopPreview,
  useCreateLoop,
  useLoop,
  useLoopRevisions,
  useSaveLoopRevision,
  useSelectLoopRevision,
  useUpdateLoopDraftSummary,
} from '@/data/loops.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { LoopGraphPanel } from '@/surfaces/mission/loops/graph/index.js';
import { ErrorState, SkeletonRows, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { DEFAULT_COMPILER_PROFILE_ID, type LoopCompileResult } from '@offisim/core/browser';
import type { LoopValidationFinding } from '@offisim/shared-types';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  History,
  Loader2,
  Save,
  Sparkles,
  SquarePlay,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LoopAdvancedDrawer } from './LoopAdvancedDrawer.js';
import { LoopQuestionCards } from './LoopQuestionCards.js';
import { LoopVersionPanel } from './LoopVersionPanel.js';
import {
  type CompiledRevisionView,
  EMPTY_AUTHORING_MODEL,
  type LoopAuthoringModel,
  canCompile,
  canSave,
  canUseInOffice,
  deriveAuthoringState,
  graphStateFor,
  isDirty,
  useBlockedReason,
} from './loop-authoring-machine.js';
import { parseLoopIr } from './loop-generated-details.js';

/**
 * The prompt-first Loop EDITOR (PR-08). Layout per spec:
 *   - TOP / main area  → the `LoopGraphPanel` for the current compiled revision.
 *   - BOTTOM (fixed)   → ONE natural-language composer (the only required input).
 *   - RIGHT drawer     → selected-node inspector / findings / version + generated
 *                        details (read-only, light).
 *
 * It drives the deterministic authoring state machine and wires preview generation
 * plus exact-preview persistence. It never shows raw
 * evaluator JSON / criteria forms — details are generated read-only summaries.
 */

const EXAMPLE_PROMPTS = [
  'Ship a small feature end to end: implement it, write tests, and keep the build green. Pause for me before pushing.',
  'Triage incoming bug reports each morning: reproduce, label by severity, and draft a fix plan for the top three.',
  'Keep our docs in sync with the code: when an API changes, update the reference and flag breaking changes for review.',
];

interface LoopEditorProps {
  loopId: string | null;
  onCreated: (loopId: string) => void;
  onBack: () => void;
}

export function LoopEditor({ loopId, onCreated, onBack }: LoopEditorProps) {
  const companyId = useUiState((s) => s.companyId) || null;
  const projectId = useUiState((s) => s.projectId) || null;
  const [createdLoopId, setCreatedLoopId] = useState<string | null>(null);
  const effectiveLoopId = loopId ?? createdLoopId;
  const loop = useLoop(effectiveLoopId);
  const revisions = useLoopRevisions(effectiveLoopId);
  const createLoop = useCreateLoop(companyId);
  const saveRevision = useSaveLoopRevision(companyId);
  const selectRevision = useSelectLoopRevision(companyId);
  const updateDraftSummary = useUpdateLoopDraftSummary(companyId);

  // ── Editor model (drives the pure state machine) ──
  const [prompt, setPrompt] = useState('');
  const [compiled, setCompiled] = useState<CompiledRevisionView | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [errored, setErrored] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileSuccessKey, setCompileSuccessKey] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const hydratedFor = useRef<string | null>(null);
  const newDraftHydrated = useRef(false);
  const draftStorageKey = `offisim.loop-authoring-draft:${companyId ?? 'none'}`;

  useEffect(() => {
    if (effectiveLoopId || newDraftHydrated.current) return;
    newDraftHydrated.current = true;
    setPrompt(sessionStorage.getItem(draftStorageKey) ?? '');
  }, [draftStorageKey, effectiveLoopId]);

  // Hydrate the prompt + compiled view from the loop's current revision once.
  useEffect(() => {
    if (!effectiveLoopId || hydratedFor.current === effectiveLoopId) return;
    const current = loop.data?.currentRevisionId;
    if (!loop.data) return;
    if (!current) {
      hydratedFor.current = effectiveLoopId;
      setPrompt(loop.data.summary);
      return;
    }
    const rev = revisions.data?.find((r) => r.revisionId === current);
    if (!rev) return; // wait for revisions to load
    hydratedFor.current = effectiveLoopId;
    setPrompt(rev.sourcePrompt);
    setCompiled({
      status: rev.compileStatus,
      compiledIrJson: rev.compiledIrJson,
      questions: safeParse(rev.questionsJson, [] as CompiledRevisionView['questions']),
      findings: safeParse(rev.validationJson, { findings: [] }).findings ?? [],
      ...(rev.enhancedPrompt ? { enhancedPrompt: rev.enhancedPrompt } : {}),
      sourcePrompt: rev.sourcePrompt,
      savedRevisionId: rev.revisionId,
      savedRevisionNumber: rev.revisionNumber,
    });
  }, [effectiveLoopId, loop.data, revisions.data]);

  const model: LoopAuthoringModel = {
    ...EMPTY_AUTHORING_MODEL,
    prompt,
    enhancing: false,
    compiling,
    saving: saveRevision.isPending,
    errored,
    compiled,
    justSaved,
  };
  const state = deriveAuthoringState(model);
  const dirty = isDirty(model);

  const ir = useMemo(() => (compiled ? parseLoopIr(compiled.compiledIrJson) : null), [compiled]);
  const graphState = graphStateFor(state, compiled);
  const findings: LoopValidationFinding[] = compiled?.findings ?? [];

  // Synchronous in-flight guard. `compiling` (React state) lags a tick behind a
  // click, so the answer path could otherwise launch a SECOND concurrent compile
  // and race the setCompiled writes. This ref blocks re-entry immediately.
  const compilingRef = useRef(false);
  const ensureLoopPromiseRef = useRef<Promise<{ loopId: string; profileId: string }> | null>(null);

  const ensureLoop = useCallback(async () => {
    if (effectiveLoopId) {
      return {
        loopId: effectiveLoopId,
        profileId: loop.data?.profileId ?? DEFAULT_COMPILER_PROFILE_ID,
      };
    }
    if (ensureLoopPromiseRef.current) return ensureLoopPromiseRef.current;
    const createPromise = (async () => {
      const summary = prompt.trim();
      if (!summary) throw new Error('Describe the recurring work first.');
      const created = await createLoop.mutateAsync({
        title: deriveLoopTitle(summary),
        summary,
        profileId: DEFAULT_COMPILER_PROFILE_ID,
      });
      setCreatedLoopId(created.loopId);
      sessionStorage.removeItem(draftStorageKey);
      onCreated(created.loopId);
      return { loopId: created.loopId, profileId: created.profileId };
    })();
    ensureLoopPromiseRef.current = createPromise;
    try {
      return await createPromise;
    } finally {
      if (ensureLoopPromiseRef.current === createPromise) ensureLoopPromiseRef.current = null;
    }
  }, [createLoop, draftStorageKey, effectiveLoopId, loop.data?.profileId, onCreated, prompt]);

  // ── Compile (PREVIEW only — runs the real model, persists NOTHING) ──
  const handleCompile = useCallback(
    async (answers?: Record<string, string>) => {
      // An in-flight compile ALWAYS blocks a second one — even on the "Apply
      // answers" path (answers truthy). `answers` only lets the question path skip
      // the empty-prompt requirement, never the in-flight / busy guard.
      if (compilingRef.current) return;
      if (!answers && !canCompile(model)) return;
      if (answers && saveRevision.isPending) return;
      if (!companyId) {
        toast.error('Select a company first.');
        return;
      }
      compilingRef.current = true;
      setErrored(false);
      setCompileError(null);
      setJustSaved(false);
      setCompiling(true);
      try {
        const persistedLoop = await ensureLoop();
        const result = await compileLoopPreview({
          profileId: persistedLoop.profileId,
          threadId: undefined,
          compileInput: {
            sourcePrompt: prompt,
            ...(compiled?.enhancedPrompt ? { enhancedPrompt: compiled.enhancedPrompt } : {}),
            context: { companyId, ...(projectId ? { projectId } : {}) },
            ...(answers ? { answers } : {}),
          },
        });
        setCompiled({
          status: result.status,
          compiledIrJson: result.ir ? JSON.stringify(result.ir) : '{}',
          questions: result.questions,
          findings: result.validation.findings,
          ...(result.enhancedPrompt ? { enhancedPrompt: result.enhancedPrompt } : {}),
          sourcePrompt: prompt,
          // NOT saved yet — savedRevisionId stays undefined until Save persists it,
          // so Use-in-Office is blocked until the preview is committed.
        });
        if (result.status === 'ready') {
          setCompileSuccessKey((key) => key + 1);
          const semanticTitle = deriveLoopTitle(prompt);
          try {
            await updateDraftSummary.mutateAsync({
              loopId: persistedLoop.loopId,
              summary: prompt.trim(),
              ...(isUntitledLoop(loop.data?.title ?? '') ? { title: semanticTitle } : {}),
            });
          } catch (error) {
            toast.error('Plan generated, but the latest description was not saved.', {
              description: error instanceof Error ? error.message : undefined,
            });
          }
          toast.success('Plan generated — review it, then save');
        } else if (result.status === 'needs_input')
          toast.message('A few questions to finish this Loop');
        else toast.error('The Loop has issues to resolve');
      } catch (err) {
        const message = friendlyLoopError(
          err,
          'The plan could not be generated. Your description is safe.',
        );
        setErrored(true);
        setCompileError(message);
        toast.error(message);
      } finally {
        compilingRef.current = false;
        setCompiling(false);
      }
    },
    [
      // biome-ignore lint/correctness/useExhaustiveDependencies: model is a per-render derived object (not memoized); intentionally tracked so the compile callback stays current.
      model,
      companyId,
      projectId,
      prompt,
      compiled,
      saveRevision.isPending,
      loop.data,
      ensureLoop,
      updateDraftSummary,
    ],
  );

  // ── Save (persist the previewed compile as a NEW immutable revision) ──
  const handleSave = useCallback(async () => {
    if (!canSave(model) || !companyId || !compiled) return;
    try {
      const persistedLoop = await ensureLoop();
      const compiledResult: LoopCompileResult = {
        status: compiled.status,
        ...(ir ? { ir } : {}),
        questions: compiled.questions,
        validation: {
          ok: compiled.status === 'ready' && !compiled.findings.some((f) => f.severity === 'error'),
          findings: compiled.findings,
        },
        ...(compiled.enhancedPrompt ? { enhancedPrompt: compiled.enhancedPrompt } : {}),
      };
      const result = await saveRevision.mutateAsync({
        loopId: persistedLoop.loopId,
        sourcePrompt: prompt,
        ...(compiled?.enhancedPrompt ? { enhancedPrompt: compiled.enhancedPrompt } : {}),
        selectIfReady: true,
        compiled: compiledResult,
      });
      setCompiled({
        status: result.status,
        compiledIrJson: result.revision.compiledIrJson,
        questions: result.questions,
        findings: result.validation.findings,
        ...(result.revision.enhancedPrompt
          ? { enhancedPrompt: result.revision.enhancedPrompt }
          : {}),
        sourcePrompt: prompt,
        savedRevisionId: result.revision.revisionId,
        savedRevisionNumber: result.revision.revisionNumber,
      });
      setJustSaved(true);
      hydratedFor.current = persistedLoop.loopId; // keep our state authoritative over a refetch
      toast.success(`Plan saved — v${result.revision.revisionNumber}`);
    } catch (err) {
      setErrored(true);
      toast.error(friendlyLoopError(err, 'The plan could not be saved. Your description is safe.'));
    }
  }, [
    // biome-ignore lint/correctness/useExhaustiveDependencies: model is a per-render derived object (not memoized); intentionally tracked so the save callback stays current.
    model,
    companyId,
    ensureLoop,
    prompt,
    compiled,
    ir,
    saveRevision,
  ]);

  async function handleStartRun() {
    if (!canUseInOffice(model) || !compiled?.savedRevisionId) {
      toast.message(useBlockedReason(model) ?? 'Generate and save the plan first.');
      return;
    }
    if (!companyId || !projectId || !effectiveLoopId) {
      toast.message('Select a project before starting this loop.');
      return;
    }
    setStartingRun(true);
    try {
      await startLoopAsParallelProjectRun({
        loopId: effectiveLoopId,
        revisionId: compiled.savedRevisionId,
        title: loop.data?.title ?? deriveLoopTitle(prompt),
        companyId,
        projectId,
      });
      toast.success('Loop started');
    } catch (error) {
      toast.error(friendlyLoopError(error, 'The loop could not start.'));
    } finally {
      setStartingRun(false);
    }
  }

  // ── Version actions ──
  function handleSetCurrent(revisionId: string) {
    if (!effectiveLoopId) return;
    selectRevision.mutate(
      { loopId: effectiveLoopId, revisionId },
      {
        onSuccess: () => {
          toast.success('Set as current revision');
          hydratedFor.current = null; // re-hydrate from the new current
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not switch revision'),
      },
    );
  }

  const blockedReason = useBlockedReason(model);

  const handleBack = useCallback(async () => {
    const draftSummary = prompt.trim();
    if (!effectiveLoopId) {
      if (!draftSummary) {
        sessionStorage.removeItem(draftStorageKey);
        onBack();
        return;
      }
      try {
        await ensureLoop();
        onBack();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the Loop draft.');
      }
      return;
    }
    const existingSummary = loop.data?.summary.trim() ?? '';
    const shouldPersistDraft = loop.data != null && draftSummary !== existingSummary;

    if (shouldPersistDraft) {
      try {
        await updateDraftSummary.mutateAsync({
          loopId: effectiveLoopId,
          summary: draftSummary,
          ...(isUntitledLoop(loop.data?.title ?? '')
            ? { title: deriveLoopTitle(draftSummary) }
            : {}),
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the Loop draft.');
        return;
      }
    }

    onBack();
  }, [draftStorageKey, effectiveLoopId, ensureLoop, loop.data, onBack, prompt, updateDraftSummary]);

  if (effectiveLoopId && (loop.isLoading || revisions.isLoading)) {
    return (
      <div className="off-loop-editor off-loop-editor-loading">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (effectiveLoopId && (loop.isError || revisions.isError)) {
    const error = loop.error ?? revisions.error;
    return (
      <div className="off-loop-editor off-loop-editor-error">
        <ErrorState
          title="Couldn't open this loop"
          detail={errorDetail(error, 'The saved plan could not be loaded.')}
          onRetry={() => {
            void loop.refetch();
            void revisions.refetch();
          }}
        />
      </div>
    );
  }
  if (effectiveLoopId && !loop.data) {
    return (
      <div className="off-loop-editor off-loop-editor-error">
        <ErrorState
          title="Loop not found"
          detail="This loop may have been removed. Return to the library and choose another one."
          onRetry={onBack}
        />
      </div>
    );
  }

  return (
    <div className="off-loop-editor">
      <header className="off-loop-editor-head">
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => void handleBack()}
          disabled={updateDraftSummary.isPending || createLoop.isPending || compiling}
          aria-label="Back to library"
        >
          <Icon icon={ArrowLeft} size="sm" />
        </Button>
        <div className="off-loop-editor-titles">
          <span className="off-loop-editor-name">{loop.data?.title ?? 'New loop'}</span>
          <span className="off-loop-editor-state" data-state={state}>
            {STATE_LABEL[state]}
          </span>
        </div>
        <div className="off-loop-editor-head-actions">
          <Button
            variant={detailsOpen ? 'subtle' : 'ghost'}
            size="sm"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <Icon icon={Eye} size="sm" />
            Advanced
          </Button>
          <DropdownMenu open={versionsOpen} onOpenChange={setVersionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="sm" disabled={!effectiveLoopId}>
                <Icon icon={History} size="sm" />
                {compiled?.savedRevisionNumber ? `v${compiled.savedRevisionNumber}` : 'Versions'}
                <Icon icon={ChevronDown} size="sm" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="off-loop-version-menu">
              <DropdownMenuLabel>Revisions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <LoopVersionPanel
                revisions={revisions.data ?? []}
                currentRevisionId={loop.data?.currentRevisionId ?? null}
                onSetCurrent={(id) => {
                  setVersionsOpen(false);
                  handleSetCurrent(id);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div
        className={detailsOpen ? 'off-loop-editor-body is-details-open' : 'off-loop-editor-body'}
      >
        <div className="off-loop-editor-main">
          {dirty ? (
            // biome-ignore lint/a11y/useSemanticElements: intentional ARIA live region (role=status)
            <div className="off-loop-stale" role="status">
              <Icon icon={TriangleAlert} size="sm" />
              Description changed — generate an updated plan before saving or running.
            </div>
          ) : null}

          {state === 'empty' || state === 'draft' ? (
            <LoopStartGuide
              onExampleSelect={(example) => {
                setPrompt(example);
                if (!effectiveLoopId) sessionStorage.setItem(draftStorageKey, example);
                setJustSaved(false);
              }}
            />
          ) : state === 'needs_input' && compiled ? (
            <LoopQuestionCards
              // Key on the question-id set so a SECOND needs_input compile with a
              // DIFFERENT question set remounts the card with fresh defaults — the
              // local answer state never carries a prior question's value under a
              // new question's id.
              key={compiled.questions.map((q) => q.id).join(',')}
              questions={compiled.questions}
              busy={compiling}
              onAccept={(answers) => void handleCompile(answers)}
            />
          ) : (
            <LoopGraphPanel
              ir={ir}
              selectedNodeId={selectedNodeId}
              onSelectedNodeChange={setSelectedNodeId}
              state={graphState}
              findings={findings}
              errorMessage={compileError}
              focusRequestKey={compileSuccessKey}
            />
          )}
        </div>

        {detailsOpen ? (
          <aside className="off-loop-editor-drawer">
            <LoopAdvancedDrawer
              ir={ir}
              status={compiled?.status ?? null}
              findings={findings}
              profileId={loop.data?.profileId ?? DEFAULT_COMPILER_PROFILE_ID}
              revisionNumber={compiled?.savedRevisionNumber ?? null}
              busy={compiling}
              errorMessage={compileError}
              expandKey={compileSuccessKey}
            />
          </aside>
        ) : null}
      </div>

      {/* Bottom-fixed natural-language composer (chat-product feel). */}
      <div className="off-loop-composer">
        <textarea
          className="off-input off-loop-composer-input"
          placeholder="Describe the goal, what repeats, and when this loop should stop…"
          value={prompt}
          onChange={(e) => {
            const nextPrompt = e.target.value;
            setPrompt(nextPrompt);
            if (!effectiveLoopId) sessionStorage.setItem(draftStorageKey, nextPrompt);
            setJustSaved(false);
          }}
          rows={3}
          aria-label="Loop description"
        />
        <div className="off-loop-composer-bar">
          {blockedReason && state !== 'empty' && state !== 'draft' ? (
            <span className="off-loop-composer-hint">{blockedReason}</span>
          ) : (
            <span className="off-loop-composer-hint">
              Describe it naturally. The graph is for review, not configuration.
            </span>
          )}
          <div className="off-loop-composer-actions">
            <Button
              size="sm"
              onClick={() => void handleCompile()}
              disabled={!canCompile(model)}
              aria-busy={compiling}
              className="off-loop-compile-action"
            >
              <Icon
                icon={compiling ? Loader2 : Sparkles}
                size="sm"
                className={compiling ? 'off-spin' : undefined}
              />
              {compiling ? 'Generating…' : dirty || compiled ? 'Update plan' : 'Generate plan'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSave()}
              disabled={
                !canSave(model) || (compiled?.savedRevisionId !== undefined && !dirty && justSaved)
              }
              title={
                compiled ? 'Save exactly the plan shown above' : 'Generate a plan before saving'
              }
            >
              <Icon
                icon={saveRevision.isPending ? Loader2 : Save}
                size="sm"
                className={saveRevision.isPending ? 'off-spin' : undefined}
              />
              Save plan
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleStartRun()}
              disabled={!canUseInOffice(model) || !projectId || startingRun}
              title={!projectId ? 'Select a project first' : (blockedReason ?? 'Start this loop')}
            >
              <Icon
                icon={startingRun ? Loader2 : SquarePlay}
                size="sm"
                className={startingRun ? 'off-spin' : undefined}
              />
              Run
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LoopStartGuideProps {
  onExampleSelect: (example: string) => void;
}

function LoopStartGuide({ onExampleSelect }: LoopStartGuideProps) {
  return (
    <div className="off-loop-start" aria-label="Describe a loop">
      <div className="off-loop-start-intro">
        <span className="off-loop-start-kicker">Natural-language loops</span>
        <h2>What should happen repeatedly?</h2>
        <p>Include the goal, what repeats, when to stop, and when you want help.</p>
      </div>

      <div className="off-loop-start-examples">
        <span>Start with an example</span>
        <div className="off-loop-start-chips">
          {EXAMPLE_PROMPTS.map((example, index) => (
            <button
              key={example}
              type="button"
              className="off-loop-start-chip off-focusable"
              onClick={() => onExampleSelect(example)}
            >
              <span>{['Ship a feature', 'Triage bug reports', 'Keep docs in sync'][index]}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<ReturnType<typeof deriveAuthoringState>, string> = {
  empty: 'New',
  draft: 'Draft',
  enhancing: 'Generating',
  compiling: 'Generating',
  needs_input: 'Needs input',
  ready: 'Ready',
  dirty: 'Stale',
  invalid: 'Has issues',
  error: 'Error',
  saving: 'Saving',
  saved: 'Saved',
};

function isUntitledLoop(title: string): boolean {
  return /^Untitled loop(?: \d+)?$/i.test(title.trim());
}

function deriveLoopTitle(description: string): string {
  const first = description
    .trim()
    .split(/[\n.;]/)[0]
    ?.replace(/^(?:every|each|on|when|whenever)\b[^,]*,\s*/i, '')
    .trim();
  if (!first) return 'New loop';
  const title = `${first[0]?.toUpperCase()}${first.slice(1)}`;
  return title.length > 56 ? `${title.slice(0, 53)}…` : title;
}

function friendlyLoopError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/model|compiler|ir|oracle|evaluator|profile|node|edge/i.test(message)) return fallback;
  return message.trim() || fallback;
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
