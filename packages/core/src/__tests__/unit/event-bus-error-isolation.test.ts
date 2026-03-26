import type { RuntimeEvent } from '@aics/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { type LogEntry, resetLogHandler, setLogHandler } from '../../services/logger.js';

function makeTestEvent(): RuntimeEvent {
  return {
    type: 'test.event',
    entityId: 'entity-1',
    entityType: 'task',
    companyId: 'company-1',
    timestamp: Date.now(),
    payload: {},
  };
}

describe('EventBus error isolation', () => {
  afterEach(() => {
    resetLogHandler();
  });

  it('continues dispatching when a handler throws', () => {
    setLogHandler(() => {}); // suppress log output in test
    const bus = new InMemoryEventBus();
    const handler1 = vi.fn(() => {
      throw new Error('boom');
    });
    const handler2 = vi.fn();

    bus.on('test', handler1);
    bus.on('test', handler2);
    bus.emit(makeTestEvent());

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('reports handler errors via Logger', () => {
    const logged: LogEntry[] = [];
    setLogHandler((entry) => logged.push(entry));

    const bus = new InMemoryEventBus();
    bus.on('test', () => {
      throw new Error('handler-fail');
    });
    bus.emit(makeTestEvent());

    expect(logged).toHaveLength(1);
    expect(logged[0]?.level).toBe('error');
    expect(logged[0]?.category).toBe('event-bus');
    expect(logged[0]?.message).toContain('Handler error');
  });

  it('still cleans up once() subscriptions when handler throws', () => {
    setLogHandler(() => {}); // suppress log output in test
    const bus = new InMemoryEventBus();
    let callCount = 0;
    bus.once('test', () => {
      callCount++;
      throw new Error('once boom');
    });
    bus.emit(makeTestEvent());
    bus.emit(makeTestEvent());
    // once handler should only be called once despite throwing
    expect(callCount).toBe(1);
  });
});
