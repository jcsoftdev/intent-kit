import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  IntentDefinitionError,
  IntentFailureError,
  createEventBus,
  type IntentEvent,
} from '@jcsoftdev/intent-core';
import { createDomTargetRegistry } from './target-registry.js';

const button = { role: 'button', requireName: true } as const;
const ref = { intent: 'orders.open', key: '12' };

const element = (html: string): Element => {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.append(holder);
  return holder.firstElementChild as Element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

test('registering the same intent and key twice throws DUPLICATE_TARGET and keeps the first', () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const first = element('<button>One</button>');
  registry.register(ref, first, button);
  expect(() => registry.register(ref, element('<button>Two</button>'), button)).toThrow(
    expect.objectContaining({ reason: 'DUPLICATE_TARGET' }),
  );
  expect(() => registry.register(ref, first, button)).toThrow(IntentDefinitionError);
  expect(registry.find(ref)).toBe(first);
});

test('unregister removes the target', () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const unregister = registry.register(ref, element('<button>One</button>'), button);
  unregister();
  expect(registry.find(ref)).toBeUndefined();
});

test('a stale unregister does not remove a newer registration', () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const unregister = registry.register(ref, element('<button>One</button>'), button);
  unregister();
  const next = element('<button>Two</button>');
  registry.register(ref, next, button);
  unregister();
  expect(registry.find(ref)).toBe(next);
});

test('the same intent with different keys are distinct targets', () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const one = element('<button>One</button>');
  const two = element('<button>Two</button>');
  registry.register({ intent: 'orders.open', key: '1' }, one, button);
  registry.register({ intent: 'orders.open', key: '2' }, two, button);
  expect(registry.find({ intent: 'orders.open', key: '2' })).toBe(two);
});

test('waitFor resolves immediately for an already registered target', async () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const mounted = element('<button>One</button>');
  registry.register(ref, mounted, button);
  await expect(
    registry.waitFor(ref, { signal: new AbortController().signal, timeoutMs: 1000 }),
  ).resolves.toBe(mounted);
});

test('waitFor resolves when the element mounts later, through a MutationObserver', async () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const mounted = element('<button>One</button>');
  const waiting = registry.waitFor(ref, { signal: new AbortController().signal, timeoutMs: 1000 });
  registry.register(ref, mounted, button);
  await expect(waiting).resolves.toBe(mounted);
});

test('waitFor re-checks on DOM mutations', async () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const mounted = element('<button>One</button>');
  const stash = vi.spyOn(Map.prototype, 'get');
  const waiting = registry.waitFor(ref, { signal: new AbortController().signal, timeoutMs: 1000 });
  const before = stash.mock.calls.length;
  document.body.append(document.createElement('span'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stash.mock.calls.length).toBeGreaterThan(before);
  stash.mockRestore();
  registry.register(ref, mounted, button);
  await expect(waiting).resolves.toBe(mounted);
});

test('waitFor rejects with the abort reason', async () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  const controller = new AbortController();
  const waiting = registry.waitFor(ref, { signal: controller.signal, timeoutMs: 1000 });
  const reason = new Error('stop');
  controller.abort(reason);
  await expect(waiting).rejects.toBe(reason);
});

test('waitFor with an already aborted signal rejects with its reason', async () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  await expect(
    registry.waitFor(ref, { signal: AbortSignal.abort('gone'), timeoutMs: 1000 }),
  ).rejects.toBe('gone');
});

test('waitFor rejects TARGET_NOT_FOUND at timeoutMs', async () => {
  vi.useFakeTimers();
  const registry = createDomTargetRegistry({ mode: 'test' });
  const waiting = registry.waitFor(ref, { signal: new AbortController().signal, timeoutMs: 500 });
  const settled = expect(waiting).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof IntentFailureError && error.failure.code === 'TARGET_NOT_FOUND',
  );
  vi.advanceTimersByTime(500);
  await settled;
});

test('a role mismatch throws SEMANTICS_VIOLATION in test mode and only emits the event in production mode', () => {
  const events = createEventBus<IntentEvent>();
  const seen: IntentEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const wrong = element('<div>Not a button</div>');

  const testRegistry = createDomTargetRegistry({ mode: 'test', events });
  expect(() => testRegistry.register(ref, wrong, button)).toThrow(
    expect.objectContaining({ failure: expect.objectContaining({ code: 'SEMANTICS_VIOLATION' }) }),
  );
  expect(testRegistry.find(ref)).toBeUndefined();

  const productionRegistry = createDomTargetRegistry({ mode: 'production', events });
  expect(() => productionRegistry.register(ref, wrong, button)).not.toThrow();
  expect(productionRegistry.find(ref)).toBe(wrong);
  expect(seen).toEqual([
    { type: 'semantics.violation', intent: 'orders.open', key: '12', expected: button },
    { type: 'semantics.violation', intent: 'orders.open', key: '12', expected: button },
  ]);
});

test('a missing accessible name violates requireName', () => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  expect(() => registry.register(ref, element('<button></button>'), button)).toThrow(
    IntentFailureError,
  );
  expect(() =>
    registry.register(ref, element('<button></button>'), { role: 'button', requireName: false }),
  ).not.toThrow();
});

test.each([
  ['<a href="/x">Go</a>', 'link'],
  ['<input type="checkbox" aria-label="c">', 'checkbox'],
  ['<input aria-label="t">', 'textbox'],
  ['<div role="tab">Tab</div>', 'tab'],
])('%s has role %s', (html, role) => {
  const registry = createDomTargetRegistry({ mode: 'test' });
  expect(() => registry.register(ref, element(html), { role, requireName: true })).not.toThrow();
});
