import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrefabDefinition, RuntimeEvent, SemanticCategory } from '@aics/shared-types';
import { getInitialState } from '../prefab/state-machines.js';
import type { PrefabRuntime } from '../prefab/prefab-runtime.js';
import { PrefabEventRouter } from '../prefab/prefab-event-router.js';

// ── Mock PrefabRuntime factory ──────────────────────────────────

function createMockRuntime(instanceId: string, category: SemanticCategory): PrefabRuntime {
  return {
    instanceId,
    definition: {
      category,
      prefabId: 'test',
      name: 'Test',
      description: '',
      gridSize: [1, 1],
      composite: false,
      bindingSlots: [],
    } as PrefabDefinition,
    container: {} as any,
    currentState: getInitialState(category) ?? 'static',
    eventUnsubscribers: [],
    setState: vi.fn(() => true),
    bindToResource: vi.fn(),
    unbindResource: vi.fn(),
    getBinding: vi.fn(),
    getAllBindings: vi.fn(() => []),
    destroy: vi.fn(),
  } as unknown as PrefabRuntime;
}

// ── Helper: build RuntimeEvent ──────────────────────────────────

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  overrides?: Partial<RuntimeEvent>,
): RuntimeEvent {
  return {
    type,
    entityId: 'e-1',
    entityType: 'employee',
    companyId: 'company-1',
    timestamp: Date.now(),
    payload,
    ...overrides,
  } as RuntimeEvent;
}

// ── Tests ───────────────────────────────────────────────────────

