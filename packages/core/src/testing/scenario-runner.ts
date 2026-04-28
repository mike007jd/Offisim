import type {
  InteractionKind,
  InteractionMode,
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
  StepTaskOutput,
  TaskPlan,
} from '../graph/state.js';
import type { LlmResponse, ToolDef } from '../llm/gateway.js';
import { ModelResolver } from '../llm/model-resolver.js';
import { AuditingToolExecutor } from '../mcp/auditing-tool-executor.js';
import { ToolPermissionEngine } from '../permissions/tool-permission-engine.js';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import type { RuntimeRepositories } from '../runtime/repositories.js';
import { type RuntimeContext, createRuntimeContext } from '../runtime/runtime-context.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import { InteractionService } from '../services/interaction-service.js';
import { SkillLoader } from '../skills/skill-loader.js';
import { SkillStagingManager } from '../skills/skill-staging.js';
import { FakeGateway, type FakeGatewayTurn, fakeResponse } from './fake-gateway.js';
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

export interface DeterministicScenario {
  readonly id: string;
  readonly category: string;
  readonly entryMode: OffisimGraphState['entryMode'];
  readonly seed: {
    readonly company?: Partial<SeedCompany>;
    readonly thread?: Partial<SeedThread>;
    readonly employees?: readonly SeedEmployee[];
    readonly taskRuns?: readonly SeedTaskRun[];
  };
  readonly initialState: ScenarioInitialState;
  readonly tools?: readonly ToolDef[];
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
}

interface SeedEmployee {
  readonly id: string;
  readonly name: string;
  readonly role: RoleSlug;
  readonly config?: Record<string, unknown>;
}

interface SeedTaskRun {
  readonly id: string;
  readonly employeeId: string;
  readonly taskType: string;
  readonly status?: string;
  readonly input?: Record<string, unknown>;
}

interface ScenarioInitialState {
  readonly managerDirective?: OffisimGraphState['managerDirective'];
  readonly taskPlan?: TaskPlan;
  readonly pendingAssignments?: readonly PendingAssignment[];
  readonly currentStepOutputs?: readonly StepTaskOutput[];
  readonly dispatchedStepIndices?: readonly number[];
  readonly completedStepIndices?: readonly number[];
  readonly currentStepIndex?: number;
  readonly routeDecision?: OffisimGraphState['routeDecision'];
}

interface ScenarioRun {
  readonly startAt?: OffisimGraphStartNode;
  readonly expectError?: string;
  readonly autoResolveInteractions?: readonly ScenarioInteractionResolution[];
  readonly resolveAfterRun?: readonly ScenarioInteractionResolution[];
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

export async function runDeterministicScenario(
  scenario: DeterministicScenario,
): Promise<ScenarioTraceReport> {
  const eventBus = new InMemoryEventBus();
  const repos = createMemoryRepositories();
  const companyId = scenario.seed.company?.companyId ?? `company-${scenario.id}`;
  const threadId = scenario.seed.thread?.threadId ?? `thread-${scenario.id}`;
  const trace = new TraceRecorder(eventBus);
  const gateway = new FakeGateway((scenario.llmTurns ?? []).map(toFakeGatewayTurn));
  const toolExecutor = new RecordingToolExecutor(scenario.tools ?? []);
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

  await seedScenario({ scenario, repos, companyId, threadId });

  let finalState: Partial<OffisimGraphState> = buildInitialState(scenario, companyId, threadId);
  try {
    const runs = scenario.runs ?? [{ startAt: 'boss' as const }];
    for (const [index, run] of runs.entries()) {
      const runtimeCtx = createScenarioRuntime({
        eventBus,
        repos,
        companyId,
        threadId,
        gateway,
        toolExecutor,
        interactionService,
        skillLoader,
        skillStagingManager,
      });
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
        finalState = await graph.invoke(finalState, {
          configurable: {
            thread_id: threadId,
            runtimeCtx,
            signal: new AbortController().signal,
          },
        });
        if (run.expectError) {
          throw new Error(`Expected run ${index} to throw ${run.expectError}`);
        }
      } catch (error) {
        if (!run.expectError || !isExpectedError(error, run.expectError)) {
          throw error;
        }
      } finally {
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
}): RuntimeContext {
  const authorizer = new ToolPermissionEngine({
    companyId: params.companyId,
    employees: params.repos.employees,
    mcpAudit: params.repos.mcpAudit,
    approvals: params.repos.toolPermissionApprovals,
    runtimePolicy: HARNESS_RUNTIME_POLICY,
    grants: params.interactionService,
  });
  const auditedToolExecutor = new AuditingToolExecutor(
    params.toolExecutor,
    params.repos.mcpAudit,
    params.eventBus,
    params.companyId,
    params.threadId,
    authorizer,
    params.interactionService,
  );
  return createRuntimeContext({
    repos: params.repos,
    eventBus: params.eventBus,
    llmGateway: params.gateway,
    modelResolver: new ModelResolver(HARNESS_RUNTIME_POLICY),
    toolExecutor: auditedToolExecutor,
    companyId: params.companyId,
    threadId: params.threadId,
    runtimePolicy: HARNESS_RUNTIME_POLICY,
    interactionService: params.interactionService,
    ...(params.skillLoader ? { skillLoader: params.skillLoader } : {}),
    ...(params.skillStagingManager ? { skillStagingManager: params.skillStagingManager } : {}),
  });
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
    interaction_mode: params.scenario.interactionMode ?? 'boss_proxy',
  });
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
    });
  }
  for (const taskRun of params.scenario.seed.taskRuns ?? []) {
    await params.repos.taskRuns.create({
      task_run_id: taskRun.id,
      thread_id: params.threadId,
      employee_id: taskRun.employeeId,
      parent_task_run_id: null,
      task_type: taskRun.taskType,
      status: taskRun.status ?? 'queued',
      input_json: JSON.stringify(taskRun.input ?? {}),
      output_json: null,
      started_at: now,
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
    projectId: null,
    targetEmployeeId: null,
    messages: [],
    managerDirective: scenario.initialState.managerDirective ?? null,
    taskPlan: scenario.initialState.taskPlan ?? null,
    pendingAssignments: [...(scenario.initialState.pendingAssignments ?? [])],
    currentStepOutputs: [...(scenario.initialState.currentStepOutputs ?? [])],
    dispatchedStepIndices: [...(scenario.initialState.dispatchedStepIndices ?? [])],
    completedStepIndices: [...(scenario.initialState.completedStepIndices ?? [])],
    currentStepIndex: scenario.initialState.currentStepIndex ?? 0,
    stepResults: [],
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

  constructor(private readonly tools: readonly ToolDef[]) {}

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    this.executions.push(call);
    return {
      success: true,
      result: { ok: true, tool: call.name, args: call.arguments },
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [...this.tools];
  }
}
