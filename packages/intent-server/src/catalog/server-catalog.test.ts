import { createCapabilityDefiner } from '@jcsoftdev/intent-core';
import type { AnyDescriptor } from '@jcsoftdev/intent-core';
import { createZodSchemaAdapter } from '@jcsoftdev/intent-zod';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createNormalizer } from '../text/normalize.js';
import { createServerCatalog } from './server-catalog.js';

type Role = 'waiter' | 'cashier' | 'admin';

const define = createCapabilityDefiner<Role, 'orders'>();
const base = {
  version: 1,
  kind: 'write',
  agent: 'allowed',
  aliases: [],
  examples: [],
  patterns: [],
  scope: 'global',
  entities: [],
  risk: 'write',
  confirmation: 'never',
  reversibility: { kind: 'none' },
  idempotency: { kind: 'none' },
} as const;

const ordersCreate = define({
  ...base,
  id: 'orders.create',
  description: 'Create an order',
  examples: ['haz un pedido de arroz con pollo para la mesa 3'],
  patterns: ['{quantity?} {dish} para la mesa {table}', 'pedido de {dish} para la mesa {table}'],
  input: z.object({
    tableId: z.uuid(),
    dishId: z.uuid(),
    quantity: z.number().int().optional(),
  }),
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'dishId', entity: 'dish' },
  ],
  roles: ['waiter', 'admin'],
});

const cashShiftClose = define({
  ...base,
  id: 'cash.shift.close',
  description: 'Close the cash shift',
  input: z.object({ note: z.string().optional() }),
  roles: ['cashier'],
});

const secretAudit = define({
  ...base,
  id: 'audit.export',
  agent: 'never',
  description: 'Export the audit',
  input: z.object({ note: z.string().optional() }),
  roles: ['waiter', 'cashier'],
});

const kitchenMarkReady = define({
  ...base,
  id: 'kitchen.lines.markReady',
  description: 'Mark a line ready',
  input: z.object({ lineId: z.uuid() }),
  entities: [{ path: 'lineId', entity: 'line' }],
  roles: ['waiter'],
});

const allDescriptors: readonly AnyDescriptor[] = [
  ordersCreate,
  cashShiftClose,
  secretAudit,
  kitchenMarkReady,
];

const resolverEntities = ['table', 'dish', 'line'];

const catalogOf = (
  capabilities: readonly AnyDescriptor[],
  entities: readonly string[] = resolverEntities,
) =>
  createServerCatalog({
    capabilities,
    schema: createZodSchemaAdapter(),
    resolverEntities: entities,
    normalize: createNormalizer(),
  });

