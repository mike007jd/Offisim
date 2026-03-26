import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { TEST_THREAD_ID, assertDefined } from '../helpers/fixtures.js';
import { createTestRuntime, createTestRuntimeWithExtraEmployee } from '../helpers/test-runtime.js';

describe('OrchestrationService streaming', () => {
  it('T1: emits graph.node.entered and graph.node.exited for direct reply path', async () => {
    const { orchestrationService, gateway, events } = createTestRuntime();

    // Boss decides to reply directly
    gateway.pushResponse({
      content: JSON.stringify({ action: 'direct_reply', reason: 'greeting', reply: 'Hello!' }),
    });

    const result = await orchestrationService.execute({
      entryMode: 'boss_chat',
      messages: [new HumanMessage('Hello!')],
    });

    expect(result.completed).toBe(true);

    // Verify graph.node.entered events
    const enteredEvents = events.filter((e) => e.type === 'graph.node.entered');
    const enteredNames = enteredEvents.map((e) => e.payload.nodeName);
    expect(enteredNames).toContain('boss');
    expect(enteredNames).toContain('boss_summary');

    // Verify graph.node.exited events (emitted by OrchestrationService)
    const exitedEvents = events.filter((e) => e.type === 'graph.node.exited');
    const exitedNames = exitedEvents.map((e) => e.payload.nodeName);
    expect(exitedNames).toContain('boss');
    expect(exitedNames).toContain('boss_summary');

    // Exited events should come after entered events for each node
    for (const nodeName of ['boss', 'boss_summary']) {
      const entered = enteredEvents.find((e) => e.payload.nodeName === nodeName);
      const exited = exitedEvents.find((e) => e.payload.nodeName === nodeName);
      expect(entered).toBeDefined();
      expect(exited).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: values asserted defined above
      expect(exited!.timestamp).toBeGreaterThanOrEqual(entered!.timestamp);
    }
  });

  it('T2: emits full delegation event sequence in correct order', async () => {
    const { orchestrationService, gateway, events } = createTestRuntime();

    // Boss delegates
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'needs dev work' }),
    });
    // Manager assigns
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [{ taskType: 'code', employeeId: 'e-dev-1', description: 'Build it' }],
      }),
    });
    // Employee works
    gateway.pushResponse({ content: 'Done building.' });

    const result = await orchestrationService.execute({
      entryMode: 'boss_chat',
      messages: [new HumanMessage('Build a feature')],
    });

    expect(result.completed).toBe(true);

    // Verify entered events for all 4 nodes in the delegation path
    const enteredEvents = events.filter((e) => e.type === 'graph.node.entered');
    const enteredNames = enteredEvents.map((e) => e.payload.nodeName);
    expect(enteredNames).toContain('boss');
    expect(enteredNames).toContain('manager');
    expect(enteredNames).toContain('employee');
    expect(enteredNames).toContain('boss_summary');

    // Verify exited events for all 4 nodes
    const exitedEvents = events.filter((e) => e.type === 'graph.node.exited');
    const exitedNames = exitedEvents.map((e) => e.payload.nodeName);
    expect(exitedNames).toContain('boss');
    expect(exitedNames).toContain('manager');
    expect(exitedNames).toContain('employee');
    expect(exitedNames).toContain('boss_summary');

    // Verify ordering: boss exited before manager exited before employee exited before boss_summary exited
    const exitTimestamps = Object.fromEntries(
      exitedEvents.map((e) => [e.payload.nodeName, e.timestamp]),
    );
    expect(exitTimestamps.boss).toBeLessThanOrEqual(assertDefined(exitTimestamps.manager));
    expect(exitTimestamps.manager).toBeLessThanOrEqual(assertDefined(exitTimestamps.employee));
    expect(exitTimestamps.employee).toBeLessThanOrEqual(assertDefined(exitTimestamps.boss_summary));
  });

  it('T3: emits llm.stream.chunk events during boss_summary streaming', async () => {
    const { orchestrationService, gateway, events } = createTestRuntimeWithExtraEmployee();

    // Boss delegates
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'multi-skill task' }),
    });
    // Manager assigns two employees
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [
          { taskType: 'code', employeeId: 'e-dev-1', description: 'Backend work' },
          { taskType: 'design', employeeId: 'e-design-1', description: 'UI work' },
        ],
      }),
    });
    // Employee 1 result
    gateway.pushResponse({ content: '[Dev Bot]: Backend done.' });
    // Employee 2 result
    gateway.pushResponse({ content: '[Design Bot]: UI done.' });

    // Boss summary streams (multiple chunks)
    gateway.pushStreamResponse({
      content: 'Both backend and UI tasks completed successfully.',
      usage: { inputTokens: 150, outputTokens: 25 },
    });

    const result = await orchestrationService.execute({
      entryMode: 'boss_chat',
      messages: [new HumanMessage('Build full stack')],
    });

    expect(result.completed).toBe(true);

    // Verify llm.stream.chunk events were emitted
    const chunkEvents = events.filter((e) => e.type === 'llm.stream.chunk');
    expect(chunkEvents.length).toBeGreaterThanOrEqual(1);

    // All chunk events should reference boss_summary
    for (const chunk of chunkEvents) {
      expect(chunk.payload.nodeName).toBe('boss_summary');
      expect(typeof chunk.payload.content).toBe('string');
      expect(chunk.payload.content.length).toBeGreaterThan(0);
    }

    // Concatenated chunks should contain the full content (mock adds trailing space per word)
    const allChunkContent = chunkEvents
      .map((e) => e.payload.content)
      .join('')
      .trim();
    expect(allChunkContent).toBe('Both backend and UI tasks completed successfully.');
  });

  it('T4: execute() returns correct final state matching graph.invoke()', async () => {
    const { orchestrationService, gateway, repos } = createTestRuntime();

    // Boss delegates
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'coding task' }),
    });
    // Manager assigns
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [{ taskType: 'code', employeeId: 'e-dev-1', description: 'Write tests' }],
      }),
    });
    // Employee result
    gateway.pushResponse({ content: 'Tests written.' });

    const result = await orchestrationService.execute({
      entryMode: 'boss_chat',
      messages: [new HumanMessage('Write tests')],
    });

    // Messages are now accumulated across nodes (matching graph.invoke() behavior)
    expect(result.completed).toBe(true);
    expect(result.threadId).toBe(TEST_THREAD_ID);
    expect(result.messages.length).toBeGreaterThanOrEqual(3);

    // Verify persistence (side effects still happen regardless of streaming)
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    expect(taskRuns.length).toBeGreaterThanOrEqual(1);

    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    expect(llmCalls.length).toBeGreaterThanOrEqual(3); // boss + manager + employee
  });

  it('T5: event metadata has correct companyId and threadId', async () => {
    const { orchestrationService, gateway, events, runtimeCtx } = createTestRuntime();

    gateway.pushResponse({
      content: JSON.stringify({ action: 'direct_reply', reason: 'hi', reply: 'Hello!' }),
    });

    await orchestrationService.execute({
      entryMode: 'boss_chat',
      messages: [new HumanMessage('Hi')],
    });

    // All graph.node events should have correct companyId and threadId
    const graphEvents = events.filter(
      (e) => e.type === 'graph.node.entered' || e.type === 'graph.node.exited',
    );
    expect(graphEvents.length).toBeGreaterThanOrEqual(2);

    for (const event of graphEvents) {
      expect(event.companyId).toBe(runtimeCtx.companyId);
      expect(event.threadId).toBe(runtimeCtx.threadId);
    }
  });
});
