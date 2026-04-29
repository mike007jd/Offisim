import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeEmployeeSuccess } from '../../dist/agents/employee-completion.js';

test('finalizeEmployeeSuccess stores verifier blocks as DB-safe blocked status', async () => {
  const taskRunUpdates = [];
  const kanbanTransitions = [];
  const emitted = [];

  const runtimeCtx = {
    companyId: 'company-1',
    threadId: 'thread-1',
    eventBus: {
      emit(event) {
        emitted.push(event);
      },
    },
    repos: {
      taskRuns: {
        async updateStatus(...args) {
          taskRunUpdates.push(args);
        },
      },
      kanban: {
        async transitionByTaskRun(...args) {
          kanbanTransitions.push(args);
        },
      },
    },
    hookRegistry: {
      async emit(eventName, payload) {
        if (eventName === 'task.completion.verifying') {
          payload.block('no verification evidence');
        }
      },
    },
    scratchpad: {
      write() {
        throw new Error('scratchpad should not write for blocked completion');
      },
    },
  };

  const state = {
    threadId: 'thread-1',
    projectId: null,
    currentStepOutputs: [],
    recentToolResults: [],
  };
  const preflight = {
    assignment: {
      taskType: 'implementation',
    },
    remaining: [],
    employee: {
      employee_id: 'employee-1',
      name: 'YOLO Master',
      role_slug: 'yolo_master',
    },
    taskRunId: 'task-run-1',
    taskLabel: 'Validate desktop runtime',
    totalAssignments: 1,
    completedSoFar: 0,
    isDirectChatTask: true,
    resolved: {
      provider: 'openai',
      model: 'gpt-5.4',
      temperature: 0.3,
      maxTokens: 8192,
    },
    taskDescription: 'Validate desktop runtime',
    stepIndex: 0,
  };

  await finalizeEmployeeSuccess({
    runtimeCtx,
    state,
    preflight,
    llmResponse: { content: 'No file or command tools are available.' },
    citationMap: [],
    source: 'normal',
    round: 1,
    signal: undefined,
  });

  assert.equal(taskRunUpdates[0][0], 'task-run-1');
  assert.equal(taskRunUpdates[0][1], 'blocked');
  assert.equal(kanbanTransitions[0][0], 'task-run-1');
  assert.equal(kanbanTransitions[0][1], 'review');
  assert.equal(kanbanTransitions[0][2], 'no verification evidence');
  assert.equal(
    emitted.some(
      (event) => event.type === 'task.state.changed' && event.payload.next === 'review_ready',
    ),
    true,
  );
});
