import { describe, expect, test } from 'vitest';
import { IntentDefinitionError } from '../contracts/index.js';
import type { AnyDescriptor, DefinitionErrorReason, StandardSchemaV1 } from '../contracts/index.js';
import { validateDescriptor } from './validate-descriptor.js';

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

const broken = (patch: Partial<AnyDescriptor>): AnyDescriptor => ({ ...ordersCreate, ...patch });

const reasonOf = (descriptor: AnyDescriptor): DefinitionErrorReason | undefined => {
  try {
    validateDescriptor(descriptor);
    return undefined;
  } catch (error) {
    return error instanceof IntentDefinitionError ? error.reason : undefined;
  }
};

describe('validateDescriptor', () => {
  test('accepts the playground-like descriptor', () => {
    expect(reasonOf(ordersCreate)).toBeUndefined();
  });

  test.each<[string, AnyDescriptor, DefinitionErrorReason]>([
    ['id without a dot', broken({ id: 'orders' }), 'INVALID_ID'],
    ['id with an uppercase head', broken({ id: 'Orders.create' }), 'INVALID_ID'],
    ['version zero', broken({ version: 0 }), 'INVALID_VERSION'],
    ['fractional version', broken({ version: 1.5 }), 'INVALID_VERSION'],
    [
      'input without a validate function',
      broken({
        input: { '~standard': { version: 1, vendor: 'x' } } as unknown as StandardSchemaV1,
      }),
      'INVALID_SCHEMA',
    ],
    [
      'output with a wrong standard version',
      broken({
        output: {
          '~standard': { version: 2, vendor: 'x', validate: () => ({ value: 1 }) },
        } as unknown as StandardSchemaV1,
      }),
      'INVALID_SCHEMA',
    ],
    [
      'entity path that does not parse',
      broken({ entities: [{ path: '__proto__.x', entity: 'table' }] }),
      'INVALID_PATH',
    ],
    [
      'default param template outside input and output',
      broken({ destination: { default: { routeId: 'orders', params: { id: '{session.id}' } } } }),
      'INVALID_TEMPLATE',
    ],
    [
      'byRole target key template outside input and output',
      broken({
        destination: {
          default: { routeId: 'orders' },
          byRole: { waiter: { routeId: 'x', target: { intent: 'a', key: '{env.key}' } } },
        },
      }),
      'INVALID_TEMPLATE',
    ],
    [
      'negative compensation window',
      broken({ reversibility: { kind: 'compensate', via: 'orders.cancel', windowMs: -1 } }),
      'INVALID_REVERSIBILITY',
    ],
    [
      'compensation via that is not an id',
      broken({ reversibility: { kind: 'compensate', via: 'cancel', windowMs: 10 } }),
      'INVALID_REVERSIBILITY',
    ],
    [
      'grace with zero delay',
      broken({ reversibility: { kind: 'grace', delayMs: 0 } }),
      'INVALID_REVERSIBILITY',
    ],
    ['no roles for an agent-exposed capability', broken({ roles: [] }), 'INVALID_ROLES'],
    [
      'navigate without destination and output',
      broken({ kind: 'navigate', destination: undefined, output: undefined }),
      'INVALID_DESTINATION',
    ],
  ])('rejects %s', (_, descriptor, reason) => {
    expect(reasonOf(descriptor)).toBe(reason);
  });

  test('allows empty roles when the agent exposure is never', () => {
    expect(reasonOf(broken({ agent: 'never', roles: [] }))).toBeUndefined();
  });

  test('allows navigate without destination when an output schema exists', () => {
    expect(reasonOf(broken({ kind: 'navigate', destination: undefined }))).toBeUndefined();
  });
});