const reasonOf = (build: () => unknown): string | undefined => {
  try {
    build();
    return undefined;
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
};

describe('createServerCatalog', () => {
  test('rejects a pattern placeholder {mesa} that maps to nothing with INVALID_SLOT', () => {
    const broken = { ...ordersCreate, patterns: ['pedido para {mesa}'] };
    expect(reasonOf(() => catalogOf([broken]))).toBe('INVALID_SLOT');
  });

  test('rejects an entity without a resolver with MISSING_RESOLVER', () => {
    expect(reasonOf(() => catalogOf([ordersCreate], ['table']))).toBe('MISSING_RESOLVER');
  });

  test('rejects a duplicate capability id', () => {
    expect(reasonOf(() => catalogOf([cashShiftClose, cashShiftClose]))).toBe('DUPLICATE_ID');
  });

  test('rejects a placeholder that matches several leaves with AMBIGUOUS_SLOT', () => {
    const nested = {
      ...cashShiftClose,
      id: 'cash.shift.note',
      patterns: ['nota {note}'],
      input: z.object({ a: z.object({ note: z.string() }), b: z.object({ note: z.string() }) }),
    };
    expect(reasonOf(() => catalogOf([nested]))).toBe('AMBIGUOUS_SLOT');
  });

  test('rejects an over-capped pattern and names the caps in the message', () => {
    const capped = {
      ...cashShiftClose,
      id: 'cash.shift.capped',
      patterns: ['a {x} b {y} c {z}'],
      input: z.object({ x: z.string(), y: z.string(), z: z.string() }),
    };
    const message = (): string => {
      try {
        catalogOf([capped]);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(message()).toContain('INVALID_PATTERN');
    expect(message()).toContain('at most 2 text slots');
  });

  test('rejects an id-shaped leaf that is not declared as an entity path', () => {
    const uuidLeaf = {
      ...cashShiftClose,
      id: 'cash.shift.uuid',
      input: z.object({ ref: z.uuid() }),
    };
    const nameLeaf = {
      ...cashShiftClose,
      id: 'cash.shift.named',
      input: z.object({ shiftId: z.string() }),
    };
    expect(reasonOf(() => catalogOf([uuidLeaf]))).toBe('INVALID_SCHEMA');
    expect(reasonOf(() => catalogOf([nameLeaf]))).toBe('INVALID_SCHEMA');
  });

  test('manifest for orders.create has tableId as a plain string and exposes no roles or risk', () => {
    const entry = catalogOf(allDescriptors).entries.get('orders.create');
    const schema = entry?.manifest.inputJsonSchema as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(schema.properties.tableId?.type).toBe('string');
    expect(schema.properties.tableId).not.toHaveProperty('format');
    expect(Object.keys(entry?.manifest ?? {}).sort()).toEqual([
      'aliases',
      'description',
      'examples',
      'id',
      'inputJsonSchema',
    ]);
    expect(JSON.stringify(entry?.manifest)).not.toMatch(/roles|risk/);
  });

  test('waiter view excludes cashier-only and agent-never capabilities', () => {
    const ids = catalogOf(allDescriptors)
      .viewFor('waiter')
      .entries.map((entry) => entry.descriptor.id);
    expect(ids).toEqual(['orders.create', 'kitchen.lines.markReady']);
  });

  test('restrictTo limits the view to that capability', () => {
    const view = catalogOf(allDescriptors).viewFor('waiter', 'kitchen.lines.markReady');
    expect(view.entries.map((entry) => entry.descriptor.id)).toEqual(['kitchen.lines.markReady']);
    expect(view.get('orders.create')).toBeUndefined();
  });

  test('the most specific pattern wins over declaration order', () => {
    const entry = catalogOf(allDescriptors).entries.get('orders.create');
    const matched = entry?.patterns
      .map((pattern) => pattern.match('pedido de arroz con pollo para la mesa 3'))
      .find((slots) => slots !== undefined);
    expect(matched).toEqual({ dish: 'arroz con pollo', table: '3' });
  });

  test('names the normalizer-rewritten word when a literal is unstable', () => {
    const unstable = { ...cashShiftClose, id: 'cash.shift.fill', patterns: ['haz {note}'] };
    const message = (): string => {
      try {
        catalogOf([unstable]);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(message()).toContain('"haz"');
    expect(message()).toContain('normalizer');
    expect(message()).not.toContain('at most 4 slots');
  });

  test('id-shaped leaves and resolvers are not required for agent-never capabilities', () => {
    const uiOnly = {
      ...cashShiftClose,
      id: 'cash.shift.audit',
      agent: 'never',
      input: z.object({ shiftId: z.uuid() }),
      entities: [{ path: 'shiftId', entity: 'shift' }],
    } as const;
    expect(reasonOf(() => catalogOf([uiOnly], []))).toBeUndefined();
    expect(reasonOf(() => catalogOf([{ ...uiOnly, agent: 'allowed' }], []))).toBe(
      'MISSING_RESOLVER',
    );
    const unDeclared = { ...uiOnly, entities: [] };
    expect(reasonOf(() => catalogOf([unDeclared], []))).toBeUndefined();
    expect(reasonOf(() => catalogOf([{ ...unDeclared, agent: 'allowed' }], []))).toBe(
      'INVALID_SCHEMA',
    );
  });

  test('equal literal length keeps declaration order', () => {
    const twoSlots = {
      ...cashShiftClose,
      id: 'cash.shift.tag',
      input: z.object({ note: z.string(), tag: z.string() }),
    };
    const first = '{note} caja {tag}';
    const second = '{tag} caja {note}';
    const winner = (patterns: readonly string[]) =>
      catalogOf([{ ...twoSlots, patterns }])
        .entries.get('cash.shift.tag')
        ?.patterns.map((pattern) => pattern.match('ana caja beto'))[0];
    expect(winner([first, second])).toEqual({ note: 'ana', tag: 'beto' });
    expect(winner([second, first])).toEqual({ tag: 'ana', note: 'beto' });
  });
});
