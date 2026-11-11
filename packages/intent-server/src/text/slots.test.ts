import type { AnyDescriptor, JsonObject } from '@jcsoftdev/intent-core';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { ambiguousSlotKeys, buildDraftInput, buildSlotIndex, resolveSlotKey } from './slots.js';

const schema = z.object({
  tableId: z.string(),
  lines: z.array(z.object({ offeringId: z.string(), quantity: z.number().int() })),
});
const inputJsonSchema = z.toJSONSchema(schema, { io: 'input' }) as JsonObject;

const descriptor = {
  entities: [
    { path: 'tableId', entity: 'table' },
    { path: 'lines[].offeringId', entity: 'dish' },
  ],
} as unknown as AnyDescriptor;

const index = buildSlotIndex(descriptor, inputJsonSchema);

describe('buildSlotIndex', () => {
  test('dish, table and quantity resolve to their targets', () => {
    expect(resolveSlotKey(index, 'dish')).toEqual({
      path: 'lines[].offeringId',
      kind: 'entity',
      entity: 'dish',
      leafType: 'string',
    });
    expect(resolveSlotKey(index, 'table')).toMatchObject({ path: 'tableId', kind: 'entity' });
    expect(resolveSlotKey(index, 'quantity')).toEqual({
      path: 'lines[].quantity',
      kind: 'value',
      leafType: 'integer',
    });
  });

  test('exact paths resolve and unknown keys do not', () => {
    expect(resolveSlotKey(index, 'lines[].quantity')?.kind).toBe('value');
    expect(resolveSlotKey(index, 'dropTables')).toBeUndefined();
  });

  test('a leaf name shared by several leaves is not indexed, exact paths still are', () => {
    const twin = z.toJSONSchema(
      z.object({ a: z.object({ id: z.string() }), b: z.object({ id: z.string() }) }),
      {
        io: 'input',
      },
    ) as JsonObject;
    const twinIndex = buildSlotIndex({ entities: [] } as unknown as AnyDescriptor, twin);
    expect(resolveSlotKey(twinIndex, 'id')).toBeUndefined();
    expect(resolveSlotKey(twinIndex, 'a.id')?.path).toBe('a.id');
  });

  test('an entity name declared twice is not indexed by name', () => {
    const twice = {
      entities: [
        { path: 'tableId', entity: 'thing' },
        { path: 'lines[].offeringId', entity: 'thing' },
      ],
    } as unknown as AnyDescriptor;
    expect(resolveSlotKey(buildSlotIndex(twice, inputJsonSchema), 'thing')).toBeUndefined();
  });
});

describe('ambiguousSlotKeys', () => {
  const twin = z.toJSONSchema(
    z.object({ a: z.object({ id: z.string() }), b: z.object({ id: z.string() }) }),
    { io: 'input' },
  ) as JsonObject;
  const twice = {
    entities: [
      { path: 'tableId', entity: 'thing' },
      { path: 'lines[].offeringId', entity: 'thing' },
    ],
  } as unknown as AnyDescriptor;

  test('reports repeated leaf names and entity names declared twice', () => {
    expect(ambiguousSlotKeys({ entities: [] } as unknown as AnyDescriptor, twin)).toEqual(
      new Set(['id']),
    );
    expect(ambiguousSlotKeys(twice, inputJsonSchema)).toEqual(new Set(['thing']));
  });

  test('does not report resolvable or unknown keys', () => {
    expect(ambiguousSlotKeys(descriptor, inputJsonSchema)).toEqual(new Set());
  });
});

describe('buildDraftInput', () => {
  test('expands a string array over the last wildcard of a nested entity path', () => {
    const nested = z.toJSONSchema(
      z.object({
        lines: z.array(z.object({ offeringId: z.string(), modifiers: z.array(z.string()) })),
      }),
      { io: 'input' },
    ) as JsonObject;
    const nestedIndex = buildSlotIndex(
      {
        entities: [{ path: 'lines[].modifiers[]', entity: 'modifier' }],
      } as unknown as AnyDescriptor,
      nested,
    );
    expect(buildDraftInput(nestedIndex, { modifier: ['papas fritas', 'ensalada'] })).toEqual({
      lines: [{ modifiers: ['papas fritas', 'ensalada'] }],
    });
  });

  test('maps entity texts and numeric values into the input', () => {
    expect(buildDraftInput(index, { dish: 'arroz con pollo', table: '3', quantity: '2' })).toEqual({
      tableId: '3',
      lines: [{ offeringId: 'arroz con pollo', quantity: 2 }],
    });
  });

  test('expands a string array over a repeated entity path', () => {
    expect(buildDraftInput(index, { offeringId: ['arroz con pollo', 'inca kola'] })).toEqual({
      lines: [{ offeringId: 'arroz con pollo' }, { offeringId: 'inca kola' }],
    });
  });

  test('ignores an unknown slot key and drops arrays for scalar leaves', () => {
    expect(buildDraftInput(index, { dropTables: 'x', quantity: ['1', '2'], table: ['1'] })).toEqual(
      {},
    );
  });

  test('keeps a non-numeric string for a numeric leaf', () => {
    expect(buildDraftInput(index, { quantity: 'dos' })).toEqual({ lines: [{ quantity: 'dos' }] });
  });

  test('an id-shaped slot stays entity text', () => {
    const id = '9b2f4c1e-5a3d-4e8f-8c7b-1a2b3c4d5e6f';
    expect(buildDraftInput(index, { table: id })).toEqual({ tableId: id });
  });
});
