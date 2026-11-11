import {
  IntentDefinitionError,
  standardSchemaOperations,
  toJsonObject,
} from '@jcsoftdev/intent-core';
import type { JsonObject, SchemaAdapter, StandardSchemaV1 } from '@jcsoftdev/intent-core';
import { z } from 'zod';

export const isZodSchema = (schema: StandardSchemaV1): schema is z.ZodType =>
  schema['~standard'].vendor === 'zod' && schema instanceof z.ZodType;

const toJsonSchema = (schema: StandardSchemaV1): JsonObject => {
  if (!isZodSchema(schema)) {
    throw new IntentDefinitionError('UNSUPPORTED_SCHEMA_VENDOR', schema['~standard'].vendor);
  }
  return toJsonObject(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
};

export const createZodSchemaAdapter = (): SchemaAdapter => ({
  ...standardSchemaOperations,
  toJsonSchema,
});
