import type { JsonObject } from '@jcsoftdev/intent-core';

type Schema = Readonly<Record<string, unknown>>;

const BRANCH_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const variantsOf = (node: Schema): readonly Schema[] => [
  node,
  ...BRANCH_KEYS.flatMap((key) => {
    const branches = node[key];
    return Array.isArray(branches)
      ? branches.filter(isRecord).flatMap((branch) => variantsOf(branch))
      : [];
  }),
];

const propertiesOf = (variant: Schema): Schema | undefined =>
  isRecord(variant.properties) ? variant.properties : undefined;

const prune = (variants: readonly Schema[], value: unknown): unknown => {
  if (Array.isArray(value)) {
    const items = variants.map(({ items }) => items).filter(isRecord);
    return items.length === 0
      ? value
      : value.map((element) => prune(items.flatMap(variantsOf), element));
  }
  if (!isRecord(value)) {
    return value;
  }
  const shaped = variants.filter((variant) => propertiesOf(variant) !== undefined);
  if (shaped.length === 0) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const childSchemas = shaped.map((variant) => propertiesOf(variant)?.[key]).filter(isRecord);
      return childSchemas.length === 0
        ? []
        : [[key, prune(childSchemas.flatMap(variantsOf), child)]];
    }),
  );
};

export const pruneToSchema = (schema: JsonObject, value: unknown): unknown =>
  prune(variantsOf(schema), value);
