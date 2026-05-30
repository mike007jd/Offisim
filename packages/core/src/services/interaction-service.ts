import type {
  InteractionMode,
  InteractionRequest,
  InteractionResponse,
  InteractionScope,
  SkillInstallOutcomeKind,
} from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import {
  interactionModeChanged,
  interactionRequested,
  interactionResolved,
  interactionRestored,
  skillInstallOutcome,
} from '../events/event-factories.js';
import type { RunScope } from '../graph/state.js';
import type { HookRegistry } from '../runtime/hook-registry.js';
import type {
  ActiveInteractionRepository,
  InteractionHistoryRepository,
  InteractionHistoryStatus,
  ThreadRepository,
  ToolPermissionApprovalRepository,
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

export type SkillInstallConfirmOutcome = SkillInstallOutcomeKind;

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
  readonly payload?: unknown;
  readonly runScope?: RunScope | null;
}

export interface InteractionRequestOptions {
  readonly payload?: unknown;
  readonly runScope?: RunScope | null;
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
  private readonly activePayloads = new Map<string, unknown>();
  /**
   * RunScope captured at request time so resolve() can re-emit it on
   * `interaction.resolved`. Lets `useInteractionSync` dispatch the follow-up
   * message back onto the originating chat thread without user code threading
   * scope through the response.
   */
  private readonly activeRunScopes = new Map<string, RunScope>();
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
      readonly permissionApprovals: ToolPermissionApprovalRepository;
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
      this.hydratePayload(request, activeRow.payload_json);
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
    this.clearPayload(pending);
    this.activeRunScopes.delete(pending.interactionId);
    this.rejectResolutionWaiter(
      pending.interactionId,
      new Error('Interaction request was cancelled before it was resolved.'),
    );
    return pending;
  }

  async request(
    request: InteractionRequest,
    options: InteractionRequestOptions = {},
  ): Promise<InteractionRequest> {
    const replaced = this.pending;
    if (replaced) {
      await this.persistHistory(replaced, null, 'superseded');
      this.clearPayload(replaced);
      this.activeRunScopes.delete(replaced.interactionId);
      this.rejectResolutionWaiter(
        replaced.interactionId,
        new Error('Interaction request was superseded before it was resolved.'),
      );
    }
    this.pending = request;
    this.setPayload(request, options.payload);
    this.syncPendingStore();
    await this.deps.activeRepo?.upsert({
      thread_id: this.deps.threadId,
      company_id: this.deps.companyId,
      interaction_id: request.interactionId,
      kind: request.kind,
      interaction_mode: this.threadMode,
      request_json: JSON.stringify(request),
      payload_json: options.payload === undefined ? null : JSON.stringify(options.payload),
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
    if (options.runScope) {
      this.activeRunScopes.set(request.interactionId, options.runScope);
    }
    this.deps.eventBus.emit(
      interactionRequested(
        this.deps.companyId,
        this.deps.threadId,
        request,
        options.runScope ?? null,
      ),
    );
    return request;
  }

  /**
   * Contract: one pending interaction per thread/service. The service tracks a
   * single-slot {@link resolutionWaiter}, mirroring the single `pending` request
   * model — a thread can only have one outstanding interaction at a time. A new
   * `requestAndWait` call supersedes any prior pending wait and rejects it with
   * "replaced before it was resolved", so concurrent callers do not coexist;
   * the later caller wins and the earlier promise rejects. Callers must not rely
   * on overlapping waits resolving independently.
   */
  async requestAndWait(
    request: InteractionRequest,
    options: InteractionWaitOptions = {},
  ): Promise<InteractionResponse> {
    if (options.signal?.aborted) {
      throw this.abortError(options.signal);
    }

    const response = this.waitForResolution(request.interactionId, options.signal);
    try {
      await this.request(request, { payload: options.payload, runScope: options.runScope ?? null });
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
    const payload = this.getPayload(pending);
    this.syncPendingStore();
    await this.deps.activeRepo?.deleteByThread(this.deps.threadId);
    await this.persistHistory(pending, response, 'resolved', payload);
    await this.applyGrants(pending, response);
    this.applyPlanReviewDecision(pending, response, payload);
    this.clearPayload(pending);
    const outcome = await this.applySkillInstallConfirm(pending, response);
    await this.deps.hookRegistry?.emit('interaction.resolved', {
      interactionId: pending.interactionId,
      threadId: pending.threadId,
      companyId: pending.companyId,
      kind: pending.kind,
      selectedOptionId: response.selectedOptionId,
    });
    const runScope = this.activeRunScopes.get(pending.interactionId) ?? null;
    this.activeRunScopes.delete(pending.interactionId);
    this.deps.eventBus.emit(
      interactionResolved(this.deps.companyId, this.deps.threadId, pending, response, runScope),
    );
    if (outcome) {
      const employeeId = this.resolveSkillInstallEmployeeId(pending);
      this.deps.eventBus.emit(
        skillInstallOutcome(this.deps.companyId, this.deps.threadId, {
          ...outcome,
          interactionId: pending.interactionId,
          employeeId,
        }),
      );
    }
    this.resolveResolutionWaiter(pending.interactionId, response);
    return {
      request: pending,
      ...(outcome ? { skillInstallOutcome: outcome } : {}),
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
    const payload = this.getPayload(pending);
    this.syncPendingStore();
    await this.deps.activeRepo?.deleteByThread(this.deps.threadId);
    await this.persistHistory(pending, null, 'cancelled', payload);
    this.clearPayload(pending);
    this.activeRunScopes.delete(interactionId);
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

  private resolveSkillInstallEmployeeId(request: InteractionRequest): string | null {
    if (
      request.kind === 'skill_install_confirm' &&
      request.context?.type === 'skill_install_confirm'
    ) {
      return request.context.resolvedEmployeeId ?? request.employeeId ?? null;
    }
    return request.employeeId ?? null;
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
    }
    return decision;
  }

  private async applyGrants(
    request: InteractionRequest,
    response: InteractionResponse,
  ): Promise<void> {
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
      await this.persistPermissionApproval(request, scope);
      this.onceGrants.set(key, (this.onceGrants.get(key) ?? 0) + 1);
      return;
    }
    if (scope === 'thread') {
      await this.persistPermissionApproval(request, scope);
      this.threadGrants.add(key);
      return;
    }
    this.sessionGrants.add(key);
  }

  private applyPlanReviewDecision(
    request: InteractionRequest,
    response: InteractionResponse,
    payload: unknown,
  ): void {
    if (request.kind !== 'plan_review' || request.context?.type !== 'plan_review') {
      return;
    }
    if (response.selectedOptionId === 'cancel') {
      this.planReviewDecisions.set(request.threadId, {
        selectedOptionId: 'cancel',
        freeformResponse: response.freeformResponse,
        respondedAt: response.respondedAt,
      });
      return;
    }
    this.planReviewDecisions.set(request.threadId, {
      selectedOptionId: response.selectedOptionId,
      freeformResponse: response.freeformResponse,
      respondedAt: response.respondedAt,
      reviewedPayload: payload,
    });
  }

  private async persistPermissionApproval(
    request: InteractionRequest,
    scope: 'once' | 'thread',
  ): Promise<void> {
    if (request.kind !== 'permission_request' || request.context?.type !== 'permission_request') {
      return;
    }
    const createdAt = new Date().toISOString();
    await this.deps.permissionApprovals.create({
      approval_id: generateId('tpa'),
      thread_id: request.threadId,
      company_id: request.companyId,
      employee_id: request.context.employeeId ?? null,
      server_name: request.context.serverName,
      tool_name: request.context.toolName,
      scope,
      approved_by: `interaction:${scope}`,
      policy_hash: request.context.policyHash ?? 'default',
      consumed_at: scope === 'once' ? createdAt : null,
      created_at: createdAt,
      expires_at: null,
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
    payload: unknown = this.getPayload(request),
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
      payload_json: payload === undefined ? null : JSON.stringify(payload),
      created_at: new Date(request.createdAt).toISOString(),
      resolved_at: new Date(response?.respondedAt ?? Date.now()).toISOString(),
    });
  }

  private setPayload(request: InteractionRequest, payload: unknown): void {
    if (payload === undefined) return;
    this.activePayloads.set(request.interactionId, payload);
  }

  private hydratePayload(request: InteractionRequest, payloadJson: string | null): void {
    if (!payloadJson) return;
    try {
      this.setPayload(request, JSON.parse(payloadJson));
    } catch {
      this.clearPayload(request);
    }
  }

  private getPayload(request: InteractionRequest): unknown {
    if (this.activePayloads.has(request.interactionId)) {
      return this.activePayloads.get(request.interactionId);
    }
    return undefined;
  }

  private clearPayload(request: InteractionRequest): void {
    this.activePayloads.delete(request.interactionId);
  }
}
