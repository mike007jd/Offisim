import { InMemoryEventBus } from '@offisim/core/browser';
import { describe, expect, it } from 'vitest';
import { SceneIntentDispatcher } from '../../runtime/scene-intent-dispatcher';
import { InMemorySceneIntentBus, type SceneIntent } from '../../runtime/scene-intents';

describe('SceneIntentDispatcher', () => {
  it('projects selected runtime events into scene intents', () => {
    const runtimeBus = new InMemoryEventBus();
    const sceneBus = new InMemorySceneIntentBus();
    const dispatcher = new SceneIntentDispatcher(runtimeBus, sceneBus);
    const intents: SceneIntent[] = [];

    sceneBus.on('', (intent) => intents.push(intent));
    dispatcher.activate();

    runtimeBus.emit({
      type: 'task.assignment.dispatched',
      entityId: 'emp-1',
      entityType: 'task',
      companyId: 'c-1',
      timestamp: Date.now(),
      payload: {
        employeeId: 'emp-1',
        employeeName: 'Ava',
        stepLabel: 'Search auth code',
        stepIndex: 0,
        totalSteps: 3,
      },
    });

    runtimeBus.emit({
      type: 'interaction.requested',
      entityId: 'ix-1',
      entityType: 'runtime',
      companyId: 'c-1',
      threadId: 't-1',
      timestamp: Date.now(),
      payload: {
        request: {
          interactionId: 'ix-1',
          threadId: 't-1',
          companyId: 'c-1',
          kind: 'permission_request',
          severity: 'high',
          title: 'Approval needed',
          prompt: 'Allow bash?',
          options: [],
          allowFreeformResponse: true,
          employeeId: 'emp-1',
          createdAt: Date.now(),
        },
      },
    });

    runtimeBus.emit({
      type: 'employee.state.changed',
      entityId: 'emp-1',
      entityType: 'employee',
      companyId: 'c-1',
      timestamp: Date.now(),
      payload: {
        employeeId: 'emp-1',
        prev: 'executing',
        next: 'blocked',
      },
    });

    runtimeBus.emit({
      type: 'graph.node.entered',
      entityId: 'boss_summary',
      entityType: 'graph',
      companyId: 'c-1',
      threadId: 't-1',
      timestamp: Date.now(),
      payload: {
        nodeName: 'boss_summary',
        threadId: 't-1',
      },
    });

    expect(intents.map((intent) => intent.type)).toEqual([
      'scene.task.dispatched',
      'scene.interaction.waiting',
      'scene.employee.escalated',
      'scene.reporting.started',
    ]);
    expect(intents[1]?.payload).toEqual({
      kind: 'permission_request',
      employeeId: 'emp-1',
      restored: false,
    });
    expect(intents[2]?.payload).toEqual({
      employeeId: 'emp-1',
      next: 'blocked',
    });
  });
});
