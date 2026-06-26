import { openLoopInOffice } from '@/assistant/composer/open-loop-in-office.js';
import { PromptEnhanceReview } from '@/assistant/enhance/PromptEnhanceReview.js';
import { createTauriEnhanceTransport } from '@/assistant/enhance/tauri-enhance-transport.js';
import { buildEnhanceRequest } from '@/assistant/enhance/service.js';
import { useEnhance } from '@/assistant/enhance/useEnhance.js';
import { useUiState } from '@/app/ui-state.js';
import {
  compileLoopPreview,
  useLoop,
  useLoopRevisions,
  useSaveLoopRevision,
  useSelectLoopRevision,
} from '@/data/loops.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { LoopGraphPanel } from '@/surfaces/mission/loops/graph/index.js';
import type { LoopValidationFinding } from '@offisim/shared-types';
import {
  ArrowLeft,
  ChevronDown,
  Hammer,
  History,
  Loader2,
  Save,
  Send,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type CompiledRevisionView,
  type LoopAuthoringModel,
  EMPTY_AUTHORING_MODEL,
  canCompile,
  canSave,
  canUseInOffice,
  deriveAuthoringState,
  graphStateFor,
  isDirty,
  useBlockedReason,
} from './loop-authoring-machine.js';
import { LoopAdvancedDrawer } from './LoopAdvancedDrawer.js';
import { LoopQuestionCards } from './LoopQuestionCards.js';
import { LoopVersionPanel } from './LoopVersionPanel.js';
import { parseLoopIr } from './loop-generated-details.js';

/**
 * The prompt-first Loop EDITOR (PR-08). Layout per spec:
 *   - TOP / main area  → the `LoopGraphPanel` for the current compiled revision.
 *   - BOTTOM (fixed)   → ONE natural-language composer (the only required input).
 *   - RIGHT drawer     → selected-node inspector / findings / version + generated
 *                        details (read-only, light).
 *
 * It drives the deterministic authoring state machine and wires the REAL
 * loop_design enhance + the PR-07 compile/save service. It never shows raw
 * evaluator JSON / criteria forms — details are generated read-only summaries.
 */

const EXAMPLE_PROMPTS = [
  'Ship a small feature end to end: implement it, write tests, and keep the build green. Pause for me before pushing.',
  'Triage incoming bug reports each morning: reproduce, label by severity, and draft a fix plan for the top three.',
  'Keep our docs in sync with the code: when an API changes, update the reference and flag breaking changes for review.',
];

interface LoopEditorProps {
  loopId: string;
  onBack: () => void;
}

