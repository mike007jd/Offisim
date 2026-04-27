import type { RuntimeEvent } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { RuntimeRepositories } from '../runtime/repositories.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Text } from './hash.js';

export class TraceRecorder {
  readonly events: RuntimeEvent[] = [];
  private readonly unsubscribe?: () => void;

  constructor(eventBus?: EventBus) {
    this.unsubscribe = eventBus?.on('', (event) => {
      this.events.push(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  async hash(): Promise<string> {
    return sha256Text(canonicalJson(this.events.map(normalizeRuntimeEvent)));
  }

  async snapshotRepos(repos: RuntimeRepositories): Promise<Record<string, unknown>> {
    return {
      llmCalls: repos.llmCalls.findByThread ? await repos.llmCalls.findByThread('') : [],
    };
  }
}

function normalizeRuntimeEvent(event: RuntimeEvent): unknown {
  return {
    type: event.type,
    companyId: event.companyId,
    threadId: event.threadId ?? null,
    payload: event.payload,
  };
}
