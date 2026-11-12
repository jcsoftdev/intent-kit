import { describe, expect, it } from 'vitest';
import {
  MISSING_IDEMPOTENCY_KEY,
  OUT_OF_SEQUENCE,
  createMarkReadyEffect,
  createOrdersCreateEffect,
} from '../src/effects.js';
import {
  FIXTURE_IDS,
  TENANT_ID,
  createRestaurantStore,
  seedKitchenLine,
} from '../src/restaurant.js';
import type { KitchenLineState, PlaygroundPrincipal } from '../src/restaurant.js';

const kitchen: PlaygroundPrincipal = {
  tenantId: TENANT_ID,
  userId: 'k-1',
  roles: ['kitchen'],
  activeRole: 'kitchen',
};

const waiter: PlaygroundPrincipal = {
  ...kitchen,
  userId: 'w-1',
  roles: ['waiter'],
  activeRole: 'waiter',
};

const signal = new AbortController().signal;

const markReadyOn = (state: KitchenLineState, principal = kitchen) => {
  const store = createRestaurantStore();
  const line = seedKitchenLine({
    index: 1,
    tableLabel: 'Mesa 3',
    waiterId: 'w-2',
    createdAt: 0,
    state,
  });
  store.addLine(line);
  const effect = createMarkReadyEffect({ store, principal: () => principal, now: () => 0 });
  return { store, run: () => effect.run({ lineIds: [line.id] }, { signal, planId: 'p-1' }) };
};

describe('kitchen.lines.markReady sequence', () => {
  it.each([
    ['EN_COLA', ['EN_COLA>PREPARANDO', 'PREPARANDO>LISTO']],
    ['PREPARANDO', ['PREPARANDO>LISTO']],
  ] as const)('moves a %s line through %j', async (state, expected) => {
    const { store, run } = markReadyOn(state);

    expect(await run()).toMatchObject({ ok: true });
    expect(store.transitions().map(({ from, to }) => `${from}>${to}`)).toEqual(expected);
  });

  it.each(['LISTO', 'SERVIDO'] as const)('refuses a %s line without writing', async (state) => {
    const { store, run } = markReadyOn(state);

    expect(await run()).toEqual({
      ok: false,
      failure: { stage: 'execution', code: 'CONFLICT', appCode: OUT_OF_SEQUENCE, retryable: false },
    });
    expect(store.transitions()).toEqual([]);
  });

  it('refuses a waiter touching a line of another waiter without writing', async () => {
    const { store, run } = markReadyOn('EN_COLA', waiter);

    expect(await run()).toMatchObject({ ok: false, failure: { code: 'UNAUTHORIZED' } });
    expect(store.transitions()).toEqual([]);
  });
});

describe('orders.create idempotency', () => {
  const input = {
    tableId: FIXTURE_IDS.tableSalon3,
    lines: [{ offeringId: FIXTURE_IDS.arrozConPollo, quantity: 1, modifiers: [] }],
  };

  it('returns the first order for a repeated key and creates one', async () => {
    const store = createRestaurantStore();
    const effect = createOrdersCreateEffect({ store, principal: () => waiter, now: () => 0 });
    const context = { signal, planId: 'p-1', idempotencyKey: 'key-1' };

    const first = await effect.run(input, context);
    const second = await effect.run(input, context);

    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect(store.orders(TENANT_ID)).toHaveLength(1);
  });

  it('fails without a key and writes nothing', async () => {
    const store = createRestaurantStore();
    const effect = createOrdersCreateEffect({ store, principal: () => waiter, now: () => 0 });

    const result = await effect.run(input, { signal, planId: 'p-1' });

    expect(result).toMatchObject({ ok: false, failure: { appCode: MISSING_IDEMPOTENCY_KEY } });
    expect(store.orders(TENANT_ID)).toEqual([]);
  });
});
