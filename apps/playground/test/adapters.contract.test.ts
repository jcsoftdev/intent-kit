import { createManualClock } from '@jcsoftdev/intent-core';
import type { InterpretRequest } from '@jcsoftdev/intent-core';
import { SPANISH_NORMALIZATION, createNormalizer } from '@jcsoftdev/intent-server';
import {
  describeEffectContract,
  describeEntityResolverContract,
  describeInterpreterContract,
  describeRouterAdapterContract,
} from '@jcsoftdev/intent-testing/contracts';
import { createKeywordInterpreter, createMemoryRouter } from '../src/index.js';
import { createOrdersCreateEffect } from '../src/effects.js';
import {
  FIXTURE_IDS,
  FOREIGN_TENANT_ID,
  TENANT_ID,
  createRestaurantStore,
} from '../src/restaurant.js';
import type { PlaygroundPrincipal, PlaygroundRouteId } from '../src/restaurant.js';
import { createPlaygroundResolvers } from '../src/resolvers.js';

const waiter: PlaygroundPrincipal = {
  tenantId: TENANT_ID,
  userId: 'w-1',
  roles: ['waiter'],
  activeRole: 'waiter',
};

const foreignWaiter: PlaygroundPrincipal = { ...waiter, tenantId: FOREIGN_TENANT_ID };

describeRouterAdapterContract<PlaygroundRouteId>('memory router', () => ({
  router: createMemoryRouter(),
  first: { routeId: 'salon' },
  second: { routeId: 'myOrders', params: { floor: '1' } },
}));

const request: InterpretRequest = {
  text: 'pedido de arroz con pollo para la mesa 3',
  locale: 'es-PE',
  source: 'text',
  catalog: [
    {
      id: 'orders.create',
      description: 'Crear un pedido para una mesa',
      aliases: ['pedido'],
      examples: [],
      inputJsonSchema: {
        type: 'object',
        properties: { tableId: { type: 'string' }, lines: { type: 'array' } },
      },
    },
  ],
  context: {},
};

describeInterpreterContract('keyword interpreter', () => ({
  interpreter: createKeywordInterpreter(),
  request,
}));

const dishResolver = () => {
  const store = createRestaurantStore();
  const resolver = createPlaygroundResolvers({
    store,
    clock: createManualClock(),
    normalize: createNormalizer(SPANISH_NORMALIZATION),
  }).find(({ entity }) => entity === 'dish');
  if (!resolver) {
    throw new Error('the dish resolver is missing');
  }
  return { store, resolver };
};

describeEntityResolverContract<PlaygroundPrincipal>('dish resolver', () => {
  const { store, resolver } = dishResolver();
  const hiddenIds = store.dishes(TENANT_ID).map(({ id }) => id);
  return {
    resolver,
    principal: waiter,
    exact: { text: 'Arroz con pollo', variant: 'ARRÓZ CON POLLO', id: FIXTURE_IDS.arrozConPollo },
    ambiguous: { text: 'i', ids: [FIXTURE_IDS.incaKola, FIXTURE_IDS.injection] },
    unknown: 'pizza',
    options: {
      path: 'lines[0].offeringId',
      draft: { capabilityId: 'orders.create', version: 1, input: {} },
      ids: hiddenIds,
    },
    foreign: { principal: foreignWaiter, hiddenIds },
  };
});

describeEffectContract('orders.create effect', () => {
  const store = createRestaurantStore();
  return {
    effect: createOrdersCreateEffect({ store, principal: () => waiter, now: () => 0 }),
    input: {
      tableId: FIXTURE_IDS.tableSalon7,
      lines: [{ offeringId: FIXTURE_IDS.arrozConPollo, quantity: 1, modifiers: [] }],
    },
    sideEffects: () => store.orders(TENANT_ID).length,
  };
});
