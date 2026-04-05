import type {
  LlmUsageRecordedPayload,
  RuntimeEvent,
  SessionCostBreakdown,
} from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { costSessionUpdated } from '../events/event-factories.js';
import {
  ModelCostRatePricingSource,
  type PricingConfidence,
  PricingSourceRegistry,
} from './pricing-source-registry.js';
import type { RuntimeRepositories } from './repositories.js';

interface SessionCostTrackerDeps {
  eventBus: EventBus;
  repos: RuntimeRepositories;
  companyId: string;
  threadId: string;
  sessionId?: string;
}

interface MutableBreakdown {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  callCount: number;
  pricedCallCount: number;
  unpricedCallCount: number;
  pricingConfidence: PricingConfidence;
}

export interface SessionCostState {
  sessionId: string;
  threadId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  totalCalls: number;
  pricedCallCount: number;
  unpricedCallCount: number;
  costConfidence: PricingConfidence;
  byModel: SessionCostBreakdown[];
  byNode: SessionCostBreakdown[];
  byEmployee: SessionCostBreakdown[];
  lastLlmCallId: string | null;
}

export class SessionCostTracker {
  private readonly eventBus: EventBus;
  private readonly repos: RuntimeRepositories;
  private readonly companyId: string;
  private readonly threadId: string;
  private readonly sessionId: string;
  private readonly byModel = new Map<string, MutableBreakdown>();
  private readonly byNode = new Map<string, MutableBreakdown>();
  private readonly byEmployee = new Map<string, MutableBreakdown>();
  private readonly taskRunEmployeeCache = new Map<string, string | null>();
  private readonly pricing: PricingSourceRegistry;
  private unsubscribe: (() => void) | null = null;
  private state: SessionCostState;

  private constructor(deps: SessionCostTrackerDeps) {
    this.eventBus = deps.eventBus;
    this.repos = deps.repos;
    this.companyId = deps.companyId;
    this.threadId = deps.threadId;
    this.sessionId = deps.sessionId ?? `session:${deps.threadId}`;
    this.pricing = new PricingSourceRegistry([
      new ModelCostRatePricingSource(this.repos.costRates, 'configured_rates', 'exact'),
    ]);
    this.state = {
      sessionId: this.sessionId,
      threadId: this.threadId,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalLatencyMs: 0,
      totalCalls: 0,
      pricedCallCount: 0,
      unpricedCallCount: 0,
      costConfidence: 'exact',
      byModel: [],
      byNode: [],
      byEmployee: [],
      lastLlmCallId: null,
    };
  }

  static async create(deps: SessionCostTrackerDeps): Promise<SessionCostTracker> {
    const tracker = new SessionCostTracker(deps);
    await tracker.restore();
    tracker.subscribe();
    return tracker;
  }

