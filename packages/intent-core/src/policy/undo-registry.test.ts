import { expect, test } from 'vitest';
import type { EffectResult, IntentEvent, UndoOffer } from '../contracts/index.js';
import { createEventBus, createManualClock } from '../primitives/index.js';
import { createUndoRegistry } from './undo-registry.js';

const signal = new AbortController().signal;

const setup = () => {
  const clock = createManualClock(1000);
  const events = createEventBus<IntentEvent>();
  const seen: string[] = [];
  events.subscribe((event) => seen.push(event.type));
  const registry = createUndoRegistry({ clock, events });
  const calls = { count: 0 };
  const result: EffectResult<unknown> = { ok: true, output: null };
  const offer = (planId = 'p1'): UndoOffer => ({
    planId,
    capabilityId: 'orders.create',
    kind: 'compensate',
    expiresAt: clock.now() + 5000,
    undo: async () => {
      calls.count += 1;
      return result;
    },
  });
  return { clock, registry, seen, calls, offer };
};

const stale = {
  ok: false,
  failure: { stage: 'execution', code: 'STALE_PLAN', retryable: false },
};

test('offer is listed as active and emits undo.offered', () => {
  const { registry, seen, offer } = setup();
  registry.offer(offer());
  expect(registry.active()).toEqual([
    { planId: 'p1', capabilityId: 'orders.create', kind: 'compensate', expiresAt: 6000 },
  ]);
  expect(seen).toEqual(['undo.offered']);
});

test('undo after the window (advance windowMs) → STALE_PLAN and undo.expired emitted once', async () => {
  const { clock, registry, seen, calls, offer } = setup();
  registry.offer(offer());
  await clock.advance(5000);
  expect(await registry.undo('p1', { signal })).toEqual(stale);
  expect(registry.active()).toEqual([]);
  expect(seen.filter((type) => type === 'undo.expired')).toHaveLength(1);
  expect(calls.count).toBe(0);
});

test('active() drops expired entries and emits undo.expired once per entry', async () => {
  const { clock, registry, seen, offer } = setup();
  registry.offer(offer('p1'));
  registry.offer(offer('p2'));
  await clock.advance(6000);
  expect(registry.active()).toEqual([]);
  expect(registry.active()).toEqual([]);
  expect(seen.filter((type) => type === 'undo.expired')).toHaveLength(2);
});

test('undo inside the window runs the offer once and removes it', async () => {
  const { clock, registry, seen, calls, offer } = setup();
  registry.offer(offer());
  await clock.advance(1000);
  const [first, second] = await Promise.all([
    registry.undo('p1', { signal }),
    registry.undo('p1', { signal }),
  ]);
  expect(first).toEqual({ ok: true, output: null });
  expect(second).toEqual(first);
  expect(calls.count).toBe(1);
  expect(registry.active()).toEqual([]);
  expect(await registry.undo('p1', { signal })).toEqual(stale);
  expect(seen).toEqual(['undo.offered', 'undo.executed']);
});

test('undo of an unknown plan resolves STALE_PLAN', async () => {
  const { registry } = setup();
  expect(await registry.undo('ghost', { signal })).toEqual(stale);
});

test('a failed undo keeps the entry so it can be retried', async () => {
  const { registry, seen, offer } = setup();
  const failure = { stage: 'execution', code: 'EXECUTION_FAILED', retryable: true } as const;
  registry.offer({ ...offer(), undo: async () => ({ ok: false, failure }) });
  expect(await registry.undo('p1', { signal })).toEqual({ ok: false, failure });
  expect(registry.active()).toHaveLength(1);
  expect(seen).toEqual(['undo.offered']);
});

test('the Unregister removes the entry and is idempotent', () => {
  const { registry, offer } = setup();
  const unregister = registry.offer(offer());
  unregister();
  unregister();
  expect(registry.active()).toEqual([]);
});
