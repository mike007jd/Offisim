/**
 * PrefabEventRouter — maps RuntimeEvents to PrefabRuntime state changes
 * based on registered bindings.
 *
 * Design:
 * - A binding index maps resourceRef strings to sets of prefab instanceIds.
 * - When a RuntimeEvent arrives, resourceRefs are extracted from the event payload.
 * - Matching prefab runtimes receive inferred state transitions.
 * - Special provider→rack index supports compute category routing for LLM events.
 */
import type { PrefabDefinition, RuntimeEvent, SemanticCategory } from '@offisim/shared-types';
import { inferWorkspaceState } from './state-machines.js';

/**
 * Minimal interface for a prefab runtime instance.
 * Decoupled from any rendering engine — consumers provide their own
 * implementation (Three.js, SVG, headless, etc.).
 */
export interface PrefabRuntimeHandle {
  readonly instanceId: string;
  readonly definition: Pick<PrefabDefinition, 'category'>;
  setState(next: string): boolean;
}

export class PrefabEventRouter {
  /** Map: resourceRef → Set<instanceId> */
  private bindingIndex = new Map<string, Set<string>>();
  /** Map: instanceId → PrefabRuntimeHandle */
  private runtimes = new Map<string, PrefabRuntimeHandle>();
  /** Map: "providerType" → rackId (for compute category LLM event routing) */
  private providerRackIndex = new Map<string, string>();

  /** Register a prefab runtime handle */
  registerRuntime(runtime: PrefabRuntimeHandle): void {
    this.runtimes.set(runtime.instanceId, runtime);
  }

  /** Unregister a prefab runtime handle */
  unregisterRuntime(instanceId: string): void {
    this.runtimes.delete(instanceId);
    // Clean up binding index
    for (const [ref, ids] of this.bindingIndex) {
      ids.delete(instanceId);
      if (ids.size === 0) this.bindingIndex.delete(ref);
    }
  }

  /** Register a binding: events matching resourceRef route to instanceId */
  registerBinding(instanceId: string, resourceRef: string): void {
    if (!this.bindingIndex.has(resourceRef)) {
      this.bindingIndex.set(resourceRef, new Set());
    }
    this.bindingIndex.get(resourceRef)?.add(instanceId);
  }

  /** Unregister a binding */
  unregisterBinding(instanceId: string, resourceRef: string): void {
    this.bindingIndex.get(resourceRef)?.delete(instanceId);
  }

  /** Main event routing — called by SceneEventHandler for every RuntimeEvent */
  routeEvent(event: RuntimeEvent): void {
    const resourceRefs = this.extractResourceRefs(event);
    for (const ref of resourceRefs) {
      const instanceIds = this.bindingIndex.get(ref);
      if (!instanceIds) continue;
      for (const id of instanceIds) {
        const runtime = this.runtimes.get(id);
        if (!runtime) continue;
        const nextState = this.inferState(runtime.definition.category, event);
        if (nextState) runtime.setState(nextState);
      }
    }

    // Special handling: rack.bound builds provider→rack index
    if (event.type === 'rack.bound') {
      const payload = event.payload as { rackId: string; providerType: string; label: string };
      this.providerRackIndex.set(payload.providerType, payload.rackId);
    }
    if (event.type === 'rack.unbound') {
      const payload = event.payload as { rackId: string };
      for (const [key, val] of this.providerRackIndex) {
        if (val === payload.rackId) this.providerRackIndex.delete(key);
      }
    }
  }

  /** Extract resourceRef(s) from a RuntimeEvent based on event type */
  private extractResourceRefs(event: RuntimeEvent): string[] {
    const type = event.type;
    const payload = event.payload as Record<string, unknown>;

    if (type === 'employee.state.changed') {
      return [payload.employeeId as string];
    }
    if (type === 'llm.call.started' || type === 'llm.call.completed') {
      // Look up rack by provider
      const provider = payload.provider as string;
      const rackId = this.providerRackIndex.get(provider);
      return rackId ? [rackId] : [];
    }
    if (type === 'rack.bound' || type === 'rack.unbound') {
      return [payload.rackId as string];
    }
    if (type.startsWith('knowledge.')) {
      return [payload.knowledgeBaseRef as string];
    }
    if (type === 'meeting.state.changed') {
      return [payload.meetingId as string];
    }
    if (type === 'handoff.initiated') {
      const refs: string[] = [];
      if (payload.fromEmployeeId) refs.push(payload.fromEmployeeId as string);
      if (payload.toEmployeeId) refs.push(payload.toEmployeeId as string);
      return refs;
    }
    if (type === 'handoff.completed') {
      return payload.toEmployeeId ? [payload.toEmployeeId as string] : [];
    }
    return [];
  }

  /** Clean up all registrations */
  destroy(): void {
    this.bindingIndex.clear();
    this.runtimes.clear();
    this.providerRackIndex.clear();
  }

  /** Infer the target prefab state from an event */
  private inferState(category: SemanticCategory, event: RuntimeEvent): string | null {
    const payload = event.payload as Record<string, unknown>;

    switch (category) {
      case 'workspace': {
        if (event.type === 'employee.state.changed') {
          return inferWorkspaceState(payload.next as Parameters<typeof inferWorkspaceState>[0]);
        }
        return null;
      }
      case 'compute': {
        if (event.type === 'llm.call.started') return 'processing';
        if (event.type === 'llm.call.completed') return 'idle';
        if (event.type === 'rack.bound') return 'idle';
        if (event.type === 'rack.unbound') return 'offline';
        if (event.type === 'error.occurred') return 'error';
        return null;
      }
      case 'knowledge': {
        if (event.type === 'knowledge.index.started') return 'indexing';
        if (event.type === 'knowledge.index.completed') return 'ready';
        if (event.type === 'knowledge.index.failed') return 'error';
        if (event.type === 'knowledge.search.started') return 'searching';
        if (event.type === 'knowledge.search.completed') return 'ready';
        return null;
      }
      case 'collaboration': {
        if (event.type === 'meeting.state.changed') {
          const meetingState = payload.next as string;
          const map: Record<string, string> = {
            scheduled: 'scheduled',
            gathering: 'gathering',
            running: 'active',
            paused: 'paused',
            waiting: 'active',
            completed: 'ended',
            cancelled: 'empty',
          };
          return map[meetingState] ?? null;
        }
        return null;
      }
      case 'infrastructure': {
        if (event.type === 'handoff.initiated') return 'transmitting';
        if (event.type === 'handoff.completed') return 'idle';
        if (event.type === 'error.occurred') return 'error';
        return null;
      }
      default:
        return null;
    }
  }
}
