import type { RuntimeEvent } from '@aics/shared-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler = (event: RuntimeEvent<any>) => void;

export interface EventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: RuntimeEvent<any>): void;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: RuntimeEvent<any>): void {
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
