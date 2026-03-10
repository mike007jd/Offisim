import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { createTestRuntime, createTestRuntimeWithExtraEmployee } from '../helpers/test-runtime.js';
import { TEST_THREAD_ID } from '../helpers/fixtures.js';

describe('boss-chat full flow', () => {
  it('routes user message through boss → manager → pm → dispatcher → employee → summary', async () => {
    const { graph, gateway, events, runtimeCtx, repos } = createTestRuntime();

    // Boss decides to delegate
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'needs development work' }),
    });

    // Manager outputs directive
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Build the feature' },
        ],
      }),
    });

    // PM planner creates plan
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Build the feature in one step',
        steps: [
          {
            stepIndex: 0,
            description: 'Build feature',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Build the feature',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });

    // Employee produces result
    gateway.pushResponse({
      content: 'Here is the implementation code.',
    });

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Build me a website')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Should have completed
    expect(result.completed).toBe(true);

    // Should have messages from boss, employee, and summary
    expect(result.messages.length).toBeGreaterThanOrEqual(3);

    // Should have a taskPlan
    expect(result.taskPlan).not.toBeNull();
    expect(result.taskPlan!.steps).toHaveLength(1);

    // Events should include plan events
    const planEvents = events.filter((e) => e.type === 'plan.created');
    expect(planEvents).toHaveLength(1);

    const stepStartEvents = events.filter((e) => e.type === 'plan.step.started');
    expect(stepStartEvents).toHaveLength(1);

    // Events should include task state changes and employee state changes
    const taskEvents = events.filter((e) => e.type === 'task.state.changed');
    expect(taskEvents.length).toBeGreaterThanOrEqual(1);

    const employeeEvents = events.filter((e) => e.type === 'employee.state.changed');
    expect(employeeEvents.length).toBeGreaterThanOrEqual(1);

    // LLM calls should be recorded: boss + manager + pm_planner + employee = 4
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    expect(llmCalls.length).toBeGreaterThanOrEqual(4);
    expect(llmCalls.every(c => c.input_tokens > 0)).toBe(true);
    expect(llmCalls.every(c => c.latency_ms != null && c.latency_ms >= 0)).toBe(true);
    expect(llmCalls.every(c => c.error_code === null)).toBe(true);

    // Verify pm_planner LLM call was recorded
    const pmCalls = llmCalls.filter(c => c.node_name === 'pm_planner');
    expect(pmCalls).toHaveLength(1);

    // LLM events should be emitted
    const llmStarted = events.filter(e => e.type === 'llm.call.started');
    const llmCompleted = events.filter(e => e.type === 'llm.call.completed');
    expect(llmStarted.length).toBeGreaterThanOrEqual(4);
    expect(llmCompleted.length).toBeGreaterThanOrEqual(4);
  });

  it('handles direct reply without delegation', async () => {
    const { graph, gateway, runtimeCtx } = createTestRuntime();

    // Boss decides to reply directly
    gateway.pushResponse({
      content: JSON.stringify({ action: 'direct_reply', reason: 'simple greeting', reply: 'Hello! How can I help?' }),
    });

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Hello!')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    expect(result.completed).toBe(true);
    // Direct reply should NOT go through manager/employee
    expect(result.routeDecision).toBe('direct_reply');
  });

  it('persists task runs in repository via PM planner', async () => {
    const { graph, gateway, runtimeCtx, repos } = createTestRuntime();

    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'coding task' }),
    });
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Write tests' },
        ],
      }),
    });
    // PM planner creates plan with task runs
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Write tests for auth module',
        steps: [
          {
            stepIndex: 0,
            description: 'Write tests',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Write tests for the auth module',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });
    gateway.pushResponse({
      content: 'Tests written successfully.',
    });

    await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Write tests for the auth module')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    expect(taskRuns.length).toBeGreaterThanOrEqual(1);
    expect(taskRuns[0]!.status).toBe('completed');
  });

  it('uses streaming LLM summary when multiple employees produce results', async () => {
    const { graph, gateway, events, runtimeCtx, repos } = createTestRuntimeWithExtraEmployee();

    // Boss decides to delegate
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'needs multiple skills' }),
    });

    // Manager assigns to two employees
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Write the backend' },
          { taskType: 'design', employeeId: 'e-design-1', description: 'Design the UI' },
        ],
      }),
    });

    // PM planner creates plan with both employees
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Build full-stack feature with backend and UI',
        steps: [
          {
            stepIndex: 0,
            description: 'Build backend and UI in parallel',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Write the backend',
                dependsOnStepOutput: false,
              },
              {
                taskType: 'design',
                employeeId: 'e-design-1',
                description: 'Design the UI',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });

    // Employee 1 produces result
    gateway.pushResponse({ content: 'Backend implementation done.' });
    // Employee 2 produces result
    gateway.pushResponse({ content: 'UI mockups ready.' });

    // Boss summary uses streaming LLM (via MockLlmGateway.chatStream)
    gateway.pushStreamResponse({
      content: 'Team completed both backend and UI tasks successfully.',
      usage: { inputTokens: 200, outputTokens: 30 },
    });

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Build a full-stack feature')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    expect(result.completed).toBe(true);

    // Verify boss_summary LLM call was recorded (the streaming one)
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    const summaryCalls = llmCalls.filter(c => c.node_name === 'boss_summary');
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0]!.input_tokens).toBe(200);
    expect(summaryCalls[0]!.output_tokens).toBe(30);

    // Verify streaming events were emitted for boss_summary
    const llmStarted = events.filter(e =>
      e.type === 'llm.call.started' && e.payload.nodeName === 'boss_summary',
    );
    expect(llmStarted).toHaveLength(1);
  });
});
