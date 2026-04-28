import assert from 'node:assert/strict';
import test from 'node:test';

const { yoloMasterNode } = await import(
  new URL('../../dist/agents/yolo-master-node.js', import.meta.url).href
);

test('yoloMasterNode throws a clear error when YOLO Master is missing', async () => {
  const runtimeCtx = {
    companyId: 'company-yolo',
    threadId: 'thread-yolo',
    repos: {
      employees: {
        findByRole: async () => [],
      },
    },
  };

  await assert.rejects(
    () =>
      yoloMasterNode(
        {
          threadId: 'thread-yolo',
          companyId: 'company-yolo',
          entryMode: 'boss_chat',
          interactionMode: 'yolo',
          messages: [],
          pendingAssignments: [],
        },
        { configurable: { runtimeCtx } },
      ),
    /YOLO Master employee not found/,
  );
});
