import { HumanMessage } from '@langchain/core/messages';
import type {
  ChatAttachmentRef,
  InteractionKind,
  InteractionMode,
  LlmProvider,
  ProjectStatus,
  RoleSlug,
  RuntimePolicyConfig,
} from '@offisim/shared-types';
import { isSkillInstallTool } from '../agents/skill-install-tools.js';
import { InMemoryEventBus } from '../events/event-bus.js';
import type { EventBus } from '../events/event-bus.js';
import { createMemoryCheckpointSaver } from '../graph/checkpoint-saver.js';
import { type OffisimGraphStartNode, buildOffisimGraph } from '../graph/main-graph.js';
import type {
  OffisimGraphState,
  PendingAssignment,
  RunScope,
  StepResult,
  StepTaskOutput,
  TaskPlan,
} from '../graph/state.js';
import type { LlmResponse, ToolDef } from '../llm/gateway.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { ModelRegistry, ModelRegistryEntry } from '../llm/model-registry.js';
import { ModelResolver } from '../llm/model-resolver.js';
import { RecordedSystemLlmCaller } from '../llm/recorded-system-caller.js';
import { AuditingToolExecutor } from '../mcp/auditing-tool-executor.js';
import { ToolPermissionEngine } from '../permissions/tool-permission-engine.js';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import type { RuntimeRepositories } from '../runtime/repositories.js';
import type { RunConversationStateSnapshot } from '../runtime/run-conversation-state.js';
import { type RuntimeContext, createRuntimeContext } from '../runtime/runtime-context.js';
import type { RuntimeDeterminism } from '../runtime/runtime-context.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import { createRuntimeRollingJournal } from '../services/conversation-budget/rolling-journal-runtime.js';
import { InteractionService } from '../services/interaction-service.js';
import { OrchestrationService } from '../services/orchestration-service.js';
import type { SkillInstallEnvironment } from '../skills/skill-install-environment.js';
import { SkillLoader } from '../skills/skill-loader.js';
import { SkillStagingManager } from '../skills/skill-staging.js';
import type { BuiltinTool } from '../tools/builtin/types.js';
import { CompositeToolExecutor } from '../tools/composite-tool-executor.js';
import { canonicalJson } from './canonical-json.js';
import { FakeGateway, type FakeGatewayTurn, fakeResponse } from './fake-gateway.js';
import { sha256Text } from './hash.js';
import { type ScenarioAssertion, evaluateScenarioAssertions } from './invariant-assertions.js';
import { type ScenarioTraceReport, TraceRecorder } from './trace-recorder.js';

const HARNESS_RUNTIME_POLICY = {
  executionMode: 'desktop-trusted',
  modelPolicy: {
    default: {
      profileName: 'harness-default',
      provider: 'openai-compat',
      model: 'fake-model',
      temperature: 0,
      maxTokens: 256,
    },
  },
  summarization: { enabled: false, triggerTokens: 65536, keepRecentMessages: 12 },
  memory: { enabled: false, injectionEnabled: false, maxFacts: 0, factConfidenceThreshold: 1 },
  toolSearch: { enabled: false },
  toolPermissions: { enabled: true, defaultBehavior: 'allow', rules: [] },
  recording: { mode: 'replay' },
} satisfies RuntimePolicyConfig;

const HARNESS_SYSTEM_GATEWAY: LlmGateway = {
  async chat(): Promise<LlmResponse> {
    return fakeResponse('{}', { inputTokens: 1, outputTokens: 1 });
  },
  async *chatStream(): AsyncIterable<never> {},
  dispose(): void {},
};

export interface DeterministicScenario {
  readonly id: string;
  readonly category: string;
  readonly entryMode: OffisimGraphState['entryMode'];
  readonly seed: {
    readonly company?: Partial<SeedCompany>;
    readonly thread?: Partial<SeedThread>;
    readonly projects?: readonly SeedProject[];
    readonly employees?: readonly SeedEmployee[];
    readonly taskRuns?: readonly SeedTaskRun[];
    readonly kanbanCards?: readonly SeedKanbanCard[];
  };
  readonly initialState: ScenarioInitialState;
  readonly tools?: readonly ToolDef[];
  readonly builtinTools?: readonly ToolDef[];
  readonly modelRegistry?: readonly ScenarioModelRegistryEntry[];
  readonly llmToolCallsEnabled?: boolean;
  readonly toolFixtures?: Record<string, readonly ToolResultFixture[]>;
  readonly skillInstallRuntime?: SkillInstallEnvironment['runtime'];
  readonly llmTurns?: readonly ScenarioLlmTurn[];
  readonly interactionMode?: InteractionMode;
  readonly runs?: readonly ScenarioRun[];
  readonly assertions: readonly ScenarioAssertion[];
}

interface SeedCompany {
  readonly companyId: string;
  readonly name: string;
}

interface SeedThread {
  readonly threadId: string;
  readonly status: string;
  readonly projectId: string | null;
}

interface SeedProject {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: ProjectStatus;
  readonly workspaceRoot?: string | null;
}

