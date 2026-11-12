import { createFakeFormBinding } from '@jcsoftdev/intent-testing';
import type { IntentSession, SessionState } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';
import { createPlayground } from '../src/index.js';
import { FIXTURE_IDS, TENANT_ID, TERRACE_TABLE } from '../src/restaurant.js';
import type { PlaygroundPrincipal } from '../src/restaurant.js';

const waiter: PlaygroundPrincipal = {
  tenantId: TENANT_ID,
  userId: 'w-1',
  roles: ['waiter'],
  activeRole: 'waiter',
};

const ARTICLE = { role: 'article', requireName: true } as const;

const trackStates = (session: IntentSession): readonly string[] => {
  const names: string[] = [];
  session.subscribe((state) => {
    if (names.at(-1) !== state.name) {
      names.push(state.name);
    }
  });
  return names;
};

const completedResult = (state: SessionState) => {
  if (state.name !== 'completed') {
    throw new Error(`expected completed, got ${state.name}`);
  }
  return state.result;
};

const clarificationOf = (state: SessionState) => {
  if (state.name !== 'clarifying') {
    throw new Error(`expected clarifying, got ${state.name}`);
  }
  return state.interpretation;
};

const optionLabels = (state: SessionState): readonly string[] => {
  const interpretation = clarificationOf(state);
  if (interpretation.status === 'incomplete') {
    return (interpretation.missing[0]?.options ?? []).map(({ label }) => label);
  }
  return interpretation.candidates.flatMap((candidate) =>
    candidate.kind === 'entity' ? [`${candidate.option.label} · ${candidate.option.detail}`] : [],
  );
};

describe('9.1 A: a complete deterministic order', () => {
  it('runs the whole pipeline without the interpreter and reveals the new order', async () => {
    const playground = createPlayground({ principal: waiter });
    const states = trackStates(playground.session);

    const state = await playground.session.submit({
      text: 'Haz un pedido de arroz con pollo para la mesa 3',
      source: 'text',
    });

    const result = completedResult(state);
    expect(states).toEqual(['interpreting', 'executing', 'presenting', 'completed']);
    expect(playground.interpreter.calls()).toHaveLength(0);
    expect(playground.router.navigations().map(({ routeId }) => routeId)).toEqual(['myOrders']);
    const [order] = playground.store.orders(TENANT_ID);
    expect(playground.store.orders(TENANT_ID)).toHaveLength(1);
    expect(order?.idempotencyKey).toBe(result.planId);
    expect(order?.total).toBe(28);
    expect(order?.tableId).toBe(FIXTURE_IDS.tableSalon3);
    expect(playground.revealer.revealed().map(({ element }) => element.id)).toEqual([
      `my-order:${order?.id}`,
    ]);
    expect(playground.announcer.messages()).toEqual([
      { message: 'Pedido enviado a cocina · Mesa 3', politeness: 'polite' },
    ]);
  });
});

describe('9.1 B: a dish with a required side', () => {
  it('asks for the side, accepts a text answer and navigates once', async () => {
    const playground = createPlayground({ principal: waiter });

    const asked = await playground.session.submit({
      text: 'pedido de lomo saltado para la mesa 3',
      source: 'text',
    });
    expect(optionLabels(asked)).toEqual(['Papas fritas', 'Ensalada', 'Yuca']);

    const state = await playground.session.answerByText('con yuca');

    completedResult(state);
    const [order] = playground.store.orders(TENANT_ID);
    expect(order?.total).toBe(34);
    expect(playground.router.navigations()).toHaveLength(1);
    expect(playground.interpreter.calls()).toHaveLength(0);
  });

  it('fills a mounted manual-order form instead of calling the effect, and navigates once', async () => {
    const orderId = 'order-from-form';
    const playground = createPlayground({ principal: waiter, route: 'newOrder' });
    const fills: unknown[] = [];
    const binding = createFakeFormBinding<{ tableId: string; lines: unknown[] }>({
      formId: 'manual-order',
      required: ['tableId', 'lines'],
      submit: () => ({
        ok: true,
        output: { orderId, serviceNumber: 1, total: 34, tableLabel: 'Mesa 3' },
      }),
    });
    playground.forms.register(
      {
        ...binding,
        fill: (patch) => {
          fills.push(patch);
          return binding.fill(patch);
        },
      },
      'newOrder',
    );
    playground.targets.register(
      { intent: 'my-order', key: orderId },
      { id: `my-order:${orderId}`, role: 'article', name: 'Pedido 1 · Mesa 3' },
      ARTICLE,
    );

    await playground.session.submit({
      text: 'pedido de lomo saltado para la mesa 3',
      source: 'text',
    });
    const state = await playground.session.answerByText('con yuca');

    completedResult(state);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      tableId: FIXTURE_IDS.tableSalon3,
      lines: [{ offeringId: FIXTURE_IDS.lomoSaltado, modifiers: [FIXTURE_IDS.yuca] }],
    });
    expect(binding.submitted()).toBe(1);
    expect(playground.store.orders(TENANT_ID)).toHaveLength(0);
    expect(playground.router.navigations().map(({ routeId }) => routeId)).toEqual(['myOrders']);
  });
});

