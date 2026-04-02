import type { EventBus } from '@offisim/core/browser';
import type {
  EmployeeStatePayload,
  GraphNodeEnteredPayload,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  RuntimeEvent,
  TaskAssignmentDispatchedPayload,
} from '@offisim/shared-types';
import { type SceneIntentBus, createSceneIntent } from './scene-intents.js';

export class SceneIntentDispatcher {
  private unsubscribeFns: Array<() => void> = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly sceneIntentBus: SceneIntentBus,
  ) {}

  activate(): void {
    if (this.unsubscribeFns.length > 0) {
      return;
    }

    this.unsubscribeFns.push(
      this.eventBus.on(
        'task.assignment.dispatched',
        (event: RuntimeEvent<TaskAssignmentDispatchedPayload>) => {
          this.sceneIntentBus.emit(createSceneIntent('scene.task.dispatched', event.payload));
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'interaction.requested',
        (event: RuntimeEvent<InteractionRequestedPayload>) => {
          this.sceneIntentBus.emit(
            createSceneIntent('scene.interaction.waiting', {
              kind: event.payload.request.kind,
              employeeId: event.payload.request.employeeId ?? null,
              restored: false,
            }),
          );
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'interaction.restored',
        (event: RuntimeEvent<InteractionRestoredPayload>) => {
          this.sceneIntentBus.emit(
            createSceneIntent('scene.interaction.waiting', {
              kind: event.payload.request.kind,
              employeeId: event.payload.request.employeeId ?? null,
              restored: true,
            }),
          );
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'interaction.resolved',
        (event: RuntimeEvent<InteractionResolvedPayload>) => {
          this.sceneIntentBus.emit(
            createSceneIntent('scene.interaction.resolved', {
              kind: event.payload.request.kind,
              employeeId: event.payload.request.employeeId ?? null,
              selectedOptionId: event.payload.response.selectedOptionId,
            }),
          );
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on('employee.state.changed', (event: RuntimeEvent<EmployeeStatePayload>) => {
        if (event.payload.next !== 'blocked' && event.payload.next !== 'failed') {
          return;
        }
        this.sceneIntentBus.emit(
          createSceneIntent('scene.employee.escalated', {
            employeeId: event.payload.employeeId,
            next: event.payload.next,
          }),
        );
      }),
    );

    this.unsubscribeFns.push(
      this.eventBus.on('graph.node.entered', (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        if (event.payload.nodeName !== 'boss_summary') {
          return;
        }
        this.sceneIntentBus.emit(
          createSceneIntent('scene.reporting.started', {
            sourceNode: event.payload.nodeName,
          }),
        );
      }),
    );
  }

  deactivate(): void {
    for (const unsub of this.unsubscribeFns) {
      unsub();
    }
    this.unsubscribeFns = [];
  }
}
