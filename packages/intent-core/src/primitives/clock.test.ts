import { describe, expect, test, vi } from 'vitest';
import { createManualClock, systemClock } from './clock.js';

describe('manual clock', () => {
  test('delay resolves only after advance reaches its deadline', async () => {
    const clock = createManualClock();
    const settled = vi.fn();
    const pending = clock.delay(100, { signal: new AbortController().signal }).then(settled);
    await clock.advance(99);
    expect(settled).not.toHaveBeenCalled();
    await clock.advance(1);
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(100);
    expect(clock.pending()).toBe(0);
  });

  test('timeout aborts with a TimeoutError after advance', async () => {
    const clock = createManualClock();
    const signal = clock.timeout(50);
    await clock.advance(49);
    expect(signal.aborted).toBe(false);
    await clock.advance(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
  });

  test('timers fire in deadline order', async () => {
    const clock = createManualClock();
    const order: number[] = [];
    const signal = new AbortController().signal;
    const slow = clock.delay(30, { signal }).then(() => order.push(30));
    const fast = clock.delay(10, { signal }).then(() => order.push(10));
    await clock.advance(30);
    await Promise.all([slow, fast]);
    expect(order).toEqual([10, 30]);
  });

  test('an aborted delay rejects with the reason and removes its timer', async () => {
    const clock = createManualClock();
    const controller = new AbortController();
    const pending = clock.delay(100, { signal: controller.signal });
    expect(clock.pending()).toBe(1);
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    expect(clock.pending()).toBe(0);
  });

  test('a delay started on an aborted signal rejects immediately', async () => {
    const clock = createManualClock();
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(clock.delay(5, { signal: controller.signal })).rejects.toThrow('early');
    expect(clock.pending()).toBe(0);
  });

  test('a timer scheduled while advancing fires within the same advance', async () => {
    const clock = createManualClock();
    const signal = new AbortController().signal;
    const fired = vi.fn();
    const chained = clock
      .delay(10, { signal })
      .then(() => clock.delay(10, { signal }))
      .then(fired);
    await clock.advance(20);
    await chained;
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

describe('system clock', () => {
  test('delay resolves and rejects with the signal reason', async () => {
    await systemClock.delay(1, { signal: new AbortController().signal });
    const controller = new AbortController();
    const pending = systemClock.delay(1000, { signal: controller.signal });
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    expect(typeof systemClock.now()).toBe('number');
  });
});
