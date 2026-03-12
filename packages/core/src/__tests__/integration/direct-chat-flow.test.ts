import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { TEST_THREAD_ID } from '../helpers/fixtures.js';
import { createTestRuntime } from '../helpers/test-runtime.js';

describe('direct chat flow', () => {
  it('routes direct_chat through employee_direct_setup → employee → boss_summary', async () => {
    const { graph, gateway, runtimeCtx } = createTestRuntime();

    // Only one LLM call needed: the employee node
    gateway.pushResponse({
      content:
        'Here is the function you requested:\n```ts\nfunction add(a: number, b: number) { return a + b; }\n```',
    });

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'direct_chat',
        targetEmployeeId: 'e-dev-1',
        messages: [new HumanMessage('Write me an add function')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Should have completed
    expect(result.completed).toBe(true);

    // Should NOT have a taskPlan (skips boss/manager/pm)
    expect(result.taskPlan).toBeNull();

    // Should have messages from the employee
    const aiMessages = result.messages
      .filter((m: { _getType: () => string }) => m._getType() === 'ai')
      .map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : ''));
    expect(aiMessages.some((c: string) => c.includes('[Dev Bot]'))).toBe(true);
  });

  it('emits directChatStarted and directChatCompleted events', async () => {
    const { graph, gateway, events, runtimeCtx } = createTestRuntime();

    gateway.pushResponse({ content: 'Direct chat response.' });

    await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'direct_chat',
        targetEmployeeId: 'e-dev-1',
        messages: [new HumanMessage('Hello employee')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Should emit directChatStarted
    const startedEvents = events.filter((e) => e.type === 'direct.chat.started');
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0]!.payload.employeeId).toBe('e-dev-1');
    expect(startedEvents[0]!.payload.employeeName).toBe('Dev Bot');

    // Should emit directChatCompleted
    const completedEvents = events.filter((e) => e.type === 'direct.chat.completed');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]!.payload.employeeId).toBe('e-dev-1');
  });

  it('does NOT emit plan events in direct chat flow', async () => {
    const { graph, gateway, events, runtimeCtx } = createTestRuntime();

    gateway.pushResponse({ content: 'Done.' });

    await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'direct_chat',
        targetEmployeeId: 'e-dev-1',
        messages: [new HumanMessage('Do something')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    const planEvents = events.filter(
      (e) =>
        e.type === 'plan.created' ||
        e.type === 'plan.step.started' ||
        e.type === 'plan.step.completed' ||
        e.type === 'plan.completed',
    );
    expect(planEvents).toHaveLength(0);
  });

  it('flows through correct graph nodes (employee_direct_setup → employee → boss_summary)', async () => {
    const { graph, gateway, events, runtimeCtx } = createTestRuntime();

    gateway.pushResponse({ content: 'Task done.' });

    await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'direct_chat',
        targetEmployeeId: 'e-dev-1',
        messages: [new HumanMessage('Write code')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    const enteredNodes = events
      .filter((e) => e.type === 'graph.node.entered')
      .map((e) => e.payload.nodeName);

    // Should include these nodes in order
    expect(enteredNodes).toContain('employee_direct_setup');
    expect(enteredNodes).toContain('employee');
    expect(enteredNodes).toContain('boss_summary');

    // Should NOT include boss, manager, pm_planner, step_dispatcher
    expect(enteredNodes).not.toContain('boss');
    expect(enteredNodes).not.toContain('manager');
    expect(enteredNodes).not.toContain('pm_planner');
    expect(enteredNodes).not.toContain('step_dispatcher');
  });

  it('handles missing employee gracefully via error_handler', async () => {
    const { graph, events, runtimeCtx } = createTestRuntime();

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'direct_chat',
        targetEmployeeId: 'e-nonexistent',
        messages: [new HumanMessage('Hello')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Should complete (error handler marks completed)
    expect(result.completed).toBe(true);

    // Error handler should have been reached
    const enteredNodes = events
      .filter((e) => e.type === 'graph.node.entered')
      .map((e) => e.payload.nodeName);
    expect(enteredNodes).toContain('error_handler');
  });

  it('creates and completes a task run for the direct chat', async () => {
    const { graph, gateway, repos, runtimeCtx } = createTestRuntime();

    gateway.pushResponse({ content: 'Implementation done.' });

    await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'direct_chat',
        targetEmployeeId: 'e-dev-1',
        messages: [new HumanMessage('Build feature')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Task run should have been created and completed
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    const directChatRuns = taskRuns.filter((tr) => tr.task_type === 'direct_chat');
    expect(directChatRuns).toHaveLength(1);
    expect(directChatRuns[0]!.status).toBe('completed');
    expect(directChatRuns[0]!.employee_id).toBe('e-dev-1');
  });
});