export function LoopEditor({ loopId, onBack }: LoopEditorProps) {
  const companyId = useUiState((s) => s.companyId) || null;
  const projectId = useUiState((s) => s.projectId) || null;
  const loop = useLoop(loopId);
  const revisions = useLoopRevisions(loopId);
  const saveRevision = useSaveLoopRevision(companyId);
  const selectRevision = useSelectLoopRevision(companyId);

  // ── Editor model (drives the pure state machine) ──
  const [prompt, setPrompt] = useState('');
  const [compiled, setCompiled] = useState<CompiledRevisionView | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [errored, setErrored] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const hydratedFor = useRef<string | null>(null);

  // Enhance lifecycle (shared PR-06 flow) over a Tauri transport.
  const enhanceTransport = useMemo(() => createTauriEnhanceTransport(), []);
  const enhance = useEnhance(enhanceTransport);

  // Hydrate the prompt + compiled view from the loop's current revision once.
  useEffect(() => {
    if (hydratedFor.current === loopId) return;
    const current = loop.data?.currentRevisionId;
    if (!loop.data) return;
    if (!current) {
      hydratedFor.current = loopId;
      return;
    }
    const rev = revisions.data?.find((r) => r.revisionId === current);
    if (!rev) return; // wait for revisions to load
    hydratedFor.current = loopId;
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
  }, [loopId, loop.data, revisions.data]);

  const model: LoopAuthoringModel = {
    ...EMPTY_AUTHORING_MODEL,
    prompt,
    enhancing: enhanceOpen && (enhance.state.phase === 'loading' || enhance.state.phase === 'ready'),
    compiling,
    saving: saveRevision.isPending,
    errored,
    compiled,
    justSaved,
  };
  const state = deriveAuthoringState(model);
  const dirty = isDirty(model);

  const ir = useMemo(
    () => (compiled ? parseLoopIr(compiled.compiledIrJson) : null),
    [compiled],
  );
  const graphState = graphStateFor(state, compiled);
  const findings: LoopValidationFinding[] = compiled?.findings ?? [];

  // The latest source prompt this compiled view reflects + the answers it used, so
  // Save persists exactly what the user just previewed.
  const lastAnswersRef = useRef<Record<string, string> | undefined>(undefined);
  // Synchronous in-flight guard. `compiling` (React state) lags a tick behind a
  // click, so the answer path could otherwise launch a SECOND concurrent compile
  // and race the setCompiled writes. This ref blocks re-entry immediately.
  const compilingRef = useRef(false);

  // ── Compile (PREVIEW only — runs the real model, persists NOTHING) ──
  const handleCompile = useCallback(
    async (answers?: Record<string, string>) => {
      // An in-flight compile ALWAYS blocks a second one — even on the "Apply
      // answers" path (answers truthy). `answers` only lets the question path skip
      // the empty-prompt requirement, never the in-flight / busy guard.
      if (compilingRef.current) return;
      if (!answers && !canCompile(model)) return;
      if (answers && (saveRevision.isPending || enhanceOpen)) return;
      if (!companyId) {
        toast.error('Select a company first.');
        return;
      }
      compilingRef.current = true;
      setErrored(false);
      setJustSaved(false);
      setCompiling(true);
      lastAnswersRef.current = answers;
      try {
        const result = await compileLoopPreview({
          profileId: loop.data?.profileId ?? '',
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
        if (result.status === 'ready') toast.success('Compiled — review the graph, then Save');
        else if (result.status === 'needs_input') toast.message('A few questions to finish this Loop');
        else toast.error('The Loop has issues to resolve');
      } catch (err) {
        setErrored(true);
        toast.error(err instanceof Error ? err.message : 'Compile failed. Your prompt is kept.');
      } finally {
        compilingRef.current = false;
        setCompiling(false);
      }
    },
    [model, companyId, projectId, loop.data?.profileId, prompt, compiled, saveRevision.isPending, enhanceOpen],
  );

  // ── Save (persist the previewed compile as a NEW immutable revision) ──
  const handleSave = useCallback(async () => {
    if (!canSave(model) || !companyId) return;
    try {
      const result = await saveRevision.mutateAsync({
        loopId,
        sourcePrompt: prompt,
        ...(compiled?.enhancedPrompt ? { enhancedPrompt: compiled.enhancedPrompt } : {}),
        context: { companyId, ...(projectId ? { projectId } : {}) },
        ...(lastAnswersRef.current ? { answers: lastAnswersRef.current } : {}),
        selectIfReady: true,
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
      hydratedFor.current = loopId; // keep our state authoritative over a refetch
      toast.success(`Saved — revision v${result.revision.revisionNumber}`);
    } catch (err) {
      setErrored(true);
      toast.error(err instanceof Error ? err.message : 'Save failed. Your prompt is kept.');
    }
  }, [model, companyId, projectId, loopId, prompt, compiled, saveRevision]);

  // ── Enhance (apply → still needs a Compile) ──
  function openEnhance() {
    if (!prompt.trim()) {
      toast.message('Write a description first.');
      return;
    }
    setEnhanceOpen(true);
    enhance.start(
      buildEnhanceRequest({
        profile: 'loop_design',
        text: prompt,
        protectedSpans: [],
        context: companyId ? { companyId } : {},
      }),
    );
  }
  function applyEnhance() {
    const enhanced = enhance.state.result?.enhanced;
    if (enhanced) {
      setPrompt(enhanced);
      setJustSaved(false);
    }
    setEnhanceOpen(false);
    enhance.reset();
  }

  // ── Use in Office (saved ready revision only) ──
  async function handleUse() {
    if (!canUseInOffice(model) || !compiled?.savedRevisionId) {
      toast.message(useBlockedReason(model) ?? 'Compile + save first.');
      return;
    }
    const result = await openLoopInOffice(loopId, compiled.savedRevisionId);
    if (result.ok) toast.success('Loop added to Office draft');
  }

  // ── Version actions ──
  function handleSetCurrent(revisionId: string) {
    selectRevision.mutate(
      { loopId, revisionId },
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

  return (
    <div className="off-loop-editor">
      <header className="off-loop-editor-head">
        <Button variant="ghost" size="iconSm" onClick={onBack} aria-label="Back to library">
          <Icon icon={ArrowLeft} size="sm" />
        </Button>
        <div className="off-loop-editor-titles">
          <span className="off-loop-editor-name">{loop.data?.title ?? 'Loop'}</span>
          <span className="off-loop-editor-state" data-state={state}>
            {STATE_LABEL[state]}
          </span>
        </div>
        <div className="off-loop-editor-head-actions">
          <DropdownMenu open={versionsOpen} onOpenChange={setVersionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="sm">
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

      <div className="off-loop-editor-body">
        <div className="off-loop-editor-main">
          {dirty ? (
            <div className="off-loop-stale" role="status">
              <Icon icon={TriangleAlert} size="sm" />
              Prompt changed — this graph is stale. Compile to update it.
            </div>
          ) : null}

          {state === 'needs_input' && compiled ? (
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
            />
          )}

          {state === 'empty' ? (
            <div className="off-loop-examples">
              <span className="off-loop-examples-label">Try describing a loop</span>
              <ul className="off-loop-examples-list">
                {EXAMPLE_PROMPTS.map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      className="off-loop-example off-focusable"
                      onClick={() => setPrompt(ex)}
                    >
                      {ex}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="off-loop-editor-drawer">
          <LoopAdvancedDrawer
            ir={ir}
            status={compiled?.status ?? null}
            findings={findings}
            profileId={loop.data?.profileId ?? null}
            revisionNumber={compiled?.savedRevisionNumber ?? null}
          />
        </aside>
      </div>

      {/* Bottom-fixed natural-language composer (chat-product feel). */}
      <div className="off-loop-composer">
        <textarea
          className="off-input off-loop-composer-input"
          placeholder="Describe what this loop should do, in your own words…"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
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
              Natural language is the only required input.
            </span>
          )}
          <div className="off-loop-composer-actions">
            <Button variant="ghost" size="sm" onClick={openEnhance} disabled={!prompt.trim()}>
              <Icon icon={Sparkles} size="sm" />
              Enhance
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCompile()}
              disabled={!canCompile(model)}
            >
              <Icon icon={compiling ? Loader2 : Hammer} size="sm" className={compiling ? 'off-spin' : undefined} />
              {dirty ? 'Update graph' : compiled ? 'Recompile' : 'Compile'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!canSave(model) || (compiled?.savedRevisionId !== undefined && !dirty && justSaved)}
              title={
                compiled
                  ? 'Save this compile as a new immutable revision'
                  : 'Compile before saving'
              }
            >
              <Icon
                icon={saveRevision.isPending ? Loader2 : Save}
                size="sm"
                className={saveRevision.isPending ? 'off-spin' : undefined}
              />
              Save
            </Button>
            <Button
              size="sm"
              onClick={handleUse}
              disabled={!canUseInOffice(model)}
              title={blockedReason ?? 'Add this Loop to an Office draft'}
            >
              <Icon icon={Send} size="sm" />
              Use in Office
            </Button>
          </div>
        </div>
      </div>

      <PromptEnhanceReview
        open={enhanceOpen}
        state={enhance.state}
        onApply={applyEnhance}
        onKeepOriginal={() => {
          setEnhanceOpen(false);
          enhance.reset();
        }}
        onRegenerate={() => enhance.regenerate()}
        onCancel={enhance.cancel}
        onClose={() => {
          setEnhanceOpen(false);
          enhance.reset();
        }}
      />
    </div>
  );
}

const STATE_LABEL: Record<ReturnType<typeof deriveAuthoringState>, string> = {
  empty: 'New',
  draft: 'Draft',
  enhancing: 'Enhancing',
  compiling: 'Compiling',
  needs_input: 'Needs input',
  ready: 'Ready',
  dirty: 'Stale',
  invalid: 'Has issues',
  error: 'Error',
  saving: 'Saving',
  saved: 'Saved',
};

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
