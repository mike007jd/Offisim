import { useUiState } from '@/app/ui-state.js';
import { useAgentRuntimeModels } from '@/assistant/composer/usePiAgentModels.js';
import { reposOrNull } from '@/data/adapters.js';
import {
  useCompanies,
  useDeliverables,
  useEmployees,
  useMessages,
  useProjects,
  useThreads,
} from '@/data/queries.js';
import { queryKeys } from '@/data/query-keys.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  Circle,
  Cpu,
  FileCheck2,
  SendHorizontal,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { resolveFirstRunProgress } from './first-run-progress.js';
import { FIRST_RUN_EXAMPLE_PROMPT, useFirstRunState } from './first-run-state.js';

const STEPS = [
  { label: 'Company', icon: Building2 },
  { label: 'Employee', icon: UserPlus },
  { label: 'Engine', icon: Cpu },
  { label: 'Request', icon: SendHorizontal },
  { label: 'Live', icon: Sparkles },
  { label: 'Output', icon: FileCheck2 },
] as const;

interface GuideCopy {
  title: string;
  why: string;
}

const COPY: readonly GuideCopy[] = [
  {
    title: 'Open the doors',
    why: 'A company gives your people, projects, and work one shared home.',
  },
  {
    title: 'Hire your first employee',
    why: 'Every new company needs one dependable person to take the first order.',
  },
  {
    title: 'Give them an engine',
    why: 'The engine is how your employee thinks and gets the work done.',
  },
  {
    title: 'Place the first order',
    why: 'A small, clear request lets you see the whole company come alive quickly.',
  },
  {
    title: 'Watch the work happen',
    why: 'The stage shows who is working; the timeline explains each move as it happens.',
  },
  {
    title: 'Collect the first delivery',
    why: 'The finished reply and file are your proof that the company can ship real work.',
  },
];

