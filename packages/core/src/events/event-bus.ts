import type { RuntimeEvent } from '@aics/shared-types';

export type EventHandler = (event: RuntimeEvent) => void;

export interface EventBus {
  emit(event: RuntimeEvent): void;
  on(prefix: string, handler: EventHandler): () => void;
  once(prefix: string, handler: EventHandler): () => void;
  removeAll(): void;
}

interface Subscription {
  prefix: string;
  handler: EventHandler;
  once: boolean;
}

export class InMemoryEventBus implements EventBus {
  private subscriptions: Subscription[] = [];

  emit(event: RuntimeEvent): void {
    const toRemove: Subscription[] = [];

    for (const sub of this.subscriptions) {
      if (sub.prefix === '' || event.type.startsWith(sub.prefix)) {
        sub.handler(event);
        if (sub.once) {
          toRemove.push(sub);
        }
      }
    }

    for (const sub of toRemove) {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    }
  }

  on(prefix: string, handler: EventHandler): () => void {
    const sub: Subscription = { prefix, handler, once: false };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }

  once(prefix: string, handler: EventHandler): () => void {
    const sub: Subscription = { prefix, handler, once: true };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }

  removeAll(): void {
    this.subscriptions = [];
  }
}
