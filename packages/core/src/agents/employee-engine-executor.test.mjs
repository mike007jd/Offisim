import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

import { runEmployeeEngine } from '../../dist/agents/employee-engine-executor.js';

async function* engineEvents() {
  yield {
    kind: 'text_delta',
    channel: 'content',
    content: 'Working through the task.',
  };
  yield {
    kind: 'reasoning_delta',
    content: 'Need to inspect the repository.',
  };
  yield {
    kind: 'tool_started',
    toolCallId: 'tool-1',
    toolName: 'rg',
    toolType: 'builtin',
  };
  yield {
    kind: 'tool_completed',
    toolCallId: 'tool-1',
    toolName: 'rg',
    toolType: 'builtin',
    status: 'completed',
  };
  yield {
    kind: 'subagent_started',
    activityId: 'sub-1',
    label: 'worker',
    detail: 'Checking edge cases',
  };
  yield {
    kind: 'proposal_created',
    proposal: {
      proposalId: 'proposal-1',
      kind: 'handoff',
      title: 'Ask QA to review',
      description: 'Engine suggests a QA handoff.',
      payload: {
        employeeId: 'qa-1',
      },
      createdAt: 1_700_000_000_000,
    },
  };
}

async function* approvalEvents() {
  yield {
    kind: 'approval_requested',
    title: 'Publish engine proposal?',
    prompt: 'Approve the engine runtime action before it continues.',
  };
  yield {
    kind: 'text_delta',
    channel: 'content',
    content: 'Continuing after approval.',
  };
}

test('runEmployeeEngine maps engine activity to Offisim events without creating formal handoff events', async () => {
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
        async updateStatus() {},
      },
    },
    hookRegistry: {
      async emit() {},
    },
    scratchpad: {
      write() {},
    },
    engineAdapters: {
      get(engineId) {
        assert.equal(engineId, 'codex-engine');
        return {
          engineId: 'codex-engine',
          async startRun() {
            return {
              runId: 'engine-run-1',
              events: engineEvents(),
              result: Promise.resolve({
                content: 'Engine finished.',
                artifact: {
                  content: 'Engine artifact',
                  fileName: 'engine-artifact.md',
                  mimeType: 'text/markdown',
                },
              }),
            };
          },
          async cancelRun() {},
        };
      },
    },
  };
  const state = {
    threadId: 'thread-1',
    projectId: null,
    pendingAssignments: [
      {
        employeeId: 'emp-1',
        assignee: {
          kind: 'employee',
          employeeId: 'emp-1',
        },
        taskType: 'implementation',
        inputJson: {
          description: 'Implement runtime binding',
          requiredSkills: ['typescript'],
          taskRunId: 'task-run-1',
        },
        description: 'Implement runtime binding',
        requiredSkills: ['typescript'],
      },
    ],
    currentStepOutputs: [],
    completedStepIndices: [],
    completedAssignmentIds: [],
    messages: [],
  };
  const preflight = {
    employee: {
      employee_id: 'emp-1',
      company_id: 'company-1',
      name: 'Ada',
      role_slug: 'engineer',
      is_external: 0,
      config_json: null,
    },
    assignment: state.pendingAssignments[0],
    remaining: [],
    company: {
      company_id: 'company-1',
      name: 'Test Co',
    },
    taskRunId: 'task-run-1',
    taskLabel: 'Implement runtime binding',
    totalAssignments: 1,
    completedSoFar: 0,
    isDirectChatTask: false,
    resolved: {
      provider: 'openai',
      model: 'gpt-5.4',
      temperature: 0.7,
      maxTokens: 4096,
    },
    taskDescription: 'Implement runtime binding',
    requiredSkills: ['typescript'],
  };

  const update = await runEmployeeEngine(state, runtimeCtx, preflight, {
    mode: 'engine',
    engineId: 'codex-engine',
  });

  assert.deepEqual(update.pendingAssignments, []);
  assert.equal(update.currentStepOutputs[0].content, 'Engine finished.');

  assert.equal(emitted.some((event) => event.type === 'llm.stream.chunk' && event.payload.content.includes('Working')), true);
  assert.equal(emitted.some((event) => event.type === 'llm.stream.chunk' && event.payload.channel === 'reasoning'), true);
  assert.equal(emitted.some((event) => event.type === 'tool.execution.telemetry' && event.payload.status === 'started'), true);
  assert.equal(emitted.some((event) => event.type === 'tool.execution.telemetry' && event.payload.status === 'completed'), true);
  assert.equal(emitted.some((event) => event.type === 'engine.activity' && event.payload.kind === 'subagent'), true);
  assert.equal(emitted.some((event) => event.type === 'engine.proposal.created'), true);
  assert.equal(emitted.some((event) => event.type === 'deliverable.created'), true);
  assert.equal(emitted.some((event) => event.type.startsWith('handoff.')), false);
});

