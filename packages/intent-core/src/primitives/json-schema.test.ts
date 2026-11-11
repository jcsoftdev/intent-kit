import { describe, expect, test } from 'vitest';
import { IntentDefinitionError } from '../contracts/index.js';
import { jsonSchemaLeaves, relaxEntityPaths, toJsonObject } from './json-schema.js';

describe('json schema', () => {
  test('toJsonObject drops undefined properties and keeps plain values', () => {
    expect(toJsonObject({ a: 1, b: undefined, c: { d: [1, 'x', null, true] } })).toEqual({
      a: 1,
      c: { d: [1, 'x', null, true] },
    });
  });

  test.each([
    ['a function', { a: () => 1 }],
    ['undefined inside an array', { a: [undefined] }],
    ['NaN', { a: Number.NaN }],
    ['Infinity', { a: Number.POSITIVE_INFINITY }],
    ['a non object', 3],
  ])('toJsonObject throws on %s', (_, value) => {
    expect(() => toJsonObject(value)).toThrow(IntentDefinitionError);
  });

  test('relaxEntityPaths turns lines[].offeringId into a plain string', () => {
    const schema = toJsonObject({
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              offeringId: { type: 'string', format: 'uuid', description: 'the dish' },
              qty: { type: 'integer' },
            },
          },
        },
      },
    });
    expect(relaxEntityPaths(schema, ['lines[].offeringId'])).toEqual({
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              offeringId: { type: 'string', description: 'the dish' },
              qty: { type: 'integer' },
            },
          },
        },
      },
    });
  });

  test('relaxEntityPaths reaches a property inside anyOf', () => {
    const schema = toJsonObject({
      type: 'object',
      properties: {
        table: {
          anyOf: [
            { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
            { type: 'null' },
          ],
        },
      },
    });
    expect(relaxEntityPaths(schema, ['table.id'])).toEqual({
      type: 'object',
      properties: {
        table: {
          anyOf: [{ type: 'object', properties: { id: { type: 'string' } } }, { type: 'null' }],
        },
      },
    });
  });

  test('relaxEntityPaths throws INVALID_PATH when a path matches nothing', () => {
    const schema = toJsonObject({ type: 'object', properties: { a: { type: 'string' } } });
    expect(() => relaxEntityPaths(schema, ['b'])).toThrow('INVALID_PATH: b');
  });

  test('jsonSchemaLeaves lists leaf paths with their types', () => {
    const schema = toJsonObject({
      type: 'object',
      properties: {
        tableId: { type: 'string' },
        covers: { type: 'integer' },
        note: { type: ['string', 'null'] },
        lines: {
          type: 'array',
          items: { type: 'object', properties: { qty: { type: 'number' } } },
        },
        tags: { type: 'array' },
        mystery: {},
      },
    });
    expect(jsonSchemaLeaves(schema)).toEqual([
      { path: 'tableId', type: 'string' },
      { path: 'covers', type: 'integer' },
      { path: 'note', type: 'string' },
      { path: 'lines[].qty', type: 'number' },
      { path: 'tags', type: 'array' },
      { path: 'mystery', type: 'unknown' },
    ]);
  });
});
