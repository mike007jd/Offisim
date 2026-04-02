import type { InteractionKind } from '@offisim/shared-types';

export type SceneIntentType =
  | 'scene.task.dispatched'
  | 'scene.interaction.waiting'
  | 'scene.interaction.resolved'
  | 'scene.employee.escalated'
  | 'scene.reporting.started';

export interface SceneTaskDispatchedPayload {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly stepLabel: string;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

export interface SceneInteractionWaitingPayload {
  readonly kind: InteractionKind;
  readonly employeeId?: string | null;
  readonly restored: boolean;
}

export interface SceneInteractionResolvedPayload {
  readonly kind: InteractionKind;
  readonly employeeId?: string | null;
  readonly selectedOptionId: string;
}

export interface SceneEmployeeEscalatedPayload {
  readonly employeeId: string;
  readonly next: 'blocked' | 'failed';
}

export interface SceneReportingStartedPayload {
  readonly sourceNode: string;
}

export interface SceneIntentPayloadMap {
  'scene.task.dispatched': SceneTaskDispatchedPayload;
  'scene.interaction.waiting': SceneInteractionWaitingPayload;
  'scene.interaction.resolved': SceneInteractionResolvedPayload;
  'scene.employee.escalated': SceneEmployeeEscalatedPayload;
  'scene.reporting.started': SceneReportingStartedPayload;
}

export interface SceneIntent<TType extends SceneIntentType = SceneIntentType> {
  readonly type: TType;
  readonly timestamp: number;
  readonly payload: SceneIntentPayloadMap[TType];
}

export type SceneIntentHandler = (intent: SceneIntent) => void;

interface SceneSubscription {
  prefix: string;
  handler: SceneIntentHandler;
  once: boolean;
}

export interface SceneIntentBus {
  emit(intent: SceneIntent): void;
  on(prefix: string, handler: SceneIntentHandler): () => void;
  once(prefix: string, handler: SceneIntentHandler): () => void;
  removeAll(): void;
}

export class InMemorySceneIntentBus implements SceneIntentBus {
  private subscriptions: SceneSubscription[] = [];

  emit(intent: SceneIntent): void {
    const snapshot = this.subscriptions.slice();
    const toRemove = new Set<SceneSubscription>();

    for (const sub of snapshot) {
      if (sub.prefix === '' || intent.type.startsWith(sub.prefix)) {
        sub.handler(intent);
        if (sub.once) toRemove.add(sub);
      }
    }

    if (toRemove.size > 0) {
      this.subscriptions = this.subscriptions.filter((sub) => !toRemove.has(sub));
    }
  }

  on(prefix: string, handler: SceneIntentHandler): () => void {
    const sub: SceneSubscription = { prefix, handler, once: false };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }

  once(prefix: string, handler: SceneIntentHandler): () => void {
    const sub: SceneSubscription = { prefix, handler, once: true };
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

export function createSceneIntent<TType extends SceneIntentType>(
  type: TType,
  payload: SceneIntentPayloadMap[TType],
): SceneIntent<TType> {
  return {
    type,
    timestamp: Date.now(),
    payload,
  };
}
