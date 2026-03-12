import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';

describe('EventBus error isolation', () => {
  it('continues dispatching when a handler throws', () => {
    const bus = new InMemoryEventBus();
    const handler1 = vi.fn(() => { throw new Error('boom'); });
    const handler2 = vi.fn();

    bus.on('test', handler1);
    bus.on('test', handler2);
    bus.emit({ type: 'test.event', payload: {}, timestamp: Date.now() } as any);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('reports handler errors via console.error', () => {
    const bus = new InMemoryEventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('test', () => { throw new Error('handler-fail'); });
    bus.emit({ type: 'test.event', payload: {}, timestamp: Date.now() } as any);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('EventBus handler error'),
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it('still cleans up once() subscriptions when handler throws', () => {
    const bus = new InMemoryEventBus();
    let callCount = 0;
    bus.once('test', () => {
      callCount++;
      throw new Error('once boom');
    });
    bus.emit({ type: 'test.event', payload: {}, timestamp: Date.now() } as any);
    bus.emit({ type: 'test.event', payload: {}, timestamp: Date.now() } as any);
    // once handler should only be called once despite throwing
    expect(callCount).toBe(1);
  });
});
