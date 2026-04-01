import type {
  InteractionMode,
  InteractionRequest,
  InteractionResponse,
  InteractionScope,
} from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import {
  interactionModeChanged,
  interactionRequested,
  interactionResolved,
} from '../events/event-factories.js';

export interface ToolPermissionGrantRequest {
  readonly threadId: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId?: string;
}

export interface ToolPermissionGrantMatch {
  readonly scope: InteractionScope;
}

export interface ToolPermissionGrantResolver {
  consumeMatchingGrant(request: ToolPermissionGrantRequest): ToolPermissionGrantMatch | null;
}

export interface PlanReviewDecision {
  readonly selectedOptionId: string;
  readonly freeformResponse?: string;
  readonly respondedAt: number;
  readonly reviewedPayload?: unknown;
}

export interface InteractionPendingStore {
  pending: InteractionRequest | null;
}

export class InteractionService implements ToolPermissionGrantResolver {
  private threadMode: InteractionMode;
  private pending: InteractionRequest | null = null;
  private readonly onceGrants = new Map<string, number>();
  private readonly threadGrants = new Set<string>();
  private readonly sessionGrants = new Set<string>();
  private readonly planReviewPayloads = new Map<string, unknown>();
  private readonly planReviewDecisions = new Map<string, PlanReviewDecision>();

  constructor(
    private readonly deps: {
      readonly eventBus: EventBus;
      readonly companyId: string;
      readonly threadId: string;
      readonly defaultMode?: InteractionMode;
      readonly pendingStore?: InteractionPendingStore;
    },
  ) {
    this.threadMode = deps.defaultMode ?? 'boss_proxy';
  }

  getMode(): InteractionMode {
    return this.threadMode;
  }

  setMode(mode: InteractionMode): void {
    const previousMode = this.threadMode;
    if (previousMode === mode) return;
    this.threadMode = mode;
    this.deps.eventBus.emit(
      interactionModeChanged(this.deps.companyId, this.deps.threadId, previousMode, mode),
    );
  }

  getPending(): InteractionRequest | null {
    return this.pending;
  }

  hydratePending(request: InteractionRequest | null): void {
    this.pending = request;
    this.syncPendingStore();
  }

  request(request: InteractionRequest): InteractionRequest {
    this.pending = request;
    this.syncPendingStore();
    this.deps.eventBus.emit(interactionRequested(this.deps.companyId, this.deps.threadId, request));
    return request;
  }

  resolve(response: InteractionResponse): InteractionRequest | null {
    const pending = this.pending;
    if (!pending || pending.interactionId !== response.interactionId) return null;

    this.pending = null;
    this.syncPendingStore();
    this.applyGrants(pending, response);
    this.applyPlanReviewDecision(pending, response);
    this.deps.eventBus.emit(
      interactionResolved(this.deps.companyId, this.deps.threadId, pending, response),
    );
    return pending;
  }

  consumeMatchingGrant(request: ToolPermissionGrantRequest): ToolPermissionGrantMatch | null {
    const key = this.makeGrantKey(request);

    if (this.threadGrants.has(key)) {
      return { scope: 'thread' };
    }
    if (this.sessionGrants.has(key)) {
      return { scope: 'session' };
    }

    const count = this.onceGrants.get(key) ?? 0;
    if (count > 0) {
      if (count === 1) {
        this.onceGrants.delete(key);
      } else {
        this.onceGrants.set(key, count - 1);
      }
      return { scope: 'once' };
    }

    return null;
  }

  consumePlanReviewDecision(threadId: string): PlanReviewDecision | null {
    const decision = this.planReviewDecisions.get(threadId) ?? null;
    if (decision) {
      this.planReviewDecisions.delete(threadId);
      this.planReviewPayloads.delete(threadId);
    }
    return decision;
  }

  rememberPlanReviewPayload(threadId: string, payload: unknown): void {
    this.planReviewPayloads.set(threadId, payload);
  }

  private applyGrants(request: InteractionRequest, response: InteractionResponse): void {
    if (request.kind !== 'permission_request' || request.context?.type !== 'permission_request') {
      return;
    }

    const option = request.options.find(
      (candidate: InteractionRequest['options'][number]) =>
        candidate.id === response.selectedOptionId,
    );
    const scope = option?.scope;
    if (!scope) return;

    const key = this.makeGrantKey({
      threadId: request.threadId,
      serverName: request.context.serverName,
      toolName: request.context.toolName,
      employeeId: request.context.employeeId ?? undefined,
    });

    if (scope === 'once') {
      this.onceGrants.set(key, (this.onceGrants.get(key) ?? 0) + 1);
      return;
    }
    if (scope === 'thread') {
      this.threadGrants.add(key);
      return;
    }
    this.sessionGrants.add(key);
  }

  private applyPlanReviewDecision(
    request: InteractionRequest,
    response: InteractionResponse,
  ): void {
    if (request.kind !== 'plan_review' || request.context?.type !== 'plan_review') {
      return;
    }
    if (response.selectedOptionId === 'cancel') {
      this.planReviewDecisions.delete(request.threadId);
      return;
    }
    this.planReviewDecisions.set(request.threadId, {
      selectedOptionId: response.selectedOptionId,
      freeformResponse: response.freeformResponse,
      respondedAt: response.respondedAt,
      reviewedPayload: this.planReviewPayloads.get(request.threadId),
    });
  }

  private makeGrantKey(request: ToolPermissionGrantRequest): string {
    return [request.threadId, request.employeeId ?? '*', request.serverName, request.toolName].join(
      '::',
    );
  }

  private syncPendingStore(): void {
    if (this.deps.pendingStore) {
      this.deps.pendingStore.pending = this.pending;
    }
  }
}
