import type { SchemaAdapter, StandardSchemaV1 } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

export function describeSchemaAdapterContract(
  name: string,
  factory: () => {
    readonly adapter: SchemaAdapter;
    readonly schema: StandardSchemaV1;
    readonly valid: unknown;
    readonly missing: { readonly value: unknown; readonly path: string };
  },
): void {
  describe(`${name} schema adapter contract`, () => {
    const signal = new AbortController().signal;

    it('validate accepts the valid value', async () => {
      const { adapter, schema, valid } = factory();
      const outcome = await adapter.validate(schema, valid, { signal });
      expect(outcome.ok).toBe(true);
    });

    it('missingPaths of the incomplete value equals exactly the missing path', async () => {
      const { adapter, schema, missing } = factory();
      await expect(adapter.missingPaths(schema, missing.value, { signal })).resolves.toEqual([
        missing.path,
      ]);
    });

    it('toJsonSchema describes an object', () => {
      const { adapter, schema } = factory();
      expect(adapter.toJsonSchema(schema).type).toBe('object');
    });

    it('validate and missingPaths with an already-aborted signal reject with the reason', async () => {
      const { adapter, schema, valid, missing } = factory();
      const reason = new Error('already aborted');
      const aborted = AbortSignal.abort(reason);
      await expect(adapter.validate(schema, valid, { signal: aborted })).rejects.toBe(reason);
      await expect(adapter.missingPaths(schema, missing.value, { signal: aborted })).rejects.toBe(
        reason,
      );
    });
  });
}
