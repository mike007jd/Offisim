import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { RuntimeEvent } from '@aics/shared-types';

function makeEvent(type: string, overrides?: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    type,
    entityId: 'e-1',
    entityType: 'employee',
    companyId: 'c-1',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('InMemoryEventBus', () => {
  it('calls handler on matching prefix', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.on('employee.state', handler);
    bus.emit(makeEvent('employee.state.changed'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'employee.state.changed' }));
  });

  it('does not call handler on non-matching prefix', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.on('task.state', handler);
    bus.emit(makeEvent('employee.state.changed'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('empty prefix matches all events', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.on('', handler);
    bus.emit(makeEvent('employee.state.changed'));
    bus.emit(makeEvent('task.state.changed'));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes via returned function', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    const unsub = bus.on('employee', handler);
    bus.emit(makeEvent('employee.state.changed'));
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit(makeEvent('employee.state.changed'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('once only fires handler once', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.once('task', handler);
    bus.emit(makeEvent('task.state.changed'));
    bus.emit(makeEvent('task.state.changed'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removeAll clears all subscriptions', () => {
    const bus = new InMemoryEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('employee', h1);
    bus.on('task', h2);
    bus.removeAll();

    bus.emit(makeEvent('employee.state.changed'));
    bus.emit(makeEvent('task.state.changed'));

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('supports multiple handlers for same prefix', () => {
    const bus = new InMemoryEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('employee', h1);
    bus.on('employee', h2);
    bus.emit(makeEvent('employee.state.changed'));

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