interface SeedEmployee {
  readonly id: string;
  readonly name: string;
  readonly role: RoleSlug;
  readonly enabled?: boolean;
  readonly config?: Record<string, unknown>;
  readonly isExternal?: boolean;
  readonly a2aUrl?: string | null;
  readonly a2aToken?: string | null;
  readonly a2aAgentId?: string | null;
  readonly brandKey?: string | null;
  readonly agentCardJson?: string | null;
}

interface SeedTaskRun {
  readonly id: string;
  readonly threadId?: string;
  readonly employeeId: string;
  readonly taskType: string;
  readonly status?: string;
  readonly input?: Record<string, unknown>;
}

interface ScenarioModelRegistryEntry {
  readonly id: string;
  readonly displayName?: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

interface SeedKanbanCard {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly state?: 'todo' | 'doing' | 'blocked' | 'review' | 'done';
  readonly origin?: 'pm-planner' | 'employee' | 'manager' | 'human';
  readonly assignedEmployeeId?: string | null;
  readonly taskRunId?: string | null;
}

interface ScenarioInitialState {
  readonly projectId?: string | null;
  readonly managerDirective?: OffisimGraphState['managerDirective'];
  readonly taskPlan?: TaskPlan;
  readonly pendingAssignments?: readonly PendingAssignment[];
  readonly currentStepOutputs?: readonly StepTaskOutput[];
  readonly stepResults?: readonly StepResult[];
  readonly recentToolResults?: OffisimGraphState['recentToolResults'];
  readonly dispatchedStepIndices?: readonly number[];
  readonly completedStepIndices?: readonly number[];
  readonly blockedStepIndices?: readonly number[];
  readonly currentStepIndex?: number;
  readonly routeDecision?: OffisimGraphState['routeDecision'];
  readonly targetEmployeeId?: string | null;
  readonly messages?: readonly ScenarioInitialMessage[];
}

interface ScenarioInitialMessage {
  readonly role: 'user';
  readonly content: string;
}

interface ScenarioRun {
  readonly startAt?: OffisimGraphStartNode;
  readonly expectError?: string;
  readonly runScope?: ScenarioRunScope;
  readonly executionThreadId?: string;
  readonly runtimeContextThreadId?: string;
  readonly useOrchestrationService?: boolean;
  readonly abortBeforeRun?: boolean;
  readonly abortOnLlmTurnIds?: readonly string[];
  readonly abortOnToolNames?: readonly string[];
  readonly autoResolveInteractions?: readonly ScenarioInteractionResolution[];
  readonly resolveAfterRun?: readonly ScenarioInteractionResolution[];
}

interface ScenarioRunScope {
  readonly conversationKey?: string;
  readonly runId?: string;
  readonly threadId?: string;
  readonly pendingAttachments?: readonly (Omit<ChatAttachmentRef, 'vaultRef'> & {
    readonly vaultRef: string;
  })[];
  readonly availableAttachments?: readonly (Omit<ChatAttachmentRef, 'vaultRef'> & {
    readonly vaultRef: string;
  })[];
}

interface ScenarioInteractionResolution {
  readonly kind: InteractionKind;
  readonly selectedOptionId: string;
  readonly freeformResponse?: string;
  readonly restoreBeforeResolve?: boolean;
}

interface ScenarioLlmTurn {
  readonly id: string;
  readonly match?: FakeGatewayTurn['match'];
  readonly content: string;
  readonly toolCalls?: LlmResponse['toolCalls'];
}

interface ToolResultFixture {
  readonly success: boolean;
  readonly result: unknown;
  readonly error?: string;
}

interface ScenarioAbortHarness {
  controller: AbortController | null;
  llmTurnIds: Set<string>;
  toolNames: Set<string>;
}

export async function runDeterministicScenario(
  scenario: DeterministicScenario,
): Promise<ScenarioTraceReport> {
  if (isKanbanMatrixScenario(scenario)) {
    return runKanbanMatrixScenario(scenario);
  }

  const eventBus = new InMemoryEventBus();
  const repos = createMemoryRepositories(undefined, undefined, eventBus);
  const companyId = scenario.seed.company?.companyId ?? `company-${scenario.id}`;
  const threadId = scenario.seed.thread?.threadId ?? `thread-${scenario.id}`;
  const trace = new TraceRecorder(eventBus);
  const abortHarness: ScenarioAbortHarness = {
    controller: null,
    llmTurnIds: new Set(),
    toolNames: new Set(),
  };
  const gateway = new FakeGateway((scenario.llmTurns ?? []).map(toFakeGatewayTurn), {
    abortController: () => abortHarness.controller,
    shouldAbortTurn: (turnId) => abortHarness.llmTurnIds.has(turnId),
  });
  const toolExecutor = new RecordingToolExecutor(
    scenario.tools ?? [],
    scenario.toolFixtures ?? {},
    abortHarness,
  );
  const needsSkillInstall = scenarioUsesSkillInstallTools(scenario);
  const skillLoader = needsSkillInstall ? SkillLoader.forRepos(repos) : null;
  const skillStagingManager = needsSkillInstall
    ? createScenarioSkillStagingManager(scenario.id)
    : null;
  let interactionService = createInteractionService({
    scenario,
    eventBus,
    repos,
    companyId,
    threadId,
  });
  const determinism = createScenarioDeterminism(scenario.id);

  await seedScenario({ scenario, repos, companyId, threadId });

  let finalState: Partial<OffisimGraphState> = buildInitialState(scenario, companyId, threadId);
  let conversationStateSnapshot: RunConversationStateSnapshot | undefined;
  try {
    const runs = scenario.runs ?? [{ startAt: 'boss' as const }];
    for (const [index, run] of runs.entries()) {
      const executionThreadId = run.executionThreadId ?? threadId;
      const abortController = new AbortController();
      abortHarness.controller = abortController;
      abortHarness.llmTurnIds = new Set(run.abortOnLlmTurnIds ?? []);
      abortHarness.toolNames = new Set(run.abortOnToolNames ?? []);
      if (run.abortBeforeRun) {
        abortController.abort(
          new DOMException(`Harness cancelled run ${index} before graph execution.`, 'AbortError'),
        );
      }
      const runtimeCtx = createScenarioRuntime({
        eventBus,
        repos,
        companyId,
        threadId: run.runtimeContextThreadId ?? threadId,
        gateway,
        toolExecutor,
        interactionService,
        skillLoader,
        skillStagingManager,
        skillInstallRuntime: scenario.skillInstallRuntime,
        builtinTools: scenario.builtinTools ?? [],
        modelRegistryEntries: scenario.modelRegistry ?? [],
        llmToolCallsEnabled: scenario.llmToolCallsEnabled ?? true,
        determinism,
      });
      conversationStateSnapshot = runtimeCtx.conversationState.toJSON();
      const unsubscribe = installAutoInteractionResolver(
        eventBus,
        interactionService,
        run.autoResolveInteractions ?? [],
      );
      const graph = buildOffisimGraph({
        checkpointer: createMemoryCheckpointSaver(),
        ...(run.startAt ? { startAt: run.startAt } : {}),
      });
      try {
        const runScope = buildScenarioRunScope(run, scenario.id, threadId);
        if (run.useOrchestrationService) {
          const orch = new OrchestrationService(graph, runtimeCtx);
          finalState = await orch.execute({
            entryMode: finalState.entryMode ?? scenario.entryMode,
            messages: finalState.messages ?? [],
            targetEmployeeId: finalState.targetEmployeeId ?? null,
            threadId: executionThreadId,
            projectId: finalState.projectId ?? null,
            ...(runScope ? { runScope } : {}),
          });
        } else {
          finalState = await graph.invoke(finalState, {
            configurable: {
              thread_id: executionThreadId,
              runtimeCtx,
              signal: abortController.signal,
              ...(runScope ? { runScope } : {}),
            },
          });
        }
        conversationStateSnapshot = runtimeCtx.conversationState.toJSON();
        if (run.expectError) {
          throw new Error(`Expected run ${index} to throw ${run.expectError}`);
        }
      } catch (error) {
        if (!run.expectError || !isExpectedError(error, run.expectError)) {
          throw error;
        }
      } finally {
        abortHarness.controller = null;
        abortHarness.llmTurnIds = new Set();
        abortHarness.toolNames = new Set();
        unsubscribe();
      }

      for (const resolution of run.resolveAfterRun ?? []) {
        if (resolution.restoreBeforeResolve) {
          interactionService = createInteractionService({
            scenario,
            eventBus,
            repos,
            companyId,
            threadId,
          });
          await interactionService.restore();
        }
        await resolveCurrentInteraction(interactionService, resolution);
      }
    }

    const assertions = await evaluateScenarioAssertions(scenario.assertions, {
      scenarioId: scenario.id,
      finalState,
      repos,
      threadId,
      toolExecutions: toolExecutor.executions,
      events: trace.events,
      conversationState: conversationStateSnapshot,
    });
    const passed = assertions.every((assertion) => assertion.passed);
    return trace.report({
      scenarioId: scenario.id,
      passed,
      assertions,
      repos,
      threadId,
      finalState,
    });
  } finally {
    trace.stop();
    gateway.dispose();
    skillStagingManager?.dispose();
  }
}

function isKanbanMatrixScenario(scenario: DeterministicScenario): boolean {
  return scenario.category === 'kanban-matrix';
}

async function runKanbanMatrixScenario(
  scenario: DeterministicScenario,
): Promise<ScenarioTraceReport> {
  const modes: readonly InteractionMode[] = ['boss_proxy', 'direct_to_employee', 'yolo'];
  const reports = await Promise.all(
    modes.map((mode) => runDeterministicScenario(buildMatrixCaseScenario(scenario.id, mode))),
  );
  const caseAssertions = reports.map((report) => ({
    kind: `kanbanMatrix:${report.scenarioId}`,
    passed: report.passed,
    message: report.passed
      ? undefined
      : report.assertions
          .filter((assertion) => !assertion.passed)
          .map((assertion) => assertion.message ?? assertion.kind)
          .join('; '),
  }));
  const matrixAssertions = evaluateKanbanMatrixAssertions(scenario, reports);
  const assertions = [...caseAssertions, ...matrixAssertions];
  const trace = {
    events: reports.map((report) => ({
      scenarioId: report.scenarioId,
      traceHash: '<hash>',
      events: report.trace.events,
    })),
    db: {
      taskRuns: [],
      llmCalls: [],
      mcpAudit: [],
      activeInteractions: [],
      interactionHistory: [],
      toolPermissionApprovals: [],
    },
    finalState: {
      completed: true,
      pendingAssignments: [],
      cases: reports.map((report) => ({
        scenarioId: report.scenarioId,
        passed: report.passed,
        traceHash: '<hash>',
      })),
    },
  };
  return {
    scenarioId: scenario.id,
    passed: assertions.every((assertion) => assertion.passed),
    traceHash: await sha256Text(canonicalJson(trace)),
    assertions,
    trace,
  };
}

interface KanbanMatrixAssertion {
  readonly kind: 'kanbanMatrixAllModesPassed' | 'kanbanMatrixCaseCards';
  readonly mode?: InteractionMode;
  readonly origin?: 'pm-planner' | 'employee';
  readonly states?: Record<string, number>;
  readonly taskRunBound?: boolean;
  readonly assignedEmployeeId?: string | null;
  readonly transitionTrail?: readonly KanbanMatrixTrailExpectation[];
}

interface KanbanMatrixTrailExpectation {
  readonly op: 'created' | 'transitioned' | 'assigned';
  readonly state?: SeedKanbanCard['state'];
  readonly taskRunBound?: boolean;
  readonly assignedEmployeeId?: string | null;
}

function evaluateKanbanMatrixAssertions(
  scenario: DeterministicScenario,
  reports: readonly ScenarioTraceReport[],
): ScenarioTraceReport['assertions'] {
  const rawAssertions = Array.isArray((scenario as { assertions?: unknown }).assertions)
    ? ((scenario as { assertions: readonly unknown[] }).assertions ?? [])
    : [];
  return rawAssertions.map((assertion, index) => {
    if (!isKanbanMatrixAssertion(assertion)) {
      return {
        kind: `kanbanMatrix.assertion.${index}`,
        passed: false,
        message: `Unsupported kanban matrix assertion: ${JSON.stringify(assertion)}`,
      };
    }
    try {
      assertKanbanMatrixAssertion(assertion, reports);
      return { kind: assertion.kind, passed: true };
    } catch (error) {
      return {
        kind: assertion.kind,
        passed: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function isKanbanMatrixAssertion(value: unknown): value is KanbanMatrixAssertion {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'kanbanMatrixAllModesPassed' || kind === 'kanbanMatrixCaseCards';
}

function assertKanbanMatrixAssertion(
  assertion: KanbanMatrixAssertion,
  reports: readonly ScenarioTraceReport[],
): void {
  if (assertion.kind === 'kanbanMatrixAllModesPassed') {
    const failed = reports.filter((report) => !report.passed).map((report) => report.scenarioId);
    if (failed.length > 0) throw new Error(`Kanban matrix failed cases: ${failed.join(', ')}`);
    return;
  }

  const mode = assertion.mode;
  if (!mode) throw new Error('kanbanMatrixCaseCards requires mode');
  const report = reports.find((candidate) => candidate.scenarioId.endsWith(modeSuffix(mode)));
  if (!report) throw new Error(`No kanban matrix case report for mode ${mode}`);
  const cards = toRecordArray(report.trace.db.kanbanCards);
  if (cards.length === 0) throw new Error(`No kanban cards recorded for mode ${mode}`);
  if (assertion.origin) {
    const mismatched = cards.filter((card) => card.origin !== assertion.origin);
    if (mismatched.length > 0) {
      throw new Error(
        `Expected all ${mode} cards origin=${assertion.origin}, got ${JSON.stringify(cards)}`,
      );
    }
  }
  for (const [state, expectedCount] of Object.entries(assertion.states ?? {})) {
    const actual = cards.filter((card) => card.state === state).length;
    if (actual !== expectedCount) {
      throw new Error(`Expected ${expectedCount} ${mode} cards in ${state}, got ${actual}`);
    }
  }
  if (assertion.taskRunBound !== undefined) {
    assertCardsTaskRunBound(mode, cards, assertion.taskRunBound);
  }
  if (hasOwn(assertion, 'assignedEmployeeId')) {
    assertCardsAssignedEmployee(mode, cards, assertion.assignedEmployeeId ?? null);
  }
  if (assertion.transitionTrail) {
    assertKanbanTransitionTrail(mode, report.trace.events, assertion.transitionTrail);
  }
}

function modeSuffix(mode: InteractionMode): string {
  return mode.replaceAll('_', '-');
}

function assertCardsTaskRunBound(
  mode: InteractionMode,
  cards: readonly Record<string, unknown>[],
  expected: boolean,
): void {
  const mismatched = cards.filter((card) => isTaskRunBound(card) !== expected);
  if (mismatched.length > 0) {
    throw new Error(
      `Expected all ${mode} cards taskRunBound=${expected}, got ${JSON.stringify(cards)}`,
    );
  }
}

function assertCardsAssignedEmployee(
  mode: InteractionMode,
  cards: readonly Record<string, unknown>[],
  expected: string | null,
): void {
  const mismatched = cards.filter((card) => (card.assigned_employee_id ?? null) !== expected);
  if (mismatched.length > 0) {
    throw new Error(
      `Expected all ${mode} cards assignedEmployeeId=${expected}, got ${JSON.stringify(cards)}`,
    );
  }
}

function assertKanbanTransitionTrail(
  mode: InteractionMode,
  events: readonly unknown[],
  expectedTrail: readonly KanbanMatrixTrailExpectation[],
): void {
  const trail = toRecordArray(events)
    .map((event) => {
      const payload = toRecord(event.payload);
      if (payload?.kind !== 'kanban') return null;
      const card = toRecord(payload.card);
      return {
        op: payload.op,
        state: card?.state,
        taskRunBound: isTaskRunBound(card),
        assignedEmployeeId: card?.assigned_employee_id ?? null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (trail.length !== expectedTrail.length) {
    throw new Error(
      `Expected ${mode} kanban trail length ${expectedTrail.length}, got ${trail.length}: ${JSON.stringify(trail)}`,
    );
  }

  expectedTrail.forEach((expected, index) => {
    const actual = trail[index];
    if (!actual) throw new Error(`Missing ${mode} kanban trail event at index ${index}`);
    if (actual.op !== expected.op) {
      throw new Error(
        `Expected ${mode} kanban trail op ${expected.op} at index ${index}, got ${String(actual.op)}`,
      );
    }
    if (expected.state !== undefined && actual.state !== expected.state) {
      throw new Error(
        `Expected ${mode} kanban trail state ${expected.state} at index ${index}, got ${String(actual.state)}`,
      );
    }
    if (expected.taskRunBound !== undefined && actual.taskRunBound !== expected.taskRunBound) {
      throw new Error(
        `Expected ${mode} kanban trail taskRunBound=${expected.taskRunBound} at index ${index}, got ${actual.taskRunBound}`,
      );
    }
    if (
      hasOwn(expected, 'assignedEmployeeId') &&
      actual.assignedEmployeeId !== (expected.assignedEmployeeId ?? null)
    ) {
      throw new Error(
        `Expected ${mode} kanban trail assignedEmployeeId=${expected.assignedEmployeeId ?? null} at index ${index}, got ${String(actual.assignedEmployeeId)}`,
      );
    }
  });
}

function isTaskRunBound(card: Record<string, unknown> | null): boolean {
  return typeof card?.task_run_id === 'string' && card.task_run_id.length > 0;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry && typeof entry === 'object'),
      )
    : [];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildMatrixCaseScenario(matrixId: string, mode: InteractionMode): DeterministicScenario {
  const suffix = modeSuffix(mode);
  const companyId = `company-${matrixId}-${suffix}`;
  const threadId = `thread-${matrixId}-${suffix}`;
  const projectId = `project-${matrixId}-${suffix}`;
  const employeeId = mode === 'yolo' ? `emp-${suffix}` : `emp-${matrixId}-${suffix}`;
  const employeeName = mode === 'yolo' ? 'YOLO Master' : `Matrix ${suffix}`;
  const employeeRole: RoleSlug = mode === 'yolo' ? 'yolo_master' : 'engineer';
  const tool: ToolDef = {
    name: 'pnpm-test',
    description: 'Run the deterministic package test command.',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
  };
  const pmPlan = JSON.stringify({
    summary: `Build a counter component in ${mode}`,
    steps: [
      {
        stepIndex: 0,
        description: `Build a counter component in ${mode}`,
        tasks: [
          {
            taskType: 'code',
            employeeId,
            description: `Build a counter component with tests in ${mode}`,
            dependsOnStepOutput: false,
          },
        ],
      },
    ],
  });
  const base = {
    id: `${matrixId}-${suffix}`,
    category: 'kanban-matrix-case',
    entryMode: 'boss_chat' as const,
    interactionMode: mode,
    seed: {
      company: { companyId, name: `Matrix ${mode}` },
      thread: { threadId, status: 'running', projectId },
      projects: [{ id: projectId, name: `Matrix ${mode} Project` }],
      employees: [{ id: employeeId, name: employeeName, role: employeeRole }],
    },
    tools: [tool],
    initialState: {
      projectId,
      managerDirective: {
        intent: 'Build a counter component with tests',
        recommendedEmployees: [employeeId],
      },
    },
    assertions: [
      {
        kind: 'kanbanCards' as const,
        projectId,
        count: 1,
        origin: mode === 'yolo' ? ('employee' as const) : ('pm-planner' as const),
        states: { done: 1 },
      },
    ],
  };

  if (mode === 'yolo') {
    return {
      ...base,
      toolFixtures: {
        'pnpm-test': [{ success: true, result: { ok: true, command: 'pnpm test -- counter' } }],
      },
      llmTurns: [
        {
          id: 'yolo-create-todo-and-test',
          match: {
            toolNames: ['todo_create', 'pnpm-test'],
          },
          content: '',
          toolCalls: [
            {
              id: 'tc-yolo-todo',
              name: 'todo_create',
              arguments: { title: 'Build counter component', projectId },
            },
            {
              id: 'tc-yolo-test',
              name: 'pnpm-test',
              arguments: { command: 'pnpm test -- counter' },
            },
          ],
        },
        {
          id: 'yolo-final',
          match: { contains: 'pnpm test -- counter' },
          content: 'COUNTER_DONE_YOLO',
        },
      ],
      runs: [{}],
    };
  }

  return {
    ...base,
    toolFixtures: {
      'pnpm-test': [{ success: true, result: { ok: true, command: 'pnpm test -- counter' } }],
    },
    llmTurns: [
      {
        id: 'pm-plan',
        match: { contains: 'Build a counter component with tests' },
        content: pmPlan,
      },
      {
        id: 'employee-test',
        match: {
          contains: `Build a counter component with tests in ${mode}`,
          toolNames: ['pnpm-test'],
        },
        content: '',
        toolCalls: [
          {
            id: 'tc-employee-test',
            name: 'pnpm-test',
            arguments: { command: 'pnpm test -- counter' },
          },
        ],
      },
      {
        id: 'employee-final',
        match: { contains: 'pnpm test -- counter' },
        content: `COUNTER_DONE_${mode.toUpperCase()}`,
      },
    ],
    runs: [{ startAt: 'pm_planner' }],
  };
}

function createScenarioRuntime(params: {
  readonly eventBus: EventBus;
  readonly repos: RuntimeRepositories;
  readonly companyId: string;
  readonly threadId: string;
  readonly gateway: FakeGateway;
  readonly toolExecutor: RecordingToolExecutor;
  readonly interactionService: InteractionService;
  readonly skillLoader: SkillLoader | null;
  readonly skillStagingManager: SkillStagingManager | null;
  readonly skillInstallRuntime: SkillInstallEnvironment['runtime'] | undefined;
  readonly builtinTools: readonly ToolDef[];
  readonly modelRegistryEntries: readonly ScenarioModelRegistryEntry[];
  readonly llmToolCallsEnabled: boolean;
  readonly determinism: RuntimeDeterminism;
}): RuntimeContext {
  const authorizer = new ToolPermissionEngine({
    companyId: params.companyId,
    employees: params.repos.employees,
    mcpAudit: params.repos.mcpAudit,
    approvals: params.repos.toolPermissionApprovals,
    runtimePolicy: HARNESS_RUNTIME_POLICY,
    grants: params.interactionService,
  });
  const builtinToolMap = createScenarioBuiltinTools(params.builtinTools);
  const executionToolExecutor =
    builtinToolMap.size > 0
      ? new CompositeToolExecutor(builtinToolMap, params.toolExecutor)
      : params.toolExecutor;
  const auditedToolExecutor = new AuditingToolExecutor(
    executionToolExecutor,
    params.repos.mcpAudit,
    params.eventBus,
    params.companyId,
    params.threadId,
    authorizer,
    params.interactionService,
  );
  let runtimeCtx: RuntimeContext | null = null;
  const rollingJournal = createRuntimeRollingJournal(() => {
    if (!runtimeCtx) {
      throw new Error('Scenario runtime context is not ready for rolling journal.');
    }
    return runtimeCtx;
  });
  runtimeCtx = createRuntimeContext({
    repos: params.repos,
    eventBus: params.eventBus,
    llmGateway: params.gateway,
    modelResolver: new ModelResolver(HARNESS_RUNTIME_POLICY),
    toolExecutor: auditedToolExecutor,
    companyId: params.companyId,
    threadId: params.threadId,
    runtimePolicy: HARNESS_RUNTIME_POLICY,
    llmToolCallsEnabled: params.llmToolCallsEnabled,
    determinism: params.determinism,
    systemCaller: new RecordedSystemLlmCaller({
      llmGateway: HARNESS_SYSTEM_GATEWAY,
      llmCalls: params.repos.llmCalls,
      eventBus: params.eventBus,
      companyId: params.companyId,
      threadId: params.threadId,
    }),
    ...(params.modelRegistryEntries.length > 0
      ? { modelRegistry: createScenarioModelRegistry(params.modelRegistryEntries) }
      : {}),
    builtinTools: builtinToolMap,
    interactionService: params.interactionService,
    rollingJournal,
    ...(params.skillLoader ? { skillLoader: params.skillLoader } : {}),
    ...(params.skillStagingManager ? { skillStagingManager: params.skillStagingManager } : {}),
    ...(params.skillInstallRuntime
      ? {
          skillInstallEnvironment: createScenarioSkillInstallEnvironment(
            params.skillInstallRuntime,
          ),
        }
      : {}),
  });
  return runtimeCtx;
}

function createScenarioModelRegistry(
  entries: readonly ScenarioModelRegistryEntry[],
): ModelRegistry {
  const normalized = entries.map(
    (entry): ModelRegistryEntry => ({
      id: entry.id,
      displayName: entry.displayName ?? entry.id,
      provider: entry.provider,
      model: entry.model,
      apiKey: '$HARNESS_FAKE_KEY',
      ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
      ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
    }),
  );
  return {
    findById(modelId: string) {
      return normalized.find((entry) => entry.id === modelId || entry.model === modelId) ?? null;
    },
    listModels() {
      return [...normalized];
    },
    getDefault() {
      return normalized[0] ?? null;
    },
    getGateway(_modelId: string): LlmGateway | null {
      return null;
    },
    loadConfig() {},
    disposeAll() {},
    resolveEnvVars(value: string) {
      return value;
    },
  } as unknown as ModelRegistry;
}

function createScenarioSkillInstallEnvironment(
  runtime: SkillInstallEnvironment['runtime'],
): SkillInstallEnvironment {
  return {
    runtime,
    httpFetch: async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  };
}

function createScenarioDeterminism(scenarioId: string): RuntimeDeterminism {
  const counters = new Map<string, number>();
  return {
    nowMs: () => 1_704_067_200_000,
    nowIso: () => '2024-01-01T00:00:00.000Z',
    id: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}-${scenarioId}-${next}`;
    },
    uuid: () => {
      const next = (counters.get('uuid') ?? 0) + 1;
      counters.set('uuid', next);
      return `00000000-0000-4000-8000-${next.toString().padStart(12, '0')}`;
    },
  };
}

function createScenarioBuiltinTools(tools: readonly ToolDef[]): Map<string, BuiltinTool> {
  return new Map(
    tools.map((def) => [
      def.name,
      {
        def,
        execute: async (args) => ({ ok: true, tool: def.name, args }),
      },
    ]),
  );
}

function createScenarioSkillStagingManager(scenarioId: string): SkillStagingManager {
  let next = 0;
  return new SkillStagingManager({
    now: () => 1,
    idFactory: () => `stg-${scenarioId}-${++next}`,
  });
}

function scenarioUsesSkillInstallTools(scenario: DeterministicScenario): boolean {
  if ((scenario.tools ?? []).some((tool) => isSkillInstallTool(tool.name))) return true;
  for (const turn of scenario.llmTurns ?? []) {
    if ((turn.toolCalls ?? []).some((call) => isSkillInstallTool(call.name))) return true;
  }
  return false;
}

function createInteractionService(params: {
  readonly scenario: DeterministicScenario;
  readonly eventBus: EventBus;
  readonly repos: RuntimeRepositories;
  readonly companyId: string;
  readonly threadId: string;
}): InteractionService {
  return new InteractionService({
    eventBus: params.eventBus,
    companyId: params.companyId,
    threadId: params.threadId,
    defaultMode: params.scenario.interactionMode ?? 'boss_proxy',
    activeRepo: params.repos.activeInteractions,
    historyRepo: params.repos.interactionHistory,
    permissionApprovals: params.repos.toolPermissionApprovals,
  });
}

async function seedScenario(params: {
  readonly scenario: DeterministicScenario;
  readonly repos: RuntimeRepositories;
  readonly companyId: string;
  readonly threadId: string;
}): Promise<void> {
  const now = '2026-01-01T00:00:00.000Z';
  await params.repos.companies.create({
    company_id: params.companyId,
    name: params.scenario.seed.company?.name ?? params.scenario.id,
    status: 'active',
    template_id: null,
    template_label: 'Harness',
    workspace_root: null,
    default_model_policy_json: null,
    created_at: now,
    updated_at: now,
  });
  await params.repos.threads.create({
    thread_id: params.threadId,
    company_id: params.companyId,
    entry_mode: params.scenario.entryMode,
    root_task_id: null,
    status: params.scenario.seed.thread?.status ?? 'running',
    project_id:
      params.scenario.seed.thread?.projectId ?? params.scenario.seed.projects?.[0]?.id ?? null,
    interaction_mode: params.scenario.interactionMode ?? 'boss_proxy',
  });
  for (const project of params.scenario.seed.projects ?? []) {
    await params.repos.projects.create({
      project_id: project.id,
      company_id: params.companyId,
      name: project.name,
      description: project.description ?? null,
      status: project.status ?? 'active',
      workspace_root: project.workspaceRoot ?? null,
    });
  }
  for (const employee of params.scenario.seed.employees ?? []) {
    await params.repos.employees.create({
      employee_id: employee.id,
      company_id: params.companyId,
      source_asset_id: null,
      source_package_id: null,
      name: employee.name,
      role_slug: employee.role,
      persona_json: JSON.stringify({ expertise: 'Harness scenario employee' }),
      config_json: JSON.stringify(employee.config ?? {}),
      is_external: employee.isExternal === true,
      a2a_url: employee.a2aUrl ?? null,
      a2a_token: employee.a2aToken ?? null,
      a2a_agent_id: employee.a2aAgentId ?? null,
      brand_key: employee.brandKey ?? null,
      agent_card_json: employee.agentCardJson ?? null,
    });
    if (employee.enabled === false) {
      await params.repos.employees.update(employee.id, { enabled: 0 });
    }
  }
  for (const taskRun of params.scenario.seed.taskRuns ?? []) {
    await params.repos.taskRuns.create({
      task_run_id: taskRun.id,
      thread_id: taskRun.threadId ?? params.threadId,
      employee_id: taskRun.employeeId,
      parent_task_run_id: null,
      task_type: taskRun.taskType,
      status: taskRun.status ?? 'queued',
      input_json: JSON.stringify(taskRun.input ?? {}),
      output_json: null,
      started_at: now,
    });
  }
  for (const card of params.scenario.seed.kanbanCards ?? []) {
    await params.repos.kanban.create({
      id: card.id,
      project_id: card.projectId,
      company_id: params.companyId,
      title: card.title,
      note: '',
      state: card.state ?? 'todo',
      origin: card.origin ?? 'human',
      assigned_employee_id: card.assignedEmployeeId ?? null,
      task_run_id: card.taskRunId ?? null,
    });
  }
}

function buildInitialState(
  scenario: DeterministicScenario,
  companyId: string,
  threadId: string,
): Partial<OffisimGraphState> {
  return {
    threadId,
    companyId,
    entryMode: scenario.entryMode,
    interactionMode: scenario.interactionMode ?? 'boss_proxy',
    projectId:
      scenario.initialState.projectId ??
      scenario.seed.thread?.projectId ??
      scenario.seed.projects?.[0]?.id ??
      null,
    targetEmployeeId: scenario.initialState.targetEmployeeId ?? null,
    messages: (scenario.initialState.messages ?? []).map(
      (message) => new HumanMessage(message.content),
    ),
    managerDirective: scenario.initialState.managerDirective ?? null,
    taskPlan: scenario.initialState.taskPlan ?? null,
    pendingAssignments: [...(scenario.initialState.pendingAssignments ?? [])],
    currentStepOutputs: [...(scenario.initialState.currentStepOutputs ?? [])],
    recentToolResults: [...(scenario.initialState.recentToolResults ?? [])],
    dispatchedStepIndices: [...(scenario.initialState.dispatchedStepIndices ?? [])],
    completedStepIndices: [...(scenario.initialState.completedStepIndices ?? [])],
    blockedStepIndices: [...(scenario.initialState.blockedStepIndices ?? [])],
    currentStepIndex: scenario.initialState.currentStepIndex ?? 0,
    stepResults: [...(scenario.initialState.stepResults ?? [])],
    routeDecision: scenario.initialState.routeDecision ?? null,
    completed: false,
  };
}

function toFakeGatewayTurn(turn: ScenarioLlmTurn): FakeGatewayTurn {
  return {
    id: turn.id,
    match: turn.match,
    response: fakeResponse(turn.content, {
      toolCalls: turn.toolCalls ?? [],
      inputTokens: 1,
      outputTokens: 1,
    }),
  };
}

function installAutoInteractionResolver(
  eventBus: EventBus,
  interactionService: InteractionService,
  resolutions: readonly ScenarioInteractionResolution[],
): () => void {
  if (resolutions.length === 0) return () => {};
  const queue = [...resolutions];
  return eventBus.on('interaction.requested', (event) => {
    const request = event.payload?.request;
    if (!request || typeof request !== 'object') return;
    const nextIndex = queue.findIndex((resolution) => resolution.kind === request.kind);
    if (nextIndex < 0) return;
    const [resolution] = queue.splice(nextIndex, 1);
    if (!resolution) return;
    queueMicrotask(() => {
      void interactionService.resolve(buildInteractionResponse(request.interactionId, resolution));
    });
  });
}

async function resolveCurrentInteraction(
  interactionService: InteractionService,
  resolution: ScenarioInteractionResolution,
): Promise<void> {
  const pending = interactionService.getPending();
  if (!pending || pending.kind !== resolution.kind) {
    throw new Error(`No pending ${resolution.kind} interaction to resolve`);
  }
  await interactionService.resolve(buildInteractionResponse(pending.interactionId, resolution));
}

function isExpectedError(error: unknown, expected: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(expected);
}

function buildScenarioRunScope(
  run: ScenarioRun,
  scenarioId: string,
  threadId: string,
): RunScope | undefined {
  const scope = run.runScope;
  if (!scope) return undefined;
  return {
    conversationKey: scope.conversationKey ?? threadId,
    runId: scope.runId ?? `run-${scenarioId}`,
    threadId: scope.threadId ?? threadId,
    ...(scope.pendingAttachments
      ? { pendingAttachments: scope.pendingAttachments as readonly ChatAttachmentRef[] }
      : {}),
    ...(scope.availableAttachments
      ? { availableAttachments: scope.availableAttachments as readonly ChatAttachmentRef[] }
      : {}),
  };
}

function buildInteractionResponse(
  interactionId: string,
  resolution: ScenarioInteractionResolution,
) {
  return {
    interactionId,
    selectedOptionId: resolution.selectedOptionId,
    ...(resolution.freeformResponse ? { freeformResponse: resolution.freeformResponse } : {}),
    respondedAt: Date.now(),
  };
}

class RecordingToolExecutor implements ToolExecutor {
  readonly executions: ToolCallRequest[] = [];
  private readonly callCounts = new Map<string, number>();

  constructor(
    private readonly tools: readonly ToolDef[],
    private readonly fixtures: Record<string, readonly ToolResultFixture[]>,
    private readonly abortHarness: ScenarioAbortHarness,
  ) {}

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    if (this.abortHarness.toolNames.has(call.name)) {
      const reason = new DOMException(
        `Harness cancelled tool request "${call.name}".`,
        'AbortError',
      );
      this.abortHarness.controller?.abort(reason);
      throw reason;
    }
    if (call.signal?.aborted) {
      throw abortErrorFromSignal(call.signal, new DOMException('Aborted', 'AbortError'));
    }
    this.executions.push(call);
    const callIndex = this.callCounts.get(call.name) ?? 0;
    this.callCounts.set(call.name, callIndex + 1);
    const fixture = this.fixtures[call.name]?.[callIndex];
    if (!fixture) {
      throw new Error(`ToolFixtureMissing(${call.name}, ${callIndex})`);
    }
    return {
      success: fixture.success,
      result: fixture.result,
      ...(fixture.error ? { error: fixture.error } : {}),
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [...this.tools];
  }
}

function abortErrorFromSignal(signal: AbortSignal | undefined, fallback: DOMException): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new DOMException(reason, 'AbortError');
  return fallback;
}
