import assert from 'node:assert/strict';
import test from 'node:test';

const { runDeterministicScenario } = await import(
  new URL('../../dist/testing/scenario-runner.js', import.meta.url).href
);

test('pm planner persists plan tasks as kanban cards', async () => {
  const report = await runDeterministicScenario({
    id: 'pm-planner-kanban',
    category: 'kanban',
    entryMode: 'boss_chat',
    seed: {
      company: { companyId: 'company-pm-planner-kanban', name: 'PM Kanban Co' },
      thread: {
        threadId: 'thread-pm-planner-kanban',
        status: 'running',
        projectId: 'project-pm-planner-kanban',
      },
      projects: [{ id: 'project-pm-planner-kanban', name: 'PM Kanban Project' }],
      employees: [
        { id: 'emp-kanban-a', name: 'Ada', role: 'engineer' },
        { id: 'emp-kanban-b', name: 'Bea', role: 'designer' },
      ],
    },
    llmTurns: [
      {
        id: 'pm-plan',
        content: JSON.stringify({
          summary: 'Create a three task plan',
          steps: [
            {
              stepIndex: 0,
              description: 'Build the base',
              tasks: [
                {
                  taskType: 'general',
                  employeeId: 'emp-kanban-a',
                  description: 'Implement the base',
                  dependsOnStepOutput: false,
                },
              ],
            },
            {
              stepIndex: 1,
              description: 'Design the base',
              tasks: [
                {
                  taskType: 'general',
                  employeeId: 'emp-kanban-b',
                  description: 'Design the base',
                  dependsOnStepOutput: false,
                },
              ],
            },
            {
              stepIndex: 2,
              description: 'Polish the result',
              tasks: [
                {
                  taskType: 'general',
                  employeeId: 'emp-kanban-a',
                  description: 'Polish implementation',
                  dependsOnStepOutput: true,
                },
              ],
            },
          ],
        }),
      },
    ],
    initialState: {
      projectId: 'project-pm-planner-kanban',
      managerDirective: {
        intent: 'Plan kanban-backed work',
        recommendedEmployees: ['emp-kanban-a', 'emp-kanban-b'],
      },
    },
    runs: [{ startAt: 'pm_planner' }],
    assertions: [
      {
        kind: 'kanbanCards',
        projectId: 'project-pm-planner-kanban',
        count: 3,
        origin: 'pm-planner',
        states: { todo: 3 },
      },
    ],
  });

  assert.equal(report.passed, true, JSON.stringify(report.assertions, null, 2));
});