describe('ambiguity and typos', () => {
  it('asks which zone when the table number exists in two zones', async () => {
    const playground = createPlayground({ principal: waiter });
    playground.store.addTable(TERRACE_TABLE);

    const state = await playground.session.submit({
      text: 'pedido de arroz con pollo para la mesa 3',
      source: 'text',
    });

    expect(optionLabels(state).toSorted()).toEqual(['Mesa 3 · Salón', 'Mesa 3 · Terraza']);
    expect(playground.store.orders(TENANT_ID)).toHaveLength(0);
  });

  it.each([
    ['terraza', FIXTURE_IDS.tableTerrace3],
    ['salón', FIXTURE_IDS.tableSalon3],
  ])('places the order on the zone answered by text: %s', async (answer, tableId) => {
    const playground = createPlayground({ principal: waiter });
    playground.store.addTable(TERRACE_TABLE);
    await playground.session.submit({
      text: 'pedido de arroz con pollo para la mesa 3',
      source: 'text',
    });

    const state = await playground.session.answerByText(answer);

    completedResult(state);
    expect(playground.store.orders(TENANT_ID).map((order) => order.tableId)).toEqual([tableId]);
  });

  it('offers the nearest dish for a misspelled one', async () => {
    const playground = createPlayground({ principal: waiter });

    const state = await playground.session.submit({
      text: 'pedido de arroz con polo para la mesa 3',
      source: 'text',
    });

    expect(optionLabels(state)).toEqual(['Arroz con pollo · quedan 8']);
  });

  it('finds Tres leches although the normalizer rewrites the number words', async () => {
    const playground = createPlayground({ principal: waiter });

    const state = await playground.session.submit({
      text: 'un tres leches para la mesa tres',
      source: 'text',
    });

    completedResult(state);
    expect(playground.store.lines(TENANT_ID).map(({ dishName }) => dishName)).toEqual([
      'Tres leches',
    ]);
    expect(playground.store.orders(TENANT_ID).map(({ total }) => total)).toEqual([14]);
  });

  it.each([
    ['tres leches para la mesa 3', 14],
    ['un tres leches para la mesa 3', 14],
    ['pedido de un arroz con pollo para la mesa 3', 28],
    ['dos arroz con pollo para la mesa 3', 56],
  ])('orders %j for a total of %i', async (text, total) => {
    const playground = createPlayground({ principal: waiter });

    const state = await playground.session.submit({ text, source: 'text' });

    completedResult(state);
    expect(playground.store.orders(TENANT_ID).map((order) => order.total)).toEqual([total]);
  });

  it('keeps a spoken quantity in front of a dish whose name starts with a number word', async () => {
    const playground = createPlayground({ principal: waiter });

    const state = await playground.session.submit({
      text: 'dos tres leches para la mesa 3',
      source: 'text',
    });

    completedResult(state);
    expect(playground.store.orders(TENANT_ID).map(({ total }) => total)).toEqual([28]);
  });
});

describe('the keyword interpreter', () => {
  it('handles an utterance no pattern matches and reports the interpreter as the source', async () => {
    const playground = createPlayground({ principal: waiter });

    const state = await playground.session.submit({
      text: 'mándale un arroz con pollo a la mesa 3',
      source: 'text',
    });

    completedResult(state);
    const [order] = playground.store.orders(TENANT_ID);
    expect(order?.total).toBe(28);
    expect(order?.tableId).toBe(FIXTURE_IDS.tableSalon3);
    expect(playground.interpreter.calls()).toHaveLength(1);
    expect(playground.events.events()).toContainEqual(
      expect.objectContaining({
        type: 'interpretation.settled',
        status: 'complete',
        origin: 'interpreter',
      }),
    );
  });

  it('asks for the dish at the first line when the utterance names none, and completes on a text answer', async () => {
    const playground = createPlayground({ principal: waiter });

    const asked = await playground.session.submit({
      text: 'mándale algo a la mesa 3',
      source: 'text',
    });

    const interpretation = clarificationOf(asked);
    expect(interpretation.status === 'incomplete' && interpretation.missing[0]?.path).toBe(
      'lines[0].offeringId',
    );
    expect(optionLabels(asked)).toContain('Arroz con pollo');

    const state = await playground.session.answerByText('arroz con pollo');

    completedResult(state);
    const [order] = playground.store.orders(TENANT_ID);
    expect(order?.total).toBe(28);
    expect(order?.tableId).toBe(FIXTURE_IDS.tableSalon3);
  });
});
