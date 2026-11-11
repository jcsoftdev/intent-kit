import { expect, test } from 'vitest';
import type { AnyDescriptor, StandardSchemaV1 } from '../contracts/index.js';
import { resolveDestination } from './destination.js';

const schema: StandardSchemaV1 = {
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};

const descriptor: AnyDescriptor = {
  id: 'orders.create',
  version: 1,
  kind: 'write',
  agent: 'allowed',
  description: 'Create an order',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  input: schema,
  output: schema,
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
  roles: ['waiter', 'host'],
  destination: {
    default: { routeId: 'orders', params: { id: '{output.orderId}' } },
    byRole: {
      waiter: { routeId: 'myOrders', target: { intent: 'my-order', key: '{output.orderId}' } },
    },
  },
};

const scope = { input: {}, output: { orderId: 'o-1' } };

test('waiter gets byRole.waiter myOrders with target my-order:o-1; host gets default orders', () => {
  expect(resolveDestination(descriptor, 'waiter', scope)).toEqual({
    status: 'ready',
    destination: { routeId: 'myOrders', target: { intent: 'my-order', key: 'o-1' } },
  });
  expect(resolveDestination(descriptor, 'host', scope)).toEqual({
    status: 'ready',
    destination: { routeId: 'orders', params: { id: 'o-1' } },
  });
});

test('target key template with a missing output field → unresolved TARGET_NOT_FOUND', () => {
  expect(resolveDestination(descriptor, 'waiter', { input: {}, output: {} })).toEqual({
    status: 'unresolved',
    code: 'TARGET_NOT_FOUND',
  });
});

test('a param template with a missing field → unresolved TARGET_NOT_FOUND', () => {
  expect(resolveDestination(descriptor, 'host', { input: {}, output: {} })).toEqual({
    status: 'unresolved',
    code: 'TARGET_NOT_FOUND',
  });
});

test('navigate capability without destination uses output {routeId:"cash"}', () => {
  const navigate: AnyDescriptor = { ...descriptor, kind: 'navigate', destination: undefined };
  expect(resolveDestination(navigate, 'host', { input: {}, output: { routeId: 'cash' } })).toEqual({
    status: 'ready',
    destination: { routeId: 'cash' },
  });
  expect(resolveDestination(navigate, 'host', { input: {}, output: { other: 1 } })).toEqual({
    status: 'unresolved',
    code: 'TARGET_NOT_FOUND',
  });
});

test('a capability without a destination rule resolves to none', () => {
  const plain: AnyDescriptor = { ...descriptor, destination: undefined };
  expect(resolveDestination(plain, 'host', scope)).toEqual({ status: 'none' });
});
