import type { InteractionRequest } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { InteractionActiveRow, InteractionHistoryRow } from '../../runtime/repositories.js';
import { InteractionService } from '../../services/interaction-service.js';

function makePermissionRequest(overrides?: Partial<InteractionRequest>): InteractionRequest {
  return {
    interactionId: overrides?.interactionId ?? 'ix-1',
    threadId: overrides?.threadId ?? 'thread-1',
    companyId: overrides?.companyId ?? 'company-1',
    kind: 'permission_request',
    severity: overrides?.severity ?? 'normal',
    title: overrides?.title ?? 'Approve tool access',
    prompt: overrides?.prompt ?? 'Allow fs/read_file?',
    options: overrides?.options ?? [
      { id: 'approve_once', label: 'Approve once', scope: 'once' },
      { id: 'approve_thread', label: 'Approve thread', scope: 'thread' },
      { id: 'reject', label: 'Reject' },
    ],
    recommendation: overrides?.recommendation,
    allowFreeformResponse: overrides?.allowFreeformResponse ?? true,
    requestedByNode: overrides?.requestedByNode,
    employeeId: overrides?.employeeId ?? 'emp-1',
    taskRunId: overrides?.taskRunId ?? 'tr-1',
    context: overrides?.context ?? {
      type: 'permission_request',
      serverName: 'fs',
      toolName: 'read_file',
      employeeId: 'emp-1',
    },
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

function makePlanReviewRequest(overrides?: Partial<InteractionRequest>): InteractionRequest {
  return {
    interactionId: overrides?.interactionId ?? 'ix-plan-1',
    threadId: overrides?.threadId ?? 'thread-1',
    companyId: overrides?.companyId ?? 'company-1',
    kind: 'plan_review',
    severity: overrides?.severity ?? 'normal',
    title: overrides?.title ?? 'Review plan before execution',
    prompt: overrides?.prompt ?? 'Review the generated plan before execution.',
    options: overrides?.options ?? [
      { id: 'start_execution', label: 'Start execution', recommended: true },
      { id: 'revise_plan', label: 'Revise plan' },
      { id: 'cancel', label: 'Cancel' },
    ],
    recommendation: overrides?.recommendation,
    allowFreeformResponse: overrides?.allowFreeformResponse ?? true,
    requestedByNode: overrides?.requestedByNode ?? 'pm_planner',
    employeeId: overrides?.employeeId ?? null,
    taskRunId: overrides?.taskRunId ?? null,
    context: overrides?.context ?? {
      type: 'plan_review',
      planId: null,
    },
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

function createDurableInteractionStore() {
  let active: InteractionActiveRow | null = null;
  const history: InteractionHistoryRow[] = [];

  return {
    activeRepo: {
      async upsert(row: InteractionActiveRow): Promise<InteractionActiveRow> {
        active = { ...row };
        return active;
      },
      async findByThread(threadId: string): Promise<InteractionActiveRow | null> {
        return active?.thread_id === threadId ? { ...active } : null;
      },
      async deleteByThread(threadId: string): Promise<void> {
        if (active?.thread_id === threadId) {
          active = null;
        }
      },
    },
    historyRepo: {
      async create(row: InteractionHistoryRow): Promise<InteractionHistoryRow> {
        history.push({ ...row });
        return row;
      },
      async listByThread(threadId: string): Promise<InteractionHistoryRow[]> {
        return history.filter((row) => row.thread_id === threadId).map((row) => ({ ...row }));
      },
    },
    readActive(): InteractionActiveRow | null {
      return active ? { ...active } : null;
    },
    readHistory(): InteractionHistoryRow[] {
      return history.map((row) => ({ ...row }));
    },
  };
}

describe('InteractionService', () => {
  it('stores pending requests and emits interaction.requested', async () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    const seen: string[] = [];
    bus.on('interaction.requested', (event) => seen.push(event.type));

    const request = makePermissionRequest();
    await service.request(request);

    expect(service.getPending()).toEqual(request);
    expect(seen).toEqual(['interaction.requested']);
  });

  it('hydrates pending requests without re-emitting interaction.requested', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    const seen: string[] = [];
    bus.on('interaction.requested', (event) => seen.push(event.type));

    const request = makePermissionRequest();
    service.hydratePending(request);

    expect(service.getPending()).toEqual(request);
    expect(seen).toEqual([]);
  });

  it('keeps the pending store synchronized on request, hydrate, and resolve', async () => {
    const bus = new InMemoryEventBus();
    const pendingStore = { pending: null as InteractionRequest | null };
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
      pendingStore,
    });

    const request = makePermissionRequest();
    await service.request(request);
    expect(pendingStore.pending).toEqual(request);

    const hydrated = makePlanReviewRequest();
    service.hydratePending(hydrated);
    expect(pendingStore.pending).toEqual(hydrated);

    await service.resolve({
      interactionId: hydrated.interactionId,
      selectedOptionId: 'cancel',
      respondedAt: Date.now(),
    });
    expect(pendingStore.pending).toBeNull();
  });

  it('changes mode and emits interaction.mode.changed', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    const modes: string[] = [];
    bus.on('interaction.mode.changed', (event) => {
      modes.push(`${event.payload.previousMode}->${event.payload.nextMode}`);
    });

    service.setMode('human_in_loop');

    expect(service.getMode()).toBe('human_in_loop');
    expect(modes).toEqual(['boss_proxy->human_in_loop']);
  });

  it('grants once-scoped approvals exactly once', async () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    await service.request(makePermissionRequest());
    await service.resolve({
      interactionId: 'ix-1',
      selectedOptionId: 'approve_once',
      respondedAt: Date.now(),
    });

    expect(
      service.consumeMatchingGrant({
        threadId: 'thread-1',
        serverName: 'fs',
        toolName: 'read_file',
        employeeId: 'emp-1',
      }),
    ).toEqual({ scope: 'once' });
    expect(
      service.consumeMatchingGrant({
        threadId: 'thread-1',
        serverName: 'fs',
        toolName: 'read_file',
        employeeId: 'emp-1',
      }),
    ).toBeNull();
  });

  it('grants thread-scoped approvals repeatedly', async () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    await service.request(makePermissionRequest());
    await service.resolve({
      interactionId: 'ix-1',
      selectedOptionId: 'approve_thread',
      respondedAt: Date.now(),
    });

    expect(
      service.consumeMatchingGrant({
        threadId: 'thread-1',
        serverName: 'fs',
        toolName: 'read_file',
        employeeId: 'emp-1',
      }),
    ).toEqual({ scope: 'thread' });
    expect(
      service.consumeMatchingGrant({
        threadId: 'thread-1',
        serverName: 'fs',
        toolName: 'read_file',
        employeeId: 'emp-1',
      }),
    ).toEqual({ scope: 'thread' });
  });

  it('stores start-execution plan review decisions once per thread', async () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    await service.request(makePlanReviewRequest());
    await service.resolve({
      interactionId: 'ix-plan-1',
      selectedOptionId: 'start_execution',
      respondedAt: Date.now(),
    });

    expect(service.consumePlanReviewDecision('thread-1')).toMatchObject({
      selectedOptionId: 'start_execution',
    });
    expect(service.consumePlanReviewDecision('thread-1')).toBeNull();
  });

  it('stores revision notes for plan review decisions', async () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    await service.request(makePlanReviewRequest());
    await service.resolve({
      interactionId: 'ix-plan-1',
      selectedOptionId: 'revise_plan',
      freeformResponse: 'Break implementation and testing into separate steps.',
      respondedAt: Date.now(),
    });

    expect(service.consumePlanReviewDecision('thread-1')).toMatchObject({
      selectedOptionId: 'revise_plan',
      freeformResponse: 'Break implementation and testing into separate steps.',
    });
  });

  it('clears only pending requests created before the compact boundary', async () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    const oldRequest = makePermissionRequest({
      createdAt: Date.UTC(2026, 3, 2, 0, 0, 0),
    });
    await service.request(oldRequest);

    await expect(service.clearPendingBefore(Date.UTC(2026, 3, 2, 0, 1, 0))).resolves.toEqual(
      oldRequest,
    );
    expect(service.getPending()).toBeNull();

    const freshRequest = makePermissionRequest({
      interactionId: 'ix-2',
      createdAt: Date.UTC(2026, 3, 2, 0, 2, 0),
    });
    await service.request(freshRequest);

    await expect(service.clearPendingBefore(Date.UTC(2026, 3, 2, 0, 1, 0))).resolves.toBeNull();
    expect(service.getPending()).toEqual(freshRequest);
  });

  it('persists the active pending interaction when a request is created', async () => {
    const bus = new InMemoryEventBus();
    const store = createDurableInteractionStore();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
      activeRepo: store.activeRepo,
      historyRepo: store.historyRepo,
    });

    const request = makePermissionRequest({ createdAt: Date.UTC(2026, 3, 2, 0, 0, 0) });
    await service.request(request);

    expect(store.readActive()).toMatchObject({
      thread_id: 'thread-1',
      interaction_id: request.interactionId,
      kind: 'permission_request',
      interaction_mode: 'boss_proxy',
    });
    expect(store.readHistory()).toHaveLength(0);
  });

  it('moves a resolved interaction from active storage into history', async () => {
    const bus = new InMemoryEventBus();
    const store = createDurableInteractionStore();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
      activeRepo: store.activeRepo,
      historyRepo: store.historyRepo,
    });

    const request = makePermissionRequest({ createdAt: Date.UTC(2026, 3, 2, 0, 0, 0) });
    await service.request(request);
    await service.resolve({
      interactionId: request.interactionId,
      selectedOptionId: 'approve_once',
      respondedAt: Date.UTC(2026, 3, 2, 0, 1, 0),
    });

    expect(store.readActive()).toBeNull();
    expect(store.readHistory()).toEqual([
      expect.objectContaining({
        thread_id: 'thread-1',
        interaction_id: request.interactionId,
        kind: 'permission_request',
        status: 'resolved',
        selected_option_id: 'approve_once',
      }),
    ]);
  });

  it('writes superseded history when a new pending interaction replaces an older one', async () => {
    const bus = new InMemoryEventBus();
    const store = createDurableInteractionStore();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
      activeRepo: store.activeRepo,
      historyRepo: store.historyRepo,
    });

    const first = makePermissionRequest({
      interactionId: 'ix-old',
      createdAt: Date.UTC(2026, 3, 2, 0, 0, 0),
    });
    const second = makePlanReviewRequest({
      interactionId: 'ix-new',
      createdAt: Date.UTC(2026, 3, 2, 0, 1, 0),
    });

    await service.request(first);
    await service.request(second);

    expect(store.readActive()).toMatchObject({
      interaction_id: 'ix-new',
      kind: 'plan_review',
    });
    expect(store.readHistory()).toEqual([
      expect.objectContaining({
        interaction_id: 'ix-old',
        status: 'superseded',
      }),
    ]);
  });

  it('restores the thread mode and pending interaction from durable storage', async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.on('interaction.restored', (event) => seen.push(event.type));
    const request = makePlanReviewRequest({
      interactionId: 'ix-plan-restore',
      createdAt: Date.UTC(2026, 3, 2, 0, 2, 0),
    });
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
      activeRepo: {
        async upsert(row) {
          return row;
        },
        async findByThread(threadId) {
          return {
            thread_id: threadId,
            company_id: 'company-1',
            interaction_id: request.interactionId,
            kind: request.kind,
            interaction_mode: 'human_in_loop',
            request_json: JSON.stringify(request),
            created_at: new Date(request.createdAt).toISOString(),
            updated_at: new Date(request.createdAt).toISOString(),
          };
        },
        async deleteByThread() {},
      },
      historyRepo: {
        async create(row) {
          return row;
        },
        async listByThread() {
          return [];
        },
      },
      loadMode: async () => 'human_in_loop',
    });

    await service.restore();

    expect(service.getMode()).toBe('human_in_loop');
    expect(service.getPending()).toEqual(request);
    expect(seen).toEqual(['interaction.restored']);
  });
});