export function FirstRunGuide() {
  const status = useFirstRunState((state) => state.status);
  const initialize = useFirstRunState((state) => state.initialize);
  const skip = useFirstRunState((state) => state.skip);
  const complete = useFirstRunState((state) => state.complete);
  const stagePrompt = useFirstRunState((state) => state.stagePrompt);
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const selectedThreadId = useUiState((state) => state.selectedThreadId);
  const stagePrimaryTab = useUiState((state) => state.stagePrimaryTab);
  const boardLens = useUiState((state) => state.boardLens);
  const companies = useCompanies();
  const projects = useProjects(companyId || null);
  const employees = useEmployees();
  const models = useAgentRuntimeModels();
  const threads = useThreads(projectId || null);
  const messages = useMessages(selectedThreadId);
  const deliverables = useDeliverables(selectedThreadId);
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);
  const [liveObserved, setLiveObserved] = useState(false);
  const previousStep = useRef<number | null>(null);

  useEffect(() => {
    if (!companies.isSuccess) return;
    void initialize(companies.data.length).catch(() => undefined);
  }, [companies.data, companies.isSuccess, initialize]);

  const employee = employees.data?.[0] ?? null;
  const preferredModel = useMemo(
    () =>
      models.data?.find(
        (option) => option.selectionKind === 'orchestration-engine' && option.engineId === 'codex',
      ) ??
      models.data?.find((option) => option.selectionKind === 'api-model') ??
      null,
    [models.data],
  );
  const companyReady = Boolean(
    companyId && companies.data?.some((company) => company.id === companyId),
  );
  const projectReady = Boolean(
    projectId && projects.data?.some((project) => project.id === projectId),
  );
  const employeeReady = Boolean(employee);
  const boundModel = employee?.model
    ? models.data?.find((option) => option.value === employee.model)
    : null;
  const engineReady = Boolean(
    boundModel && (boundModel.selectionKind === 'api-model' || boundModel.engineId === 'codex'),
  );
  const requestReady = Boolean(
    selectedThreadId &&
      ((threads.data?.some((thread) => thread.id === selectedThreadId) ?? false) ||
        messages.data?.some((message) => message.author === 'boss')),
  );
  const liveReady = requestReady && liveObserved;
  const outputReady = Boolean(
    deliverables.data?.length ||
      messages.data?.some(
        (message) =>
          message.author === 'employee' && message.status === 'complete' && message.body.trim(),
      ),
  );
  const activeStep = resolveFirstRunProgress({
    company: companyReady,
    employee: employeeReady,
    engine: engineReady,
    request: requestReady,
    live: liveReady,
    output: outputReady,
  }).completedCount;

  useEffect(() => {
    if (status !== 'active') return;
    if (previousStep.current !== null && activeStep > previousStep.current) {
      const finished = STEPS[Math.min(activeStep - 1, STEPS.length - 1)];
      if (finished) toast.success(`${finished.label} ready`);
    }
    previousStep.current = activeStep;
  }, [activeStep, status]);

  useEffect(() => {
    if (requestReady && stagePrimaryTab === 'board' && boardLens === 'timeline') {
      setLiveObserved(true);
    }
  }, [boardLens, requestReady, stagePrimaryTab]);

  if (status !== 'active') return null;

  const bindEngine = async () => {
    if (!employee || !preferredModel) return;
    setWorking(true);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Engine setup requires the desktop app.');
      await repos.employees.update(employee.id, { model: preferredModel.value });
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees(companyId) });
      toast.success(`${preferredModel.name} is ready for ${employee.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Engine setup failed');
    } finally {
      setWorking(false);
    }
  };

  const startRequest = () => {
    if (!projectReady || !employee) return;
    useUiState.getState().setSurface('office');
    const threadId = useUiState.getState().openDraftThread(employee.id);
    stagePrompt(threadId, FIRST_RUN_EXAMPLE_PROMPT);
  };

  const copy = activeStep < COPY.length ? COPY[activeStep] : null;
  const primary = (() => {
    if (activeStep === 0) return null;
    if (activeStep === 1) {
      return { label: 'Hire first employee', onClick: () => useUiState.getState().requestHire() };
    }
    if (activeStep === 2 && preferredModel) {
      return {
        label: `Use ${preferredModel.name}`,
        onClick: () => void bindEngine(),
        disabled: working,
      };
    }
    if (activeStep === 2) {
      return {
        label: 'Open AI Accounts',
        onClick: () => useUiState.getState().openSettings('providers'),
      };
    }
    if (activeStep === 3 && !projectReady) {
      return { label: 'Open Projects', onClick: () => useUiState.getState().setSurface('office') };
    }
    if (activeStep === 3) return { label: 'Use example request', onClick: startRequest };
    if (activeStep === 4) {
      return {
        label: 'Watch the timeline',
        onClick: () => {
          setLiveObserved(true);
          useUiState.getState().openBoard('timeline');
        },
      };
    }
    if (activeStep === 5) return null;
    return {
      label: 'Explore the board',
      onClick: () => {
        void complete();
        useUiState.getState().openBoard('board');
      },
    };
  })();

  const noEngineDetail =
    activeStep === 2 && !models.isLoading && !preferredModel
      ? 'No engine is ready yet. Sign in with `codex login`, then Refresh AI Accounts — or add a Pi API provider and exact model there.'
      : activeStep === 3 && !projectReady
        ? 'This order needs a Project folder. Create a Project and choose your folder, then resume here.'
        : null;

  return (
    <section className="off-first-run" aria-label="First-run guide">
      <div
        className="off-first-run-progress"
        aria-label={`${activeStep} of ${STEPS.length} steps complete`}
      >
        {STEPS.map((item, index) => (
          <span
            key={item.label}
            className={`off-first-run-step${index < activeStep ? ' is-done' : ''}${index === activeStep ? ' is-current' : ''}`}
          >
            <Icon
              icon={index < activeStep ? Check : index === activeStep ? item.icon : Circle}
              size="sm"
            />
            <span>{item.label}</span>
          </span>
        ))}
      </div>
      <div className="off-first-run-copy">
        <strong>{copy?.title ?? 'First order delivered'}</strong>
        <span>
          {copy?.why ?? 'Your company is open, staffed, connected, and ready for the next card.'}
        </span>
        {noEngineDetail ? <small>{noEngineDetail}</small> : null}
      </div>
      <div className="off-first-run-actions">
        {primary ? (
          <Button size="sm" onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void (activeStep === STEPS.length ? complete() : skip())}
        >
          {activeStep === STEPS.length ? 'Finish' : 'Skip guide'}
        </Button>
      </div>
    </section>
  );
}
