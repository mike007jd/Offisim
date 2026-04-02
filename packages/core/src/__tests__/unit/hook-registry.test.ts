import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HookRegistry } from '../../runtime/hook-registry.js';

describe('HookRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs registered hooks for a matching event', async () => {
    const registry = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register({
      event: 'task.assigned',
      name: 'assigned-hook',
      handler,
    });

    await registry.emit('task.assigned', { threadId: 'thread-1' });

    expect(handler).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });

  it('supports unregistering hooks', async () => {
    const registry = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(undefined);
    const unregister = registry.register({
      event: 'task.completed',
      name: 'completed-hook',
      handler,
    });

    unregister();
    await registry.emit('task.completed', { threadId: 'thread-1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates hook failures', async () => {
    const registry = new HookRegistry();
    const okHandler = vi.fn().mockResolvedValue(undefined);
    registry.register({
      event: 'graph.node.after',
      name: 'bad-hook',
      handler: vi.fn().mockRejectedValue(new Error('boom')),
    });
    registry.register({
      event: 'graph.node.after',
      name: 'ok-hook',
      handler: okHandler,
    });

    await registry.emit('graph.node.after', { nodeName: 'manager' });

    expect(okHandler).toHaveBeenCalledWith({ nodeName: 'manager' });
  });

  it('times out slow hooks without blocking the emit call forever', async () => {
    const registry = new HookRegistry();
    const slowHandler = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 20_000)));
    registry.register({
      event: 'interaction.created',
      name: 'slow-hook',
      handler: slowHandler,
      timeout: 50,
    });

    const emitPromise = registry.emit('interaction.created', { interactionId: 'ix-1' });
    await vi.advanceTimersByTimeAsync(60);
    await emitPromise;

    expect(slowHandler).toHaveBeenCalled();
  });
});
