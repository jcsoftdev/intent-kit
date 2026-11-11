import type { Outcome, SchemaAdapter, StandardSchemaV1 } from '../contracts/index.js';
import { throwIfAborted } from './abort.js';
import { formatPath, getAtSegments, issueSegments } from './paths.js';

const settle = async (
  schema: StandardSchemaV1,
  value: unknown,
): Promise<StandardSchemaV1.Result<unknown>> => schema['~standard'].validate(value);

export const validateWithSchema = async <T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): Promise<Outcome<T>> => {
  const result = await settle(schema, value);
  if (result.issues) {
    return {
      ok: false,
      failure: { stage: 'interpretation', code: 'INVALID_INPUT', retryable: false },
    };
  }
  return { ok: true, value: result.value as T };
};

export const missingPathsOf = async (
  schema: StandardSchemaV1,
  value: unknown,
): Promise<readonly string[]> => {
  const result = await settle(schema, value);
  if (!result.issues) {
    return [];
  }
  const missing = result.issues
    .map(issueSegments)
    .filter((segments) => segments.length > 0 && getAtSegments(value, segments) === undefined)
    .map(formatPath);
  return [...new Set(missing)];
};

export const standardSchemaOperations: Pick<SchemaAdapter, 'validate' | 'missingPaths'> = {
  async validate(schema, value, options) {
    throwIfAborted(options.signal);
    const outcome = await validateWithSchema(schema, value);
    throwIfAborted(options.signal);
    return outcome;
  },
  async missingPaths(schema, value, options) {
    throwIfAborted(options.signal);
    const paths = await missingPathsOf(schema, value);
    throwIfAborted(options.signal);
    return paths;
  },
};
