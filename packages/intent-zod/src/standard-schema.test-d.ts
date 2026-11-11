import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@jcsoftdev/intent-core';
import type { z } from 'zod';

interface OrderInput {
  readonly tableId: string;
  readonly lines: readonly { readonly offeringId: string; readonly quantity: number }[];
}

expectTypeOf<z.ZodType<OrderInput>>().toExtend<StandardSchemaV1<unknown, OrderInput>>();
