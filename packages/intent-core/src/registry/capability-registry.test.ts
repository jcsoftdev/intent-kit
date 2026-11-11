import { describe, expect, test } from 'vitest';
import { IntentFailureError } from '../contracts/index.js';
import type { AnyDescriptor, Effect, EffectLoader, StandardSchemaV1 } from '../contracts/index.js';
import { createCapabilityRegistry } from './capability-registry.js';

const passthroughSchema: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};

const ordersCreate: AnyDescriptor = {
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Create an order',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: passthroughSchema,
  output: passthroughSchema,
  entities: [{ path: 'tableId', entity: 'table' }],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: 5000 },
  idempotency: { kind: 'none' },
  roles: ['waiter', 'host'],
  destination: {
    default: { routeId: 'orders', params: { id: '{output.orderId}' } },
    byRole: { waiter: { routeId: 'myOrders', target: { intent: 'my-order', key: '{input.id}' } } },
  },
};

const signal = new AbortController().signal;
const effect: Effect<unknown, unknown> = { run: async () => ({ ok: true, output: null }) };
const loaderOf =
  (calls: { count: number }): EffectLoader =>
  async () => {
    calls.count += 1;
    return { default: effect };
  };

const kitchenReady: AnyDescriptor = {
  ...ordersCreate,
  id: 'kitchen.lines.markReady',
  roles: ['cook'],
};
const neverAgent: AnyDescriptor = {
  ...ordersCreate,
  id: 'cash.close',
  agent: 'never',
  roles: ['waiter'],
};

const failureOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof IntentFailureError ? error.failure : error),
  );

describe('capability registry', () => {
  test('register twice with the same id throws DUPLICATE_ID', () => {
    const registry = createCapabilityRegistry();
    registry.register(ordersCreate);
    expect(() => registry.register(ordersCreate)).toThrowError(
      expect.objectContaining({ reason: 'DUPLICATE_ID' }),
    );
  });

  test('unregister then register again succeeds; get returns the new descriptor', () => {
    const registry = createCapabilityRegistry();
    const unregister = registry.register(ordersCreate);
    unregister();
    unregister();
    expect(registry.get('orders.create')).toBeUndefined();
    const replacement = { ...ordersCreate, version: 2 };
    registry.register(replacement);
    expect(registry.get('orders.create')).toBe(replacement);
  });

  test('a stale unregister does not remove a newer registration', () => {
    const registry = createCapabilityRegistry();
    const first = registry.register(ordersCreate);
    first();
    registry.register(ordersCreate);
    first();
    expect(registry.get('orders.create')).toBeDefined();
  });

  test('discover({ role: "waiter", exposures: ["allowed"] }) excludes a never capability and a kitchen-only capability', () => {
    const registry = createCapabilityRegistry();
    registry.register(ordersCreate);
    registry.register(kitchenReady);
    registry.register(neverAgent);
    const ids = registry.discover({ role: 'waiter', exposures: ['allowed'] }).map((d) => d.id);
    expect(ids).toEqual(['orders.create']);
  });

  test('discover without filter keys keeps registration order', () => {
    const registry = createCapabilityRegistry();
    registry.register(kitchenReady);
    registry.register(ordersCreate);
    expect(registry.discover({}).map((d) => d.id)).toEqual([
      'kitchen.lines.markReady',
      'orders.create',
    ]);
    expect(registry.discover({ scopes: ['route'] })).toEqual([]);
  });

  test('loadEffect calls the loader once for two concurrent calls', async () => {
    const registry = createCapabilityRegistry();
    const calls = { count: 0 };
    registry.register(ordersCreate, loaderOf(calls));
    const [a, b] = await Promise.all([
      registry.loadEffect('orders.create', { signal }),
      registry.loadEffect('orders.create', { signal }),
    ]);
    await registry.loadEffect('orders.create', { signal });
    expect(a).toBe(effect);
    expect(b).toBe(effect);
    expect(calls.count).toBe(1);
  });

  test('a failed load is retried on the next call', async () => {
    const registry = createCapabilityRegistry();
    let attempts = 0;
    registry.register(ordersCreate, async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('network');
      }
      return { default: effect };
    });
    expect(await failureOf(registry.loadEffect('orders.create', { signal }))).toEqual({
      stage: 'execution',
      code: 'EXECUTION_FAILED',
      retryable: true,
    });
    expect(await registry.loadEffect('orders.create', { signal })).toBe(effect);
    expect(attempts).toBe(2);
  });

  test('loadEffect on an unregistered id rejects with CAPABILITY_NOT_FOUND', async () => {
    const registry = createCapabilityRegistry();
    expect(await failureOf(registry.loadEffect('ghost.id', { signal }))).toEqual({
      stage: 'execution',
      code: 'CAPABILITY_NOT_FOUND',
      retryable: false,
    });
  });

  test('loadEffect without a loader rejects with a non-retryable EXECUTION_FAILED', async () => {
    const registry = createCapabilityRegistry();
    registry.register(ordersCreate);
    expect(await failureOf(registry.loadEffect('orders.create', { signal }))).toEqual({
      stage: 'execution',
      code: 'EXECUTION_FAILED',
      retryable: false,
    });
  });

  test('an aborted signal rejects with its reason without invoking the loader', async () => {
    const registry = createCapabilityRegistry();
    const calls = { count: 0 };
    registry.register(ordersCreate, loaderOf(calls));
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      registry.loadEffect('orders.create', { signal: controller.signal }),
    ).rejects.toThrow('stop');
    expect(calls.count).toBe(0);
  });

  test('unregister drops the cached effect', async () => {
    const registry = createCapabilityRegistry();
    const calls = { count: 0 };
    const unregister = registry.register(ordersCreate, loaderOf(calls));
    await registry.loadEffect('orders.create', { signal });
    unregister();
    registry.register(ordersCreate, loaderOf(calls));
    await registry.loadEffect('orders.create', { signal });
    expect(calls.count).toBe(2);
  });

  test('loadEffect rejects with signal.reason when aborted while the load is in flight', async () => {
    const registry = createCapabilityRegistry();
    let finish: () => void = () => undefined;
    registry.register(
      ordersCreate,
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ default: effect });
        }),
    );
    const controller = new AbortController();
    const aborting = registry.loadEffect('orders.create', { signal: controller.signal });
    const other = registry.loadEffect('orders.create', { signal });
    controller.abort(new Error('stop'));
    await expect(aborting).rejects.toThrow('stop');
    finish();
    expect(await other).toBe(effect);
  });
});
