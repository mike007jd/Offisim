import { beforeAll, expect, it } from 'vitest';
import { createAiRuntime, describeIfMinimax, requireMinimaxKey } from './harness.js';

describeIfMinimax('Phase 0 - runtime smoke [AI]', () => {
  beforeAll(() => {
    requireMinimaxKey();
  });

  it('instantiates the runtime and returns a non-empty employee reply', async () => {
    const { runSmokeTask } = createAiRuntime();
    const reply = await runSmokeTask(
      'Write one concise sentence saying the employee runtime smoke test is online.',
    );
    expect(reply.trim().length).toBeGreaterThan(0);
  }, 60_000);
});
