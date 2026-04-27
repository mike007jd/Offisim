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
  interactionRestored,
} from '../events/event-factories.js';
import type { HookRegistry } from '../runtime/hook-registry.js';
import type {
  ActiveInteractionRepository,
  InteractionHistoryRepository,
  InteractionHistoryStatus,
  ThreadRepository,
} from '../runtime/repositories.js';
import { generateId } from '../utils/generate-id.js';

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

export type SkillInstallConfirmOutcome =
  | { kind: 'installed'; skillId: string; wasExisting: boolean }
  | { kind: 'created'; skillId: string; wasExisting: boolean }
  | { kind: 'edited'; skillId: string }
  | { kind: 'cancelled' }
  | { kind: 'staging-expired' }
  | { kind: 'error'; errorKind: string; message: string };

export interface SkillInstallConfirmHandler {
  handle(
    request: InteractionRequest,
    response: InteractionResponse,
  ): Promise<SkillInstallConfirmOutcome>;
}

export interface InteractionResolveResult {
  readonly request: InteractionRequest;
  readonly skillInstallOutcome?: SkillInstallConfirmOutcome;
}

export interface InteractionWaitOptions {
  readonly signal?: AbortSignal;
}

interface InteractionResolutionWaiter {
  readonly interactionId: string;
  readonly resolve: (response: InteractionResponse) => void;
  readonly reject: (error: Error) => void;
}

export class InteractionService implements ToolPermissionGrantResolver {
  private threadMode: InteractionMode;
  private pending: InteractionRequest | null = null;
  private readonly onceGrants = new Map<string, number>();
  private readonly threadGrants = new Set<string>();
  private readonly sessionGrants = new Set<string>();
  private readonly planReviewPayloads = new Map<string, unknown>();
  private readonly planReviewDecisions = new Map<string, PlanReviewDecision>();
  private resolutionWaiter: InteractionResolutionWaiter | null = null;

  constructor(
    private readonly deps: {
      readonly eventBus: EventBus;
      readonly companyId: string;
      readonly threadId: string;
      readonly defaultMode?: InteractionMode;
      readonly pendingStore?: InteractionPendingStore;
      readonly threadRepo?: Pick<ThreadRepository, 'findById' | 'updateInteractionMode'>;
      readonly activeRepo?: ActiveInteractionRepository;
      readonly historyRepo?: InteractionHistoryRepository;
      readonly loadMode?: () => Promise<InteractionMode | null>;
      readonly hookRegistry?: HookRegistry;
      /** Async handler that commits or discards a skill install based on the user's decision. */
      readonly skillInstallConfirmHandler?: SkillInstallConfirmHandler;
    },
  ) {
    this.threadMode = deps.defaultMode ?? 'boss_proxy';
  }

  getMode(): InteractionMode {
    return this.threadMode;
  }

  async restore(): Promise<void> {
    const [restoredMode, activeRow] = await Promise.all([
      this.deps.loadMode?.() ??
        this.deps.threadRepo?.findById(this.deps.threadId).then((t) => t?.interaction_mode ?? null),
      this.deps.activeRepo?.findByThread(this.deps.threadId) ?? null,
    ]);
    if (restoredMode) {
      this.threadMode = restoredMode;
    }
    if (!activeRow) return;

    try {
      const request = JSON.parse(activeRow.request_json) as InteractionRequest;
      this.hydratePending(request);
      this.deps.eventBus.emit(
        interactionRestored(this.deps.companyId, this.deps.threadId, request),
      );
    } catch {
      await this.deps.activeRepo?.deleteByThread(this.deps.threadId);
    }
  }

