import { describe, expect, test } from 'vitest';
import type { StandardSchemaV1 } from '../contracts/index.js';
import {
  missingPathsOf,
  standardSchemaOperations,
  validateWithSchema,
} from './schema-operations.js';

interface Order {
  readonly tableId: string;
  readonly lines: readonly string[];
}

const orderSchema: StandardSchemaV1<unknown, Order> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => {
      const candidate = value as { tableId?: unknown; lines?: unknown };
      const issues: StandardSchemaV1.Issue[] = [];
      if (typeof candidate.tableId !== 'string') {
        issues.push({ message: 'required', path: ['tableId'] });
      }
      if (!Array.isArray(candidate.lines)) {
        issues.push({ message: 'required', path: ['lines'] });
      }
      if (typeof candidate.tableId !== 'string') {
        issues.push({ message: 'duplicate', path: [{ key: 'tableId' }] });
      }
      return issues.length > 0 ? { issues } : { value: candidate as Order };
    },
  },
};

describe('schema operations', () => {
  test('missingPathsOf returns tableId once, in issue order, when it is absent', async () => {
    expect(await missingPathsOf(orderSchema, { lines: ['a'] })).toEqual(['tableId']);
  });

  test('missingPathsOf returns [] when tableId is present but malformed', async () => {
    expect(await missingPathsOf(orderSchema, { tableId: 3, lines: ['a'] })).toEqual([]);
  });

  test('missingPathsOf returns [] for a valid value', async () => {
    expect(await missingPathsOf(orderSchema, { tableId: 't', lines: [] })).toEqual([]);
  });

  test('validateWithSchema reports invalid input as a non retryable interpretation failure', async () => {
    expect(await validateWithSchema(orderSchema, {})).toEqual({
      ok: false,
      failure: { stage: 'interpretation', code: 'INVALID_INPUT', retryable: false },
    });
    expect(await validateWithSchema(orderSchema, { tableId: 't', lines: [] })).toEqual({
      ok: true,
      value: { tableId: 't', lines: [] },
    });
  });

  test('the adapter operations reject with the signal reason when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      standardSchemaOperations.validate(orderSchema, {}, { signal: controller.signal }),
    ).rejects.toThrow('stop');
    await expect(
      standardSchemaOperations.missingPaths(orderSchema, {}, { signal: controller.signal }),
    ).rejects.toThrow('stop');
  });
});
