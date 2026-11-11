import { expectTypeOf } from 'vitest';
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
