import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { TEST_THREAD_ID } from '../helpers/fixtures.js';
import { createTestRuntimeWithExtraEmployee } from '../helpers/test-runtime.js';

describe('handoff flow (integration)', () => {
  it('employee A hands off to employee B, B completes, then summary', async () => {
    const { graph, gateway, events, runtimeCtx, repos } = createTestRuntimeWithExtraEmployee();

    // Boss delegates
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'needs development work' }),
    });

    // Manager assigns to developer (e-dev-1)
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
        summary: 'Build feature',
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

    // Employee A (e-dev-1) decides to hand off to designer (e-design-1)
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-ho-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'This needs UI design expertise',
            completedWork: 'Backend structure ready',
            remainingWork: 'Design and build the UI components',
          },
        },
      ],
    });

    // Employee B (e-design-1) completes the task (no handoff, just normal completion)
    gateway.pushResponse({
      content: 'UI components designed and built successfully.',
    });

    // Boss summary (streaming)
    gateway.pushStreamResponse({
      content: 'Feature completed via handoff from dev to designer.',
      usage: { inputTokens: 150, outputTokens: 20 },
    });

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Build me a website with nice UI')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // Should complete the full flow
    expect(result.completed).toBe(true);

    // handoffCount should be 1
    expect(result.handoffCount).toBe(1);

    // Handoff events should be emitted
    const handoffEvents = events.filter((e) => e.type === 'handoff.initiated');
    expect(handoffEvents).toHaveLength(1);
    expect(handoffEvents[0]?.payload.fromEmployeeId).toBe('e-dev-1');
    expect(handoffEvents[0]?.payload.toEmployeeId).toBe('e-design-1');

    // Handoff record should be persisted
    const handoffRecords = await repos.handoffs.findByThread(TEST_THREAD_ID);
    expect(handoffRecords).toHaveLength(1);
    expect(handoffRecords[0]?.from_employee_id).toBe('e-dev-1');
    expect(handoffRecords[0]?.to_employee_id).toBe('e-design-1');

    // Task runs should include the handoff continuation
    const taskRuns = await repos.taskRuns.findByThread(TEST_THREAD_ID);
    const handoffTaskRun = taskRuns.find((tr) => tr.task_type === 'handoff_continuation');
    expect(handoffTaskRun).toBeDefined();
    expect(handoffTaskRun?.employee_id).toBe('e-design-1');
    expect(handoffTaskRun?.status).toBe('completed');

    // Step outputs should contain both employees' work.
    // After step_advance runs, outputs are moved from currentStepOutputs → stepResults.
    const allOutputs = result.stepResults.flatMap((sr) => sr.outputs);
    expect(allOutputs.length).toBeGreaterThanOrEqual(2);
    const devOutput = allOutputs.find((o) => o.employeeId === 'e-dev-1');
    const designOutput = allOutputs.find((o) => o.employeeId === 'e-design-1');
    expect(devOutput).toBeDefined();
    expect(designOutput).toBeDefined();
  });

  it('respects max handoff count in a chain (A→B→C stops at limit)', async () => {
    // This test verifies that after 3 handoffs, the tool is no longer injected
    // We need 4 employees for this scenario
    const { graph, gateway, events, runtimeCtx, repos } = createTestRuntimeWithExtraEmployee();

    // Add two more employees
    repos.seed.employees([
      {
        employee_id: 'e-qa-1',
        company_id: runtimeCtx.companyId,
        source_asset_id: null,
        source_package_id: null,
        name: 'QA Bot',
        role_slug: 'qa',
        workstation_id: null,
        persona_json: JSON.stringify({ expertise: 'testing' }),
        config_json: null,
        enabled: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        employee_id: 'e-pm-1',
        company_id: runtimeCtx.companyId,
        source_asset_id: null,
        source_package_id: null,
        name: 'PM Bot',
        role_slug: 'product_manager',
        workstation_id: null,
        persona_json: JSON.stringify({ expertise: 'project management' }),
        config_json: null,
        enabled: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Boss delegates
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'work needed' }),
    });

    // Manager assigns to dev
    gateway.pushResponse({
      content: JSON.stringify({
        assignments: [{ taskType: 'code', employeeId: 'e-dev-1', description: 'Start the work' }],
      }),
    });

    // PM creates plan
    gateway.pushResponse({
      content: JSON.stringify({
        summary: 'Do the work',
        steps: [
          {
            stepIndex: 0,
            description: 'Do the work',
            tasks: [
              {
                taskType: 'code',
                employeeId: 'e-dev-1',
                description: 'Start the work',
                dependsOnStepOutput: false,
              },
            ],
          },
        ],
      }),
    });

    // Handoff 1: dev → design
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-ho-1',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-design-1',
            reason: 'Needs design',
            completedWork: 'Code done',
            remainingWork: 'Design it',
          },
        },
      ],
    });

    // Handoff 2: design → qa
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-ho-2',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-qa-1',
            reason: 'Needs testing',
            completedWork: 'Design done',
            remainingWork: 'Test it',
          },
        },
      ],
    });

    // Handoff 3: qa → pm (3rd handoff — hits the max)
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-ho-3',
          name: 'handoff_to',
          arguments: {
            targetEmployeeId: 'e-pm-1',
            reason: 'PM review needed',
            completedWork: 'Testing done',
            remainingWork: 'Review the results',
          },
        },
      ],
    });

    // PM employee (e-pm-1) now has handoffCount=3, so handoff_to should NOT be offered.
    // This employee must complete normally (no more handoffs allowed)
    gateway.pushResponse({
      content: 'Final review done. Everything looks good.',
    });

    // Boss summary — only 1 AI message (from final employee), fast path — no LLM call needed

    const result = await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Do the complete workflow')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    expect(result.completed).toBe(true);
    expect(result.handoffCount).toBe(3);

    // Should have 3 handoff events
    const handoffEvents = events.filter((e) => e.type === 'handoff.initiated');
    expect(handoffEvents).toHaveLength(3);

    // Should have 3 handoff records
    const handoffRecords = await repos.handoffs.findByThread(TEST_THREAD_ID);
    expect(handoffRecords).toHaveLength(3);
  });
});