  getState(): SessionCostState {
    return {
      ...this.state,
      byModel: [...this.state.byModel],
      byNode: [...this.state.byNode],
      byEmployee: [...this.state.byEmployee],
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private subscribe(): void {
    this.unsubscribe = this.eventBus.on('llm.usage.recorded', (event) => {
      void this.onUsageRecorded(event as RuntimeEvent<LlmUsageRecordedPayload>).catch((err) => {
        console.error('SessionCostTracker.onUsageRecorded failed', err);
      });
    });
  }

  private async restore(): Promise<void> {
    const calls = await this.repos.llmCalls.findByThread(this.threadId);
    for (const call of calls) {
      if (call.error_code) continue;
      await this.applyUsage({
        llmCallId: call.llm_call_id,
        threadId: this.threadId,
        taskRunId: call.task_run_id,
        provider: call.provider,
        model: call.model,
        nodeName: call.node_name,
        inputTokens: call.input_tokens,
        outputTokens: call.output_tokens,
        latencyMs: call.latency_ms ?? 0,
      });
    }
    this.syncState();
  }

  private async onUsageRecorded(event: RuntimeEvent<LlmUsageRecordedPayload>): Promise<void> {
    if (event.threadId !== this.threadId) return;
    await this.applyUsage(event.payload);
    this.syncState();
    this.eventBus.emit(
      costSessionUpdated(this.companyId, this.threadId, {
        sessionId: this.sessionId,
        threadId: this.threadId,
        totalCostUsd: this.state.totalCostUsd,
        totalInputTokens: this.state.totalInputTokens,
        totalOutputTokens: this.state.totalOutputTokens,
        totalLatencyMs: this.state.totalLatencyMs,
        totalCalls: this.state.totalCalls,
        pricedCallCount: this.state.pricedCallCount,
        unpricedCallCount: this.state.unpricedCallCount,
        costConfidence: this.state.costConfidence,
        byModel: this.state.byModel,
        byNode: this.state.byNode,
        byEmployee: this.state.byEmployee,
        lastLlmCallId: this.state.lastLlmCallId ?? event.payload.llmCallId,
      }),
    );
  }

  private async applyUsage(payload: LlmUsageRecordedPayload): Promise<void> {
    const estimate = await this.pricing.estimateUsage({
      provider: payload.provider,
      model: payload.model,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
    });

    this.state.totalCalls += 1;
    this.state.totalCostUsd += estimate.totalCost;
    this.state.totalInputTokens += payload.inputTokens;
    this.state.totalOutputTokens += payload.outputTokens;
    this.state.totalLatencyMs += payload.latencyMs;
    this.state.lastLlmCallId = payload.llmCallId;
    if (estimate.rateFound) {
      this.state.pricedCallCount += 1;
    } else {
      this.state.unpricedCallCount += 1;
    }
    this.state.costConfidence = mergeConfidence(this.state.costConfidence, estimate.confidence);

    const modelKey = `${payload.provider}/${payload.model}`;
    this.bump(
      this.byModel,
      modelKey,
      estimate.totalCost,
      estimate.rateFound,
      estimate.confidence,
      payload.inputTokens,
      payload.outputTokens,
      payload.latencyMs,
    );
    this.bump(
      this.byNode,
      payload.nodeName,
      estimate.totalCost,
      estimate.rateFound,
      estimate.confidence,
      payload.inputTokens,
      payload.outputTokens,
      payload.latencyMs,
    );

    const employeeId = await this.resolveEmployeeId(payload.taskRunId);
    if (employeeId) {
      this.bump(
        this.byEmployee,
        employeeId,
        estimate.totalCost,
        estimate.rateFound,
        estimate.confidence,
        payload.inputTokens,
        payload.outputTokens,
        payload.latencyMs,
      );
    }
  }

  private async resolveEmployeeId(taskRunId: string | null): Promise<string | null> {
    if (!taskRunId) return null;
    if (this.taskRunEmployeeCache.has(taskRunId)) {
      return this.taskRunEmployeeCache.get(taskRunId) ?? null;
    }
    const taskRun = await this.repos.taskRuns.findById(taskRunId);
    const employeeId = taskRun?.employee_id ?? null;
    this.taskRunEmployeeCache.set(taskRunId, employeeId);
    return employeeId;
  }

  private bump(
    map: Map<string, MutableBreakdown>,
    key: string,
    costUsd: number,
    rateFound: boolean,
    pricingConfidence: PricingConfidence,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
  ): void {
    const current = map.get(key) ?? createEmptyBreakdown();
    current.costUsd += costUsd;
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.latencyMs += latencyMs;
    current.callCount += 1;
    if (rateFound) {
      current.pricedCallCount += 1;
    } else {
      current.unpricedCallCount += 1;
    }
    current.pricingConfidence = mergeConfidence(current.pricingConfidence, pricingConfidence);
    map.set(key, current);
  }

  private syncState(): void {
    this.state = {
      ...this.state,
      byModel: this.toBreakdowns(this.byModel),
      byNode: this.toBreakdowns(this.byNode),
      byEmployee: this.toBreakdowns(this.byEmployee),
    };
  }

  private toBreakdowns(map: Map<string, MutableBreakdown>): SessionCostBreakdown[] {
    return [...map.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.costUsd - a.costUsd || b.callCount - a.callCount);
  }
}

function createEmptyBreakdown(): MutableBreakdown {
  return {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    callCount: 0,
    pricedCallCount: 0,
    unpricedCallCount: 0,
    pricingConfidence: 'exact',
  };
}

const CONFIDENCE_ORDER: Record<PricingConfidence, number> = {
  exact: 0,
  catalog: 1,
  fallback: 2,
  unknown: 3,
};

function mergeConfidence(current: PricingConfidence, next: PricingConfidence): PricingConfidence {
  return CONFIDENCE_ORDER[next] > CONFIDENCE_ORDER[current] ? next : current;
}
