import assert from 'node:assert/strict';
import test from 'node:test';

const { InMemoryEventBus } = await import(
  new URL('../../../dist/events/event-bus.js', import.meta.url).href
);
const { createMemoryRepositories } = await import(
  new URL('../../../dist/runtime/memory-repositories.js', import.meta.url).href
);

test('KanbanRepo creates, transitions, lists, and emits events', async () => {
  const eventBus = new InMemoryEventBus();
  const events = [];
  eventBus.on('kanban.', (event) => events.push(event));
  const repos = createMemoryRepositories(undefined, undefined, eventBus);

  const card = await repos.kanban.create({
    id: 'card-1',
    project_id: 'project-1',
    company_id: 'company-1',
    title: 'Build counter',
    note: 'Use tests',
    origin: 'pm-planner',
    assigned_employee_id: 'employee-1',
    task_run_id: 'task-run-1',
  });
  assert.equal(card.state, 'todo');

  const blocked = await repos.kanban.transition(card.id, 'blocked', 'Waiting on fixture');
  assert.equal(blocked?.blocked_reason, 'Waiting on fixture');

  const projectCards = await repos.kanban.listByProject('project-1');
  assert.equal(projectCards.length, 1);
  assert.equal(projectCards[0]?.id, 'card-1');

  const employeeCards = await repos.kanban.listByEmployee('employee-1', 'blocked');
  assert.equal(employeeCards.length, 1);

  await repos.kanban.transitionByTaskRun('task-run-1', 'done');
  const doneCards = await repos.kanban.listByEmployee('employee-1', 'done');
  assert.equal(doneCards.length, 1);
  assert.equal(doneCards[0]?.blocked_reason, null);

  await repos.kanban.create({
    id: 'card-2',
    project_id: 'project-1',
    company_id: 'company-1',
    title: 'Needs review',
    origin: 'pm-planner',
    assigned_employee_id: 'employee-1',
    task_run_id: 'task-run-2',
  });
  await repos.kanban.transitionByTaskRun('task-run-2', 'review', 'Needs real evidence');
  const reviewCards = await repos.kanban.listByEmployee('employee-1', 'review');
  assert.equal(reviewCards.length, 1);
  assert.equal(reviewCards[0]?.blocked_reason, 'Needs real evidence');

  assert.deepEqual(
    events.map((event) => event.payload.op),
    ['created', 'transitioned', 'transitioned', 'created', 'transitioned'],
  );
});