describe('PrefabEventRouter', () => {
  let router: PrefabEventRouter;

  beforeEach(() => {
    router = new PrefabEventRouter();
  });

  // 1. Routes employee.state.changed to workspace prefab via employeeId binding
  it('routes employee.state.changed to workspace prefab via employeeId binding', () => {
    const rt = createMockRuntime('desk-1', 'workspace');
    router.registerRuntime(rt);
    router.registerBinding('desk-1', 'emp-alice');

    const event = makeEvent('employee.state.changed', {
      employeeId: 'emp-alice',
      prev: 'idle',
      next: 'executing',
    });
    router.routeEvent(event);

    expect(rt.setState).toHaveBeenCalledWith('working');
  });

  // 2. Routes llm.call.started to compute prefab via provider→rack lookup
  it('routes llm.call.started to compute prefab via provider→rack lookup', () => {
    const rt = createMockRuntime('rack-1', 'compute');
    router.registerRuntime(rt);
    router.registerBinding('rack-1', 'rack-openai');

    // First, build the provider→rack index via a rack.bound event
    const bindEvent = makeEvent('rack.bound', {
      rackId: 'rack-openai',
      providerType: 'openai',
      label: 'OpenAI',
    });
    router.routeEvent(bindEvent);

    // Now route an LLM call event
    const llmEvent = makeEvent('llm.call.started', {
      llmCallId: 'call-1',
      nodeName: 'generate',
      provider: 'openai',
      model: 'gpt-4o',
      threadId: 'thread-1',
    });
    router.routeEvent(llmEvent);

    // setState should have been called: once for rack.bound→idle, once for llm.call.started→processing
    expect(rt.setState).toHaveBeenCalledWith('idle');
    expect(rt.setState).toHaveBeenCalledWith('processing');
  });

  // 3. Routes meeting.state.changed to collaboration prefab via meetingId binding
  it('routes meeting.state.changed to collaboration prefab via meetingId binding', () => {
    const rt = createMockRuntime('mtg-room-1', 'collaboration');
    router.registerRuntime(rt);
    router.registerBinding('mtg-room-1', 'meeting-xyz');

    const event = makeEvent('meeting.state.changed', {
      meetingId: 'meeting-xyz',
      prev: 'scheduled',
      next: 'gathering',
      participantIds: ['emp-1', 'emp-2'],
    });
    router.routeEvent(event);

    expect(rt.setState).toHaveBeenCalledWith('gathering');
  });

  // 4. Routes knowledge.index.started to knowledge prefab via knowledgeBaseRef binding
  it('routes knowledge.index.started to knowledge prefab via knowledgeBaseRef binding', () => {
    const rt = createMockRuntime('kb-shelf-1', 'knowledge');
    router.registerRuntime(rt);
    router.registerBinding('kb-shelf-1', 'kb-docs');

    const event = makeEvent('knowledge.index.started', {
      knowledgeBaseRef: 'kb-docs',
      documentCount: 42,
    });
    router.routeEvent(event);

    expect(rt.setState).toHaveBeenCalledWith('indexing');
  });

  // 5. Routes handoff.initiated to infrastructure prefab via employee ID binding
  it('routes handoff.initiated to infrastructure prefab via employee ID binding', () => {
    const rt = createMockRuntime('pipe-1', 'infrastructure');
    router.registerRuntime(rt);
    router.registerBinding('pipe-1', 'emp-sender');

    const event = makeEvent('handoff.initiated', {
      handoffId: 'hoff-1',
      threadId: 'thread-1',
      fromEmployeeId: 'emp-sender',
      toEmployeeId: 'emp-receiver',
      reason: 'escalation',
      taskRunId: 'task-1',
    });
    router.routeEvent(event);

    expect(rt.setState).toHaveBeenCalledWith('transmitting');
  });

  // 6. Does NOT route event to unbound prefab
  it('does not route event to unbound prefab', () => {
    const rt = createMockRuntime('desk-2', 'workspace');
    router.registerRuntime(rt);
    // No binding registered

    const event = makeEvent('employee.state.changed', {
      employeeId: 'emp-bob',
      prev: 'idle',
      next: 'thinking',
    });
    router.routeEvent(event);

    expect(rt.setState).not.toHaveBeenCalled();
  });

  // 7. Multiple prefabs bound to same resource all receive the event
  it('routes event to multiple prefabs bound to the same resource', () => {
    const rt1 = createMockRuntime('desk-a', 'workspace');
    const rt2 = createMockRuntime('desk-b', 'workspace');
    router.registerRuntime(rt1);
    router.registerRuntime(rt2);
    router.registerBinding('desk-a', 'emp-shared');
    router.registerBinding('desk-b', 'emp-shared');

    const event = makeEvent('employee.state.changed', {
      employeeId: 'emp-shared',
      prev: 'idle',
      next: 'thinking',
    });
    router.routeEvent(event);

    expect(rt1.setState).toHaveBeenCalledWith('thinking');
    expect(rt2.setState).toHaveBeenCalledWith('thinking');
  });

  // 8. unregisterBinding stops routing
  it('stops routing after unregisterBinding', () => {
    const rt = createMockRuntime('desk-3', 'workspace');
    router.registerRuntime(rt);
    router.registerBinding('desk-3', 'emp-carol');

    // Unregister the binding
    router.unregisterBinding('desk-3', 'emp-carol');

    const event = makeEvent('employee.state.changed', {
      employeeId: 'emp-carol',
      prev: 'idle',
      next: 'executing',
    });
    router.routeEvent(event);

    expect(rt.setState).not.toHaveBeenCalled();
  });

  // 9. unregisterRuntime cleans up all bindings
  it('cleans up all bindings on unregisterRuntime', () => {
    const rt = createMockRuntime('desk-4', 'workspace');
    router.registerRuntime(rt);
    router.registerBinding('desk-4', 'emp-dave');
    router.registerBinding('desk-4', 'emp-eve');

    router.unregisterRuntime('desk-4');

    // Events to either binding should not reach the removed runtime
    const event1 = makeEvent('employee.state.changed', {
      employeeId: 'emp-dave',
      prev: 'idle',
      next: 'thinking',
    });
    const event2 = makeEvent('employee.state.changed', {
      employeeId: 'emp-eve',
      prev: 'idle',
      next: 'executing',
    });
    router.routeEvent(event1);
    router.routeEvent(event2);

    expect(rt.setState).not.toHaveBeenCalled();
  });

  // 10. rack.bound event builds provider→rack index for compute routing
  it('builds provider→rack index from rack.bound event', () => {
    const rt = createMockRuntime('rack-2', 'compute');
    router.registerRuntime(rt);
    router.registerBinding('rack-2', 'rack-anthropic');

    // Bind the rack
    const bindEvent = makeEvent('rack.bound', {
      rackId: 'rack-anthropic',
      providerType: 'anthropic',
      label: 'Anthropic',
    });
    router.routeEvent(bindEvent);

    // Verify the index works by routing an LLM call through it
    const llmEvent = makeEvent('llm.call.started', {
      llmCallId: 'call-2',
      nodeName: 'analyze',
      provider: 'anthropic',
      model: 'claude-opus-4',
      threadId: 'thread-2',
    });
    router.routeEvent(llmEvent);

    expect(rt.setState).toHaveBeenCalledWith('processing');
  });

  // Additional: rack.unbound removes provider→rack index entry
  it('removes provider→rack index entry on rack.unbound', () => {
    const rt = createMockRuntime('rack-3', 'compute');
    router.registerRuntime(rt);
    router.registerBinding('rack-3', 'rack-google');

    // Bind
    router.routeEvent(makeEvent('rack.bound', {
      rackId: 'rack-google',
      providerType: 'google',
      label: 'Google',
    }));

    // Unbind
    router.routeEvent(makeEvent('rack.unbound', {
      rackId: 'rack-google',
    }));

    // LLM call via google provider should no longer route
    const llmEvent = makeEvent('llm.call.started', {
      llmCallId: 'call-3',
      nodeName: 'gen',
      provider: 'google',
      model: 'gemini-2.5-pro',
      threadId: 'thread-3',
    });
    router.routeEvent(llmEvent);

    // setState was called for rack.bound→idle and rack.unbound→offline,
    // but NOT for the llm.call.started (no provider→rack mapping)
    const calls = (rt.setState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain('idle');     // from rack.bound
    expect(calls).toContain('offline');  // from rack.unbound
    expect(calls).not.toContain('processing'); // llm.call.started should NOT route
  });

  // Additional: knowledge.search.completed routes correctly
  it('routes knowledge.search.completed to ready state', () => {
    const rt = createMockRuntime('kb-shelf-2', 'knowledge');
    router.registerRuntime(rt);
    router.registerBinding('kb-shelf-2', 'kb-api');

    const event = makeEvent('knowledge.search.completed', {
      knowledgeBaseRef: 'kb-api',
      resultCount: 5,
      employeeId: 'emp-1',
      durationMs: 120,
    });
    router.routeEvent(event);

    expect(rt.setState).toHaveBeenCalledWith('ready');
  });

  // Additional: handoff.initiated routes to BOTH from and to employee bindings
  it('routes handoff.initiated to both fromEmployeeId and toEmployeeId bindings', () => {
    const rtSender = createMockRuntime('pipe-from', 'infrastructure');
    const rtReceiver = createMockRuntime('pipe-to', 'infrastructure');
    router.registerRuntime(rtSender);
    router.registerRuntime(rtReceiver);
    router.registerBinding('pipe-from', 'emp-from');
    router.registerBinding('pipe-to', 'emp-to');

    const event = makeEvent('handoff.initiated', {
      handoffId: 'hoff-2',
      threadId: 'thread-1',
      fromEmployeeId: 'emp-from',
      toEmployeeId: 'emp-to',
      reason: 'delegation',
      taskRunId: 'task-2',
    });
    router.routeEvent(event);

    expect(rtSender.setState).toHaveBeenCalledWith('transmitting');
    expect(rtReceiver.setState).toHaveBeenCalledWith('transmitting');
  });

  // Additional: unrecognized event type produces no routing
  it('ignores unrecognized event types', () => {
    const rt = createMockRuntime('desk-5', 'workspace');
    router.registerRuntime(rt);
    router.registerBinding('desk-5', 'some-ref');

    const event = makeEvent('unknown.event.type', {
      someField: 'some-ref',
    });
    router.routeEvent(event);

    expect(rt.setState).not.toHaveBeenCalled();
  });

  // Additional: collaboration maps meeting 'running' to 'active'
  it('maps meeting running state to collaboration active', () => {
    const rt = createMockRuntime('mtg-room-2', 'collaboration');
    router.registerRuntime(rt);
    router.registerBinding('mtg-room-2', 'meeting-abc');

    const event = makeEvent('meeting.state.changed', {
      meetingId: 'meeting-abc',
      prev: 'gathering',
      next: 'running',
      participantIds: ['emp-1'],
    });
    router.routeEvent(event);

    expect(rt.setState).toHaveBeenCalledWith('active');
  });
});
