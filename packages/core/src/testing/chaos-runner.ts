import { performance } from 'node:perf_hooks';
import { InMemoryEventBus } from '../events/event-bus.js';
import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk } from '../llm/gateway.js';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import { InteractionService } from '../services/interaction-service.js';

export type HarnessFaultKind =
  | 'llm-timeout'
  | 'llm-malformed-tool-args'
  | 'tool-timeout'
  | 'interaction-delayed-approval';

export interface HarnessFaultCase {
  readonly id: string;
  readonly kind: HarnessFaultKind;
  readonly timeoutMs?: number;
}

export interface HarnessFaultReport {
  readonly id: string;
  readonly kind: HarnessFaultKind;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly failure?: string;
  readonly structuredFailure?: {
    readonly category: string;
    readonly message: string;
  };
}

export interface ChaosHarnessReport {
  readonly suite: 'chaos';
  readonly cases: readonly HarnessFaultReport[];
  readonly passed: number;
  readonly failed: number;
}

export const QUICK_CHAOS_CASES: readonly HarnessFaultCase[] = [
  { id: 'fake-gateway-timeout', kind: 'llm-timeout', timeoutMs: 25 },
  { id: 'malformed-tool-json', kind: 'llm-malformed-tool-args' },
  { id: 'tool-timeout', kind: 'tool-timeout', timeoutMs: 25 },
  { id: 'interaction-delayed-approval', kind: 'interaction-delayed-approval', timeoutMs: 25 },
];

export async function runChaosHarness(
  cases: readonly HarnessFaultCase[] = QUICK_CHAOS_CASES,
): Promise<ChaosHarnessReport> {
  const reports = await Promise.all(cases.map(runFaultCase));
  return {
    suite: 'chaos',
    cases: reports,
    passed: reports.filter((report) => report.passed).length,
    failed: reports.filter((report) => !report.passed).length,
  };
}

async function runFaultCase(testCase: HarnessFaultCase): Promise<HarnessFaultReport> {
  const startedAt = performance.now();
  try {
    switch (testCase.kind) {
      case 'llm-timeout':
        await expectStructuredFailure(() =>
          new FaultyGateway('llm-timeout').chat({
            model: 'fake-model',
            messages: [{ role: 'user', content: 'timeout' }],
          }),
        );
        break;
      case 'llm-malformed-tool-args': {
        const response = await new FaultyGateway('llm-malformed-tool-args').chat({
          model: 'fake-model',
          messages: [{ role: 'user', content: 'malformed' }],
        });
        if (typeof response.toolCalls[0]?.arguments !== 'string') {
          throw new Error('Fault did not produce malformed tool arguments.');
        }
        break;
      }
      case 'tool-timeout':
        await expectStructuredFailure(() =>
          new FaultyToolExecutor().execute({
            toolCallId: 'tc-chaos',
            name: 'write_file',
            arguments: { path: 'out.txt' },
            nodeName: 'employee',
          }),
        );
        break;
      case 'interaction-delayed-approval':
        await runDelayedApprovalFault(testCase.timeoutMs ?? 25);
        break;
    }
    return {
      id: testCase.id,
      kind: testCase.kind,
      passed: true,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: testCase.id,
      kind: testCase.kind,
      passed: false,
      durationMs: Math.round(performance.now() - startedAt),
      failure: message,
      structuredFailure: { category: 'chaos.case_failed', message },
    };
  }
}

async function expectStructuredFailure(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error('Expected fault case to fail in a controlled way.');
}

class FaultyGateway implements LlmGateway {
  constructor(
    private readonly kind: Extract<HarnessFaultKind, 'llm-timeout' | 'llm-malformed-tool-args'>,
  ) {}

  async chat(_request: LlmRequest): Promise<LlmResponse> {
    if (this.kind === 'llm-timeout') {
      throw new Error('Fault injection: LLM timeout');
    }
    return {
      content: '',
      toolCalls: [
        {
          id: 'faulty-tool-call',
          name: 'write_file',
          arguments: '{"path":' as unknown as Record<string, unknown>,
        },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    const response = await this.chat(request);
    yield { done: true, toolCalls: response.toolCalls, usage: response.usage };
  }

  dispose(): void {}
}

class FaultyToolExecutor implements ToolExecutor {
  readonly calls: ToolCallRequest[] = [];

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    this.calls.push(call);
    throw new Error('Fault injection: tool timeout');
  }

  async listAvailable(): Promise<[]> {
    return [];
  }
}

async function runDelayedApprovalFault(delayMs: number): Promise<void> {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const service = new InteractionService({
    eventBus,
    companyId: 'company-chaos',
    threadId: 'thread-chaos',
    defaultMode: 'human_in_loop',
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
  });
  const request = {
    interactionId: 'ix-chaos',
    threadId: 'thread-chaos',
    companyId: 'company-chaos',
    kind: 'permission_request' as const,
    severity: 'normal' as const,
    title: 'Approve chaos tool',
    prompt: 'Approve chaos tool',
    options: [{ id: 'approve_once', label: 'Approve once', scope: 'once' as const }],
    allowFreeformResponse: false,
    context: {
      type: 'permission_request' as const,
      serverName: 'chaos',
      toolName: 'write_file',
      employeeId: 'emp-chaos',
      policyHash: 'sha256:chaos',
    },
    createdAt: Date.now(),
  };
  await service.request(request);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  await service.resolve({
    interactionId: request.interactionId,
    selectedOptionId: 'approve_once',
    respondedAt: Date.now(),
  });
  const active = await repos.activeInteractions.findByThread('thread-chaos');
  if (active) throw new Error('Delayed approval left an active interaction behind.');
}