test('runEmployeeEngine waits for engine approval before finalizing', async () => {
  const emitted = [];
  const approvalRequests = [];
  let approve;
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
        async updateStatus() {},
      },
    },
    hookRegistry: {
      async emit() {},
    },
    scratchpad: {
      write() {},
    },
    interactionService: {
      requestAndWait(request) {
        approvalRequests.push(request);
        return new Promise((resolve) => {
          approve = () =>
            resolve({
              interactionId: request.interactionId,
              selectedOptionId: 'approve',
              respondedAt: Date.now(),
            });
        });
      },
    },
    engineAdapters: {
      get(engineId) {
        assert.equal(engineId, 'codex-engine');
        return {
          engineId: 'codex-engine',
          async startRun() {
            return {
              runId: 'engine-run-approval',
              events: approvalEvents(),
              result: Promise.resolve({
                content: 'Approved engine result.',
              }),
            };
          },
          async cancelRun() {},
        };
      },
    },
  };
  const state = {
    threadId: 'thread-1',
    projectId: null,
    pendingAssignments: [
      {
        employeeId: 'emp-1',
        assignee: {
          kind: 'employee',
          employeeId: 'emp-1',
        },
        taskType: 'implementation',
        inputJson: {
          description: 'Implement approval gate',
          requiredSkills: ['typescript'],
          taskRunId: 'task-run-approval',
        },
        description: 'Implement approval gate',
        requiredSkills: ['typescript'],
      },
    ],
    currentStepOutputs: [],
    completedStepIndices: [],
    completedAssignmentIds: [],
    messages: [],
  };
  const preflight = {
    employee: {
      employee_id: 'emp-1',
      company_id: 'company-1',
      name: 'Ada',
      role_slug: 'engineer',
      is_external: 0,
      config_json: null,
    },
    assignment: state.pendingAssignments[0],
    remaining: [],
    company: {
      company_id: 'company-1',
      name: 'Test Co',
    },
    taskRunId: 'task-run-approval',
    taskLabel: 'Implement approval gate',
    totalAssignments: 1,
    completedSoFar: 0,
    isDirectChatTask: false,
    resolved: {
      provider: 'openai',
      model: 'gpt-5.4',
      temperature: 0.7,
      maxTokens: 4096,
    },
    taskDescription: 'Implement approval gate',
    requiredSkills: ['typescript'],
  };

  let settled = false;
  const updatePromise = runEmployeeEngine(state, runtimeCtx, preflight, {
    mode: 'engine',
    engineId: 'codex-engine',
  }).then((update) => {
    settled = true;
    return update;
  });

  await tick();

  assert.equal(approvalRequests.length, 1);
  assert.equal(settled, false);

  approve();
  const update = await updatePromise;

  assert.deepEqual(update.pendingAssignments, []);
  assert.equal(update.currentStepOutputs[0].content, 'Approved engine result.');
  assert.equal(
    emitted.some(
      (event) =>
        event.type === 'llm.stream.chunk' && event.payload.content.includes('Continuing after'),
    ),
    true,
  );
});
