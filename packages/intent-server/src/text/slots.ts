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

const countBy = <T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1));
  return counts;
};

const uniqueLeafNames = (leaves: readonly JsonLeaf[]): readonly JsonLeaf[] => {
  const counts = countBy(leaves, (leaf) => leafName(leaf.path));
  return leaves.filter((leaf) => counts.get(leafName(leaf.path)) === 1);
};

const entityNamesDeclaredOnce = (descriptor: AnyDescriptor): ReadonlySet<string> => {
  const counts = countBy(descriptor.entities, ({ entity }) => entity);
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

const withIndices = (path: string, repeated: number): string => {
  const last = path.lastIndexOf(WILDCARD);
  return last === -1
    ? path
    : `${path.slice(0, last).replaceAll(WILDCARD, '[0]')}[${repeated}]${path.slice(last + WILDCARD.length)}`;
};

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

const repeatedKeys = (counts: ReadonlyMap<string, number>): readonly string[] =>
  [...counts].filter(([, count]) => count > 1).map(([key]) => key);

export const ambiguousSlotKeys = (
  descriptor: AnyDescriptor,
  inputJsonSchema: JsonObject,
): ReadonlySet<string> => {
  const index = buildSlotIndex(descriptor, inputJsonSchema);
  const leaves = jsonSchemaLeaves(inputJsonSchema);
  const candidates = [
    ...repeatedKeys(countBy(leaves, (leaf) => leafName(leaf.path))),
    ...repeatedKeys(countBy(descriptor.entities, ({ entity }) => entity)),
  ];
  return new Set(candidates.filter((key) => !index.has(key)));
};
