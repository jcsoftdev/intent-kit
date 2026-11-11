import { jsonSchemaLeaves, setAtPath } from '@jcsoftdev/intent-core';
import type {
  AnyDescriptor,
  JsonLeaf,
  JsonLeafType,
  JsonObject,
  Proposal,
} from '@jcsoftdev/intent-core';

export interface SlotTarget {
  readonly path: string;
  readonly kind: 'entity' | 'value';
  readonly entity?: string;
  readonly leafType: JsonLeafType;
}

export type SlotIndex = ReadonlyMap<string, SlotTarget>;

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
const WILDCARD = '[]';

const leafName = (path: string): string => path.split('.').at(-1)?.replaceAll(WILDCARD, '') ?? path;

const uniqueLeafNames = (leaves: readonly JsonLeaf[]): readonly JsonLeaf[] => {
  const counts = new Map<string, number>();
  leaves.forEach((leaf) =>
    counts.set(leafName(leaf.path), (counts.get(leafName(leaf.path)) ?? 0) + 1),
  );
  return leaves.filter((leaf) => counts.get(leafName(leaf.path)) === 1);
};

const entityNamesDeclaredOnce = (descriptor: AnyDescriptor): ReadonlySet<string> => {
  const counts = new Map<string, number>();
  descriptor.entities.forEach(({ entity }) => counts.set(entity, (counts.get(entity) ?? 0) + 1));
  return new Set([...counts].filter(([, count]) => count === 1).map(([entity]) => entity));
};

export const buildSlotIndex = (
  descriptor: AnyDescriptor,
  inputJsonSchema: JsonObject,
): SlotIndex => {
  const leaves = jsonSchemaLeaves(inputJsonSchema);
  const entityByPath = new Map(descriptor.entities.map(({ path, entity }) => [path, entity]));
  const targetOf = (leaf: JsonLeaf): SlotTarget => {
    const entity = entityByPath.get(leaf.path);
    return entity === undefined
      ? { path: leaf.path, kind: 'value', leafType: leaf.type }
      : { path: leaf.path, kind: 'entity', entity, leafType: leaf.type };
  };
  const index = new Map<string, SlotTarget>();
  uniqueLeafNames(leaves).forEach((leaf) => index.set(leafName(leaf.path), targetOf(leaf)));
  leaves.forEach((leaf) => index.set(leaf.path, targetOf(leaf)));
  const declaredOnce = entityNamesDeclaredOnce(descriptor);
  descriptor.entities
    .filter(({ entity }) => declaredOnce.has(entity))
    .forEach(({ path, entity }) => {
      const leaf = leaves.find((candidate) => candidate.path === path);
      index.set(entity, { path, kind: 'entity', entity, leafType: leaf?.type ?? 'string' });
    });
  return index;
};

export const resolveSlotKey = (index: SlotIndex, key: string): SlotTarget | undefined =>
  index.get(key);

type SlotValue = Proposal['slots'][string];

const withIndices = (path: string, first: number): string =>
  path.replace(WILDCARD, `[${first}]`).replaceAll(WILDCARD, '[0]');

const scalarEntries = (
  target: SlotTarget,
  value: SlotValue,
): readonly (readonly [string, unknown])[] => {
  const path = withIndices(target.path, 0);
  if (Array.isArray(value)) {
    const isRepeatable = target.kind === 'entity' && target.path.includes(WILDCARD);
    const isArrayLeaf = target.leafType === 'array';
    if (isRepeatable) {
      return value.map((text, position) => [withIndices(target.path, position), text] as const);
    }
    return isArrayLeaf ? [[path, value]] : [];
  }
  if (target.kind === 'entity') {
    return [[path, String(value)]];
  }
  const isNumeric = target.leafType === 'number' || target.leafType === 'integer';
  return [
    [
      path,
      isNumeric && typeof value === 'string' && NUMERIC_TEXT.test(value) ? Number(value) : value,
    ],
  ];
};

export const buildDraftInput = (index: SlotIndex, slots: Proposal['slots']): unknown =>
  Object.entries(slots).reduce<unknown>((draft, [key, value]) => {
    const target = resolveSlotKey(index, key);
    return target
      ? scalarEntries(target, value).reduce<unknown>(
          (current, [path, entry]) => setAtPath(current, path, entry),
          draft,
        )
      : draft;
  }, {});
