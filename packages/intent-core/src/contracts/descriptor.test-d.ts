import { expectTypeOf } from 'vitest';
import type { MessageCatalog } from './action.js';
import type { StandardSchemaV1 } from './standard-schema.js';
import {
  createCapabilityDefiner,
  type AnyDescriptor,
  type CapabilityDefinition,
  type CapabilityDescriptor,
  type InputPath,
} from './descriptor.js';

type OrderInput = {
  tableId: string;
  lines: { offeringId: string; quantity: number; modifiers: string[] }[];
};

const defineForPlayground = createCapabilityDefiner<'waiter' | 'kitchen', 'myOrders' | 'orders'>();

expectTypeOf<InputPath<OrderInput>>().toEqualTypeOf<
  | 'tableId'
  | 'lines'
  | 'lines[]'
  | 'lines[].offeringId'
  | 'lines[].quantity'
  | 'lines[].modifiers'
  | 'lines[].modifiers[]'
>();

expectTypeOf<
  CapabilityDescriptor<'waiter', 'myOrders', OrderInput, { orderId: string }>
>().toExtend<AnyDescriptor>();

expectTypeOf<
  CapabilityDefinition<'waiter', 'myOrders', OrderInput, unknown>['entities'][number]['path']
>().toEqualTypeOf<InputPath<OrderInput>>();

expectTypeOf<Parameters<typeof defineForPlayground>[0]['roles'][number]>().toEqualTypeOf<
  'waiter' | 'kitchen'
>();

expectTypeOf<
  NonNullable<Parameters<typeof defineForPlayground>[0]['destination']>['default']['routeId']
>().toEqualTypeOf<'myOrders' | 'orders'>();

declare function schemaOf<T>(): StandardSchemaV1<unknown, T>;

const base = {
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: '',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
  roles: ['waiter'],
} as const;

const create = defineForPlayground({
  ...base,
  id: 'orders.create',
  input: schemaOf<OrderInput>(),
  entities: [{ path: 'lines[].offeringId', entity: 'dish' }],
});

const cancel = defineForPlayground({
  ...base,
  id: 'orders.cancel',
  input: schemaOf<{ orderId: string }>(),
  entities: [],
});

type DefinedId = (typeof create | typeof cancel)['id'];

expectTypeOf<DefinedId>().toEqualTypeOf<'orders.create' | 'orders.cancel'>();
expectTypeOf(create.input).toEqualTypeOf<StandardSchemaV1<unknown, OrderInput>>();
expectTypeOf<Record<'orders.create', never>>().not.toExtend<MessageCatalog<DefinedId>>();
expectTypeOf<Record<DefinedId, never>>().toExtend<MessageCatalog<DefinedId>>();

expectTypeOf<
  CapabilityDescriptor<'waiter', 'orders', OrderInput, unknown, string, 'lines[].bogus'>
>().not.toExtend<CapabilityDefinition<'waiter', 'orders', OrderInput, unknown>>();
expectTypeOf<'lines[].bogus'>().not.toExtend<InputPath<OrderInput>>();
