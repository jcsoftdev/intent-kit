import { IntentDefinitionError } from '@jcsoftdev/intent-core';
import type { StandardSchemaV1 } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createZodSchemaAdapter, isZodSchema } from './zod-schema-adapter.js';

const orderInput = z.object({
  tableId: z.string(),
  lines: z.array(z.object({ offeringId: z.uuid(), quantity: z.number().int().default(1) })),
});

const adapter = createZodSchemaAdapter();
const live = { signal: new AbortController().signal };

describe('createZodSchemaAdapter', () => {
  it('toJsonSchema of the playground order input schema has type "object", required ["tableId","lines"], and lines.items.properties.offeringId.format "uuid"', () => {
    const json = adapter.toJsonSchema(orderInput) as {
      type: string;
      required: string[];
      properties: { lines: { items: { properties: { offeringId: { format: string } } } } };
    };
    expect(json.type).toBe('object');
    expect(json.required).toEqual(['tableId', 'lines']);
    expect(json.properties.lines.items.properties.offeringId.format).toBe('uuid');
  });

  it('a schema with a z.date() field does not throw (unrepresentable any)', () => {
    expect(() => adapter.toJsonSchema(z.object({ at: z.date() }))).not.toThrow();
  });

  it('missingPaths of {lines:[{offeringId:"x",quantity:1}]} → ["tableId"]', async () => {
    const paths = await adapter.missingPaths(
      orderInput,
      { lines: [{ offeringId: 'x', quantity: 1 }] },
      live,
    );
    expect(paths).toEqual(['tableId']);
  });

  it('validate failure returns INVALID_INPUT; success returns the parsed value with defaults applied', async () => {
    const failed = await adapter.validate(orderInput, { tableId: 1 }, live);
    expect(failed).toEqual({
      ok: false,
      failure: { stage: 'interpretation', code: 'INVALID_INPUT', retryable: false },
    });
    const id = '9b2f4c1e-5a3d-4e8f-8c7b-1a2b3c4d5e6f';
    const ok = await adapter.validate(
      orderInput,
      { tableId: 't', lines: [{ offeringId: id }] },
      live,
    );
    expect(ok).toEqual({
      ok: true,
      value: { tableId: 't', lines: [{ offeringId: id, quantity: 1 }] },
    });
  });

  it('a hand-written Standard Schema object → toJsonSchema throws UNSUPPORTED_SCHEMA_VENDOR', () => {
    const handWritten: StandardSchemaV1 = {
      '~standard': { version: 1, vendor: 'hand', validate: (value) => ({ value }) },
    };
    expect(isZodSchema(handWritten)).toBe(false);
    expect(() => adapter.toJsonSchema(handWritten)).toThrow(IntentDefinitionError);
    expect(() => adapter.toJsonSchema(handWritten)).toThrow('UNSUPPORTED_SCHEMA_VENDOR');
  });

  it('rejects with signal.reason when already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('stop');
    controller.abort(reason);
    await expect(adapter.validate(orderInput, {}, { signal: controller.signal })).rejects.toBe(
      reason,
    );
    await expect(adapter.missingPaths(orderInput, {}, { signal: controller.signal })).rejects.toBe(
      reason,
    );
  });
});
