import type { EventBus } from '@offisim/core/browser';
import type {
  EmployeeStatePayload,
  GraphNodeEnteredPayload,
  HandoffCompletedPayload,
  HandoffInitiatedPayload,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  LlmStreamChunkPayload,
  RuntimeEvent,
  TaskAssignmentDispatchedPayload,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import {
  buildEmployeeStateCue,
  buildHandoffCue,
  buildInteractionResolvedCue,
  buildInteractionWaitingCue,
  buildReportingStreamCue,
  buildTaskDispatchCue,
  buildToolCue,
  sanitizeCueText,
} from './employee-performance-cues.js';
import { type SceneIntentBus, createSceneIntent } from './scene-intents.js';

export class SceneIntentDispatcher {
  private unsubscribeFns: Array<() => void> = [];
  private reportingEmployeeIds = new Set<string>();
  private reportingStreamText = '';
  private reportingStreamNode = '';

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
          if (!event.payload.employeeId) {
            return;
          }
          const payload = {
            employeeId: event.payload.employeeId,
            employeeName: event.payload.employeeName,
            stepLabel: event.payload.stepLabel,
            stepIndex: event.payload.stepIndex,
            totalSteps: event.payload.totalSteps,
          };
          this.sceneIntentBus.emit(createSceneIntent('scene.task.dispatched', payload));
          this.sceneIntentBus.emit(
            createSceneIntent(
              'scene.employee.performance.cue',
              buildTaskDispatchCue({
                employeeId: event.payload.employeeId,
                stepLabel: event.payload.stepLabel,
                stepIndex: event.payload.stepIndex,
                totalSteps: event.payload.totalSteps,
                sourceId:
                  event.entityId || `${event.payload.employeeId}:${event.payload.stepIndex}`,
              }),
            ),
          );
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'tool.execution.telemetry',
        (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
          const cue = buildToolCue(event.payload, event.payload.toolCallId || event.entityId);
          if (!cue) return;
          if (event.payload.status !== 'started') {
            this.sceneIntentBus.emit(
              createSceneIntent('scene.employee.performance.clear', {
                employeeId: event.payload.employeeId ?? null,
                sourceType: 'tool.execution.telemetry',
                sourceId: event.payload.toolCallId || event.entityId,
              }),
            );
          }
          this.sceneIntentBus.emit(createSceneIntent('scene.employee.performance.cue', cue));
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'interaction.requested',
        (event: RuntimeEvent<InteractionRequestedPayload>) => {
          const employeeId = resolveInteractionEmployeeId(event.payload.request);
          this.sceneIntentBus.emit(
            createSceneIntent('scene.interaction.waiting', {
              kind: event.payload.request.kind,
              employeeId,
              restored: false,
            }),
          );
          if (employeeId) {
            this.sceneIntentBus.emit(
              createSceneIntent(
                'scene.employee.performance.cue',
                buildInteractionWaitingCue({
                  kind: event.payload.request.kind,
                  employeeId,
                  interactionId: event.payload.request.interactionId,
                  restored: false,
                }),
              ),
            );
          }
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'interaction.restored',
        (event: RuntimeEvent<InteractionRestoredPayload>) => {
          const employeeId = resolveInteractionEmployeeId(event.payload.request);
          this.sceneIntentBus.emit(
            createSceneIntent('scene.interaction.waiting', {
              kind: event.payload.request.kind,
              employeeId,
              restored: true,
            }),
          );
          if (employeeId) {
            this.sceneIntentBus.emit(
              createSceneIntent(
                'scene.employee.performance.cue',
                buildInteractionWaitingCue({
                  kind: event.payload.request.kind,
                  employeeId,
                  interactionId: event.payload.request.interactionId,
                  restored: true,
                }),
              ),
            );
          }
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on(
        'interaction.resolved',
        (event: RuntimeEvent<InteractionResolvedPayload>) => {
          const employeeId = resolveInteractionEmployeeId(event.payload.request);
          this.sceneIntentBus.emit(
            createSceneIntent('scene.interaction.resolved', {
              kind: event.payload.request.kind,
              employeeId,
              selectedOptionId: event.payload.response.selectedOptionId,
            }),
          );
          this.sceneIntentBus.emit(
            createSceneIntent('scene.employee.performance.clear', {
              employeeId,
              sourceType: 'interaction',
              sourceId: event.payload.request.interactionId,
            }),
          );
          if (employeeId) {
            this.sceneIntentBus.emit(
              createSceneIntent(
                'scene.employee.performance.cue',
                buildInteractionResolvedCue({
                  employeeId,
                  interactionId: event.payload.request.interactionId,
                }),
              ),
            );
          }
        },
      ),
    );

    this.unsubscribeFns.push(
      this.eventBus.on('handoff.initiated', (event: RuntimeEvent<HandoffInitiatedPayload>) => {
        this.sceneIntentBus.emit(
          createSceneIntent('scene.handoff.initiated', {
            handoffId: event.payload.handoffId,
            fromEmployeeId: event.payload.fromEmployeeId,
            toEmployeeId: event.payload.toEmployeeId,
            reason: event.payload.reason,
            taskRunId: event.payload.taskRunId,
          }),
        );
        this.sceneIntentBus.emit(
          createSceneIntent(
            'scene.employee.performance.cue',
            buildHandoffCue({
              employeeId: event.payload.fromEmployeeId,
              handoffId: event.payload.handoffId,
              direction: 'outbound',
              reason: event.payload.reason,
            }),
          ),
        );
        this.sceneIntentBus.emit(
          createSceneIntent(
            'scene.employee.performance.cue',
            buildHandoffCue({
              employeeId: event.payload.toEmployeeId,
              handoffId: event.payload.handoffId,
              direction: 'inbound',
              reason: event.payload.reason,
            }),
          ),
        );
      }),
    );

    this.unsubscribeFns.push(
      this.eventBus.on('handoff.completed', (event: RuntimeEvent<HandoffCompletedPayload>) => {
        this.sceneIntentBus.emit(
          createSceneIntent('scene.handoff.completed', {
            handoffId: event.payload.handoffId,
            toEmployeeId: event.payload.toEmployeeId,
            taskRunId: event.payload.taskRunId,
          }),
        );
        this.sceneIntentBus.emit(
          createSceneIntent('scene.employee.performance.clear', {
            sourceType: 'handoff',
            sourceId: event.payload.handoffId,
          }),
        );
        this.sceneIntentBus.emit(
          createSceneIntent(
            'scene.employee.performance.cue',
            buildHandoffCue({
              employeeId: event.payload.toEmployeeId,
              handoffId: event.payload.handoffId,
              direction: 'completed',
            }),
          ),
        );
      }),
    );

    this.unsubscribeFns.push(
      this.eventBus.on('employee.state.changed', (event: RuntimeEvent<EmployeeStatePayload>) => {
        if (event.payload.next === 'reporting') {
          this.reportingEmployeeIds.add(event.payload.employeeId);
        } else if (event.payload.prev === 'reporting' || event.payload.next === 'idle') {
          this.reportingEmployeeIds.delete(event.payload.employeeId);
        }
        if (event.payload.next === 'idle') {
          this.sceneIntentBus.emit(
            createSceneIntent('scene.employee.performance.clear', {
              employeeId: event.payload.employeeId,
            }),
          );
        }
        const cue = buildEmployeeStateCue({
          employeeId: event.payload.employeeId,
          next: event.payload.next,
          sourceId: event.entityId || `${event.payload.employeeId}:${event.payload.next}`,
        });
        if (cue) {
          this.sceneIntentBus.emit(createSceneIntent('scene.employee.performance.cue', cue));
        }
        if (event.payload.next !== 'blocked' && event.payload.next !== 'failed') return;
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

    this.unsubscribeFns.push(
      this.eventBus.on('llm.stream.chunk', (event: RuntimeEvent<LlmStreamChunkPayload>) => {
        const { nodeName, channel = 'content', content } = event.payload;
        if (channel !== 'content' || !content) return;
        if (nodeName !== 'boss_summary' && nodeName !== 'boss' && nodeName !== 'manager') return;
        if (nodeName !== this.reportingStreamNode) {
          this.reportingStreamNode = nodeName;
          this.reportingStreamText = '';
        }
        this.reportingStreamText = sanitizeCueText(`${this.reportingStreamText}${content}`, 50);
        for (const employeeId of this.reportingEmployeeIds) {
          this.sceneIntentBus.emit(
            createSceneIntent(
              'scene.employee.performance.cue',
              buildReportingStreamCue({
                employeeId,
                streamKey: event.entityId || nodeName,
                text: this.reportingStreamText,
              }),
            ),
          );
        }
      }),
    );

    this.unsubscribeFns.push(
      this.eventBus.on('execution.aborted', () => {
        this.reportingEmployeeIds.clear();
        this.reportingStreamText = '';
        this.sceneIntentBus.emit(
          createSceneIntent('scene.employee.performance.clear', { all: true }),
        );
      }),
    );
  }

  deactivate(): void {
    for (const unsub of this.unsubscribeFns) {
      unsub();
    }
    this.unsubscribeFns = [];
    this.reportingEmployeeIds.clear();
    this.reportingStreamText = '';
    this.reportingStreamNode = '';
  }
}

function resolveInteractionEmployeeId(request: {
  employeeId?: string | null;
  context?: { type: string; employeeId?: string | null; resolvedEmployeeId?: string | null };
}): string | null {
  if (request.employeeId) return request.employeeId;
  if (request.context?.employeeId) return request.context.employeeId;
  if (request.context?.resolvedEmployeeId) return request.context.resolvedEmployeeId;
  return null;
}
