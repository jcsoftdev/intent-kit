import { IntentDefinitionError } from '../contracts/index.js';
import type { JsonObject, JsonValue } from '../contracts/index.js';
import { parsePath } from './paths.js';
import type { PathSegment } from './paths.js';

export type JsonLeafType =
  'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'unknown';

export interface JsonLeaf {
  readonly path: string;
  readonly type: JsonLeafType;
}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toJsonValue = (value: unknown, path: string): JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new IntentDefinitionError('INVALID_SCHEMA', path);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, toJsonValue(entry, `${path}.${key}`)]),
    );
  }
  throw new IntentDefinitionError('INVALID_SCHEMA', path);
};

export const toJsonObject = (value: unknown): JsonObject => {
  const converted = toJsonValue(value, '$');
  if (!isJsonObject(converted)) {
    throw new IntentDefinitionError('INVALID_SCHEMA', '$');
  }
  return converted;
};

const BRANCH_KEYS = ['anyOf', 'oneOf'] as const;

const relaxedLeaf = (node: JsonObject): JsonObject =>
  typeof node.description === 'string'
    ? { type: 'string', description: node.description }
    : { type: 'string' };

const relaxChild = (node: JsonValue | undefined, segments: readonly PathSegment[]) =>
  isJsonObject(node) ? relaxNode(node, segments) : undefined;

const relaxViaStructure = (
  node: JsonObject,
  head: PathSegment,
  rest: readonly PathSegment[],
): JsonObject | undefined => {
  if (typeof head === 'string' && head !== '[]') {
    const properties = node.properties;
    const child = isJsonObject(properties) ? relaxChild(properties[head], rest) : undefined;
    return child && isJsonObject(properties)
      ? { ...node, properties: { ...properties, [head]: child } }
      : undefined;
  }
  const child = relaxChild(node.items, rest);
  return child ? { ...node, items: child } : undefined;
};

const relaxViaBranches = (
  node: JsonObject,
  segments: readonly PathSegment[],
): JsonObject | undefined => {
  for (const key of BRANCH_KEYS) {
    const branches = node[key];
    if (!Array.isArray(branches)) {
      continue;
    }
    const relaxed = branches.map((branch) => relaxChild(branch, segments));
    if (relaxed.some((branch) => branch !== undefined)) {
      return {
        ...node,
        [key]: relaxed.map((branch, index) => branch ?? branches[index]) as JsonValue,
      };
    }
  }
  return undefined;
};

const relaxNode = (node: JsonObject, segments: readonly PathSegment[]): JsonObject | undefined => {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return relaxedLeaf(node);
  }
  return relaxViaStructure(node, head, rest) ?? relaxViaBranches(node, segments);
};

export const relaxEntityPaths = (schema: JsonObject, entityPaths: readonly string[]): JsonObject =>
  entityPaths.reduce<JsonObject>((current, path) => {
    const relaxed = relaxNode(current, parsePath(path));
    if (!relaxed) {
      throw new IntentDefinitionError('INVALID_PATH', path);
    }
    return relaxed;
  }, schema);

const LEAF_TYPES: readonly JsonLeafType[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
];

const leafTypeOf = (node: JsonObject): JsonLeafType => {
  const declared = Array.isArray(node.type)
    ? node.type.find((entry) => entry !== 'null')
    : node.type;
  return LEAF_TYPES.find((candidate) => candidate === declared) ?? 'unknown';
};

const isNullBranch = (branch: JsonValue): boolean => isJsonObject(branch) && branch.type === 'null';

const collectLeaves = (node: JsonObject, path: string): readonly JsonLeaf[] => {
  if (isJsonObject(node.properties) && Object.keys(node.properties).length > 0) {
    return Object.entries(node.properties).flatMap(([name, child]) =>
      isJsonObject(child) ? collectLeaves(child, path === '' ? name : `${path}.${name}`) : [],
    );
  }
  if (isJsonObject(node.items)) {
    return collectLeaves(node.items, `${path}[]`);
  }
  const branches = BRANCH_KEYS.flatMap((key) => {
    const value = node[key];
    return Array.isArray(value) ? value.filter((branch) => !isNullBranch(branch)) : [];
  });
  if (node.type === undefined && branches.length > 0) {
    return branches.flatMap((branch) => (isJsonObject(branch) ? collectLeaves(branch, path) : []));
  }
  return [{ path, type: leafTypeOf(node) }];
};

export const jsonSchemaLeaves = (schema: JsonObject): readonly JsonLeaf[] => {
  const seen = new Set<string>();
  return collectLeaves(schema, '').filter((leaf) => {
    if (seen.has(leaf.path)) {
      return false;
    }
    seen.add(leaf.path);
    return true;
  });
};
