import type { InteractionRequest } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
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

describe('InteractionService', () => {
  it('stores pending requests and emits interaction.requested', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    const seen: string[] = [];
    bus.on('interaction.requested', (event) => seen.push(event.type));

    const request = makePermissionRequest();
    service.request(request);

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

  it('keeps the pending store synchronized on request, hydrate, and resolve', () => {
    const bus = new InMemoryEventBus();
    const pendingStore = { pending: null as InteractionRequest | null };
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
      pendingStore,
    });

    const request = makePermissionRequest();
    service.request(request);
    expect(pendingStore.pending).toEqual(request);

    const hydrated = makePlanReviewRequest();
    service.hydratePending(hydrated);
    expect(pendingStore.pending).toEqual(hydrated);

    service.resolve({
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

  it('grants once-scoped approvals exactly once', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    service.request(makePermissionRequest());
    service.resolve({
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

  it('grants thread-scoped approvals repeatedly', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    service.request(makePermissionRequest());
    service.resolve({
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

  it('stores start-execution plan review decisions once per thread', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    service.request(makePlanReviewRequest());
    service.resolve({
      interactionId: 'ix-plan-1',
      selectedOptionId: 'start_execution',
      respondedAt: Date.now(),
    });

    expect(service.consumePlanReviewDecision('thread-1')).toMatchObject({
      selectedOptionId: 'start_execution',
    });
    expect(service.consumePlanReviewDecision('thread-1')).toBeNull();
  });

  it('stores revision notes for plan review decisions', () => {
    const bus = new InMemoryEventBus();
    const service = new InteractionService({
      eventBus: bus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });

    service.request(makePlanReviewRequest());
    service.resolve({
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
});