  setMode(mode: InteractionMode): void {
    const previousMode = this.threadMode;
    if (previousMode === mode) return;
    this.threadMode = mode;
    void this.deps.threadRepo?.updateInteractionMode(this.deps.threadId, mode);
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

  async clearPendingBefore(timestamp: number): Promise<InteractionRequest | null> {
    const pending = this.pending;
    if (!pending || pending.createdAt >= timestamp) return null;
    this.pending = null;
    this.syncPendingStore();
    await this.deps.activeRepo?.deleteByThread(this.deps.threadId);
    await this.persistHistory(pending, null, 'cancelled');
    this.rejectResolutionWaiter(
      pending.interactionId,
      new Error('Interaction request was cancelled before it was resolved.'),
    );
    return pending;
  }

  async request(request: InteractionRequest): Promise<InteractionRequest> {
    const replaced = this.pending;
    if (replaced) {
      await this.persistHistory(replaced, null, 'superseded');
      this.rejectResolutionWaiter(
        replaced.interactionId,
        new Error('Interaction request was superseded before it was resolved.'),
      );
    }
    this.pending = request;
    this.syncPendingStore();
    await this.deps.activeRepo?.upsert({
      thread_id: this.deps.threadId,
      company_id: this.deps.companyId,
      interaction_id: request.interactionId,
      kind: request.kind,
      interaction_mode: this.threadMode,
      request_json: JSON.stringify(request),
      created_at: new Date(request.createdAt).toISOString(),
      updated_at: new Date().toISOString(),
    });
    await this.deps.hookRegistry?.emit('interaction.created', {
      interactionId: request.interactionId,
      threadId: request.threadId,
      companyId: request.companyId,
      kind: request.kind,
      severity: request.severity,
      requestedByNode: request.requestedByNode,
    });
    this.deps.eventBus.emit(interactionRequested(this.deps.companyId, this.deps.threadId, request));
    return request;
  }

  async requestAndWait(
    request: InteractionRequest,
    options: InteractionWaitOptions = {},
  ): Promise<InteractionResponse> {
    if (options.signal?.aborted) {
      throw this.abortError(options.signal);
    }

    const response = this.waitForResolution(request.interactionId, options.signal);
    try {
      await this.request(request);
    } catch (err) {
      this.rejectResolutionWaiter(
        request.interactionId,
        err instanceof Error ? err : new Error(String(err ?? 'Interaction request failed.')),
      );
      await response.catch(() => undefined);
      throw err;
    }
    return response;
  }

  async resolve(response: InteractionResponse): Promise<InteractionResolveResult | null> {
    const pending = this.pending;
    if (!pending || pending.interactionId !== response.interactionId) return null;

    this.pending = null;
    this.syncPendingStore();
    await this.deps.activeRepo?.deleteByThread(this.deps.threadId);
    await this.persistHistory(pending, response, 'resolved');
    this.applyGrants(pending, response);
    this.applyPlanReviewDecision(pending, response);
    const skillInstallOutcome = await this.applySkillInstallConfirm(pending, response);
    await this.deps.hookRegistry?.emit('interaction.resolved', {
      interactionId: pending.interactionId,
      threadId: pending.threadId,
      companyId: pending.companyId,
      kind: pending.kind,
      selectedOptionId: response.selectedOptionId,
    });
    this.deps.eventBus.emit(
      interactionResolved(this.deps.companyId, this.deps.threadId, pending, response),
    );
    this.resolveResolutionWaiter(pending.interactionId, response);
    return {
      request: pending,
      ...(skillInstallOutcome ? { skillInstallOutcome } : {}),
    };
  }

  private waitForResolution(
    interactionId: string,
    signal?: AbortSignal,
  ): Promise<InteractionResponse> {
    this.rejectResolutionWaiter(
      interactionId,
      new Error('Interaction request was replaced before it was resolved.'),
    );

    return new Promise<InteractionResponse>((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        if (this.resolutionWaiter?.interactionId === interactionId) {
          this.resolutionWaiter = null;
        }
      };
      const settleResolve = (response: InteractionResponse) => {
        cleanup();
        resolve(response);
      };
      const settleReject = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        void this.cancelPendingInteraction(interactionId).catch(() => {});
        settleReject(this.abortError(signal));
      };

      if (signal?.aborted) {
        settleReject(this.abortError(signal));
        return;
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      this.resolutionWaiter = {
        interactionId,
        resolve: settleResolve,
        reject: settleReject,
      };
    });
  }

  private resolveResolutionWaiter(interactionId: string, response: InteractionResponse): void {
    if (this.resolutionWaiter?.interactionId === interactionId) {
      this.resolutionWaiter.resolve(response);
    }
  }

  private rejectResolutionWaiter(interactionId: string, error: Error): void {
    if (this.resolutionWaiter?.interactionId === interactionId) {
      this.resolutionWaiter.reject(error);
    }
  }

  private abortError(signal: AbortSignal | undefined): Error {
    return signal?.reason instanceof Error
      ? signal.reason
      : new Error('Interaction request was aborted before it was resolved.');
  }

  private async cancelPendingInteraction(interactionId: string): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.interactionId !== interactionId) return;
    this.pending = null;
    this.syncPendingStore();
    await this.deps.activeRepo?.deleteByThread(this.deps.threadId);
    await this.persistHistory(pending, null, 'cancelled');
  }

  private async applySkillInstallConfirm(
    request: InteractionRequest,
    response: InteractionResponse,
  ): Promise<SkillInstallConfirmOutcome | null> {
    if (
      request.kind !== 'skill_install_confirm' ||
      request.context?.type !== 'skill_install_confirm'
    ) {
      return null;
    }
    const handler = this.deps.skillInstallConfirmHandler;
    if (!handler) return null;
    try {
      return await handler.handle(request, response);
    } catch {
      // Errors flow back to the chat via whatever the handler emits; the
      // interaction itself is considered resolved even on install failure.
      return {
        kind: 'error',
        errorKind: 'skill-install-confirm-failed',
        message: 'Skill confirmation failed before the change could be applied.',
      };
    }
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

  private async persistHistory(
    request: InteractionRequest,
    response: InteractionResponse | null,
    status: InteractionHistoryStatus,
  ): Promise<void> {
    await this.deps.historyRepo?.create({
      history_id: generateId('ixh'),
      interaction_id: request.interactionId,
      thread_id: request.threadId,
      company_id: request.companyId,
      kind: request.kind,
      interaction_mode: this.threadMode,
      status,
      selected_option_id: response?.selectedOptionId ?? null,
      freeform_response: response?.freeformResponse ?? null,
      request_json: JSON.stringify(request),
      response_json: response ? JSON.stringify(response) : null,
      created_at: new Date(request.createdAt).toISOString(),
      resolved_at: new Date(response?.respondedAt ?? Date.now()).toISOString(),
    });
  }
}
