import assert from 'node:assert/strict';
import test from 'node:test';

const { assembleToolKit } = await import(
  new URL('../../dist/agents/employee-tool-kit.js', import.meta.url).href
);

const employee = {
  employee_id: 'employee-1',
  company_id: 'company-1',
  name: 'Engineer',
  role_slug: 'engineer',
  config_json: null,
};

function runtimeCtx() {
  return {
    companyId: 'company-1',
    repos: {
      employees: {
        findByCompany: async () => [employee],
      },
    },
    toolExecutor: {
      listAvailable: async () => [],
    },
  };
}

function preflight() {
  return {
    employee,
    isDirectChatTask: false,
  };
}

function toolNames(kit) {
  return kit.allTools.map((tool) => tool.name).sort();
}

test('todo tools are available in yolo mode', async () => {
  const kit = await assembleToolKit(preflight(), runtimeCtx(), {
    interactionMode: 'yolo',
    handoffCount: 0,
  });
  assert.deepEqual(
    toolNames(kit).filter((name) => name.startsWith('todo_')),
    ['todo_create', 'todo_list', 'todo_update'],
  );
});

test('todo tools are hidden in boss_proxy mode', async () => {
  const kit = await assembleToolKit(preflight(), runtimeCtx(), {
    interactionMode: 'boss_proxy',
    handoffCount: 0,
  });
  assert.equal(
    toolNames(kit).some((name) => name.startsWith('todo_')),
    false,
  );
});
