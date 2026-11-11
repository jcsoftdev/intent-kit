import { foldText, type InterpretRequest } from '@jcsoftdev/intent-core';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';
import { z } from 'zod';
import {
  describeEffectContract,
  describeEntityResolverContract,
  describeInterpreterContract,
  describeRouterAdapterContract,
  describeSchemaAdapterContract,
  describeSpeechSourceContract,
} from './contracts/index.js';
import {
  createFakeEffect,
  createFakeInterpreter,
  createFakeRouter,
  createFakeSpeechSource,
  createInMemoryEntityResolver,
  type EntityRecord,
} from './fakes/index.js';

type RouteId = 'orders' | 'tables';

describeRouterAdapterContract<RouteId>('fake', () => ({
  router: createFakeRouter<RouteId>(),
  first: { routeId: 'orders' },
  second: { routeId: 'tables', params: { floor: '2' } },
}));

const request: InterpretRequest = {
  text: 'reserva una mesa',
  locale: 'es-PE',
  source: 'text',
  catalog: [],
  context: {},
};

describeInterpreterContract('fake', () => ({
  interpreter: createFakeInterpreter(() => ({
    status: 'proposed',
    proposals: [
      { capabilityId: 'reservation.create', slots: { guests: 4, names: ['Ana'] }, confidence: 0.8 },
    ],
  })),
  request,
}));

const recordsByTenant: Readonly<Record<string, readonly EntityRecord[]>> = {
  a: [
    { id: 'a-1', label: 'Lomo saltado' },
    { id: 'a-2', label: 'Arroz con pollo' },
    { id: 'a-3', label: 'Arroz chaufa' },
  ],
  b: [
    { id: 'b-1', label: 'Ceviche' },
    { id: 'b-2', label: 'Arroz marino' },
  ],
};

describeEntityResolverContract<string>('in-memory', () => ({
  resolver: createInMemoryEntityResolver<string>({
    entity: 'dish',
    records: (tenant) => recordsByTenant[tenant] ?? [],
    normalize: foldText,
  }),
  principal: 'a',
  exact: { text: 'Lomo saltado', variant: 'LOMO SALTADÓ', id: 'a-1' },
  ambiguous: { text: 'arroz', ids: ['a-2', 'a-3'] },
  unknown: 'pizza',
  foreign: { principal: 'b', hiddenIds: ['a-1', 'a-2', 'a-3'] },
}));

describeEffectContract<{ readonly note: string }>('fake', () => {
  let executed = 0;
  return {
    effect: createFakeEffect((input: { readonly note: string }) => {
      executed += 1;
      return { ok: true, output: input.note };
    }),
    input: { note: 'hola' },
    sideEffects: () => executed,
  };
});

describeSpeechSourceContract('fake', () =>
  createFakeSpeechSource({ transcript: 'una mesa para cuatro', partials: ['una', 'una mesa'] }),
);

const reservationSchema = z.object({ table: z.string(), guests: z.number() });

describeSchemaAdapterContract('zod', () => ({
  adapter: createZodSchemaAdapter(),
  schema: reservationSchema,
  valid: { table: 't1', guests: 2 },
  missing: { value: { guests: 2 }, path: 'table' },
}));
