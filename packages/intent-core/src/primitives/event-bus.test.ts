import { describe, expect, test, vi } from 'vitest';
import { createEventBus } from './event-bus.js';

interface Ping {
  readonly type: 'ping';
}

describe('event bus', () => {
  test('a throwing listener does not prevent the second listener from receiving the event', () => {
    const bus = createEventBus<Ping>();
    const second = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(second);
    expect(() => bus.emit({ type: 'ping' })).not.toThrow();
    expect(second).toHaveBeenCalledWith({ type: 'ping' });
  });

  test('unsubscribing stops delivery', () => {
    const bus = createEventBus<Ping>();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    unsubscribe();
    bus.emit({ type: 'ping' });
    expect(listener).not.toHaveBeenCalled();
  });
});
