import {
  IntentDefinitionError,
  foldText,
  jsonSchemaLeaves,
  parsePath,
  relaxEntityPaths,
  validateDescriptor,
} from '@jcsoftdev/intent-core';
import type {
  PathSegment,
  AnyDescriptor,
  CapabilityManifestEntry,
  JsonObject,
  SchemaAdapter,
} from '@jcsoftdev/intent-core';
import { compilePattern } from '../text/pattern.js';
import type { CompiledPattern, SlotKind } from '../text/pattern.js';
import { ambiguousSlotKeys, buildSlotIndex, resolveSlotKey } from '../text/slots.js';
import type { SlotIndex } from '../text/slots.js';

export interface CatalogEntry {
  readonly descriptor: AnyDescriptor;
  readonly manifest: CapabilityManifestEntry;
  readonly slots: SlotIndex;
  readonly patterns: readonly CompiledPattern[];
}

export interface ServerCatalogView {
  readonly entries: readonly CatalogEntry[];
  get(id: string): CatalogEntry | undefined;
}

export interface ServerCatalog {
  readonly entries: ReadonlyMap<string, CatalogEntry>;
  viewFor(role: string, restrictTo?: string): ServerCatalogView;
}

export interface ServerCatalogConfig {
  readonly capabilities: readonly AnyDescriptor[];
  readonly schema: SchemaAdapter;
  readonly resolverEntities: readonly string[];
  readonly requirementPaths?: ReadonlyMap<string, readonly string[]>;
  readonly normalize: (text: string) => string;
}

const SLOT_CAPS = 'patterns allow at most 4 slots, at most 2 text slots and no slot inside (a|b)';
const SLOT_TOKEN = /\{[^{}]*\}/g;
const SLOT_IN_ALTERNATION = /\([^()]*\{/;
const LITERAL_SPLIT = /[\s()|[\]?]+/;
const ID_SUFFIX = /Id$/;
const NON_LITERAL = /\{[^{}]*\}|[\s()|[\]?]/g;
const WILDCARD = '[]';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const childSchemas = (
  node: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] => {
  const properties = isRecord(node.properties) ? Object.entries(node.properties) : [];
  const items: readonly (readonly [string, unknown])[] = isRecord(node.items)
    ? [[WILDCARD, node.items]]
    : [];
  return [...properties.map(([name, child]) => [`.${name}`, child] as const), ...items];
};

const branchSchemas = (node: Readonly<Record<string, unknown>>): readonly unknown[] =>
  ['anyOf', 'oneOf', 'allOf'].flatMap((key) => {
    const branches = node[key];
    return Array.isArray(branches) ? branches : [];
  });

const joinPath = (parent: string, segment: string): string =>
  segment === WILDCARD
    ? `${parent}${WILDCARD}`
    : parent === ''
      ? segment.slice(1)
      : `${parent}${segment}`;

const uuidPaths = (node: unknown, path: string): readonly string[] => {
  if (!isRecord(node)) {
    return [];
  }
  const own = node.format === 'uuid' ? [path] : [];
  const children = childSchemas(node).flatMap(([segment, child]) =>
    uuidPaths(child, joinPath(path, segment)),
  );
  const branches = branchSchemas(node).flatMap((branch) => uuidPaths(branch, path));
  return [...own, ...children, ...branches];
};

const leafNameOf = (path: string): string =>
  (path.split('.').at(-1) ?? path).replaceAll(WILDCARD, '');

const idShapedPaths = (schema: JsonObject): ReadonlySet<string> =>
  new Set([
    ...uuidPaths(schema, ''),
    ...jsonSchemaLeaves(schema)
      .map((leaf) => leaf.path)
      .filter((path) => ID_SUFFIX.test(leafNameOf(path))),
  ]);

const assertIdLeavesAreEntities = (descriptor: AnyDescriptor, schema: JsonObject): void => {
  if (descriptor.agent === 'never') {
    return;
  }
  const entityPaths = new Set(descriptor.entities.map(({ path }) => path));
  for (const path of idShapedPaths(schema)) {
    if (!entityPaths.has(path)) {
      throw new IntentDefinitionError(
        'INVALID_SCHEMA',
        `${descriptor.id}:${path} is id-shaped and must be declared as an entity path`,
      );
    }
  }
};

const assertResolvers = (descriptor: AnyDescriptor, resolvers: ReadonlySet<string>): void => {
  if (descriptor.agent === 'never') {
    return;
  }
  for (const { entity } of descriptor.entities) {
    if (!resolvers.has(entity)) {
      throw new IntentDefinitionError('MISSING_RESOLVER', `${descriptor.id}:${entity}`);
    }
  }
};

const literalLength = (template: string): number => template.replace(NON_LITERAL, '').length;

const bySpecificity = (patterns: readonly CompiledPattern[]): readonly CompiledPattern[] =>
  patterns
    .map((pattern, position) => ({ pattern, position, weight: literalLength(pattern.template) }))
    .sort((a, b) => b.weight - a.weight || a.position - b.position)
    .map(({ pattern }) => pattern);

const slotKindResolver =
  (descriptor: AnyDescriptor, inputJsonSchema: JsonObject, slots: SlotIndex) =>
  (slot: string): SlotKind => {
    if (ambiguousSlotKeys(descriptor, inputJsonSchema).has(slot)) {
      throw new IntentDefinitionError('AMBIGUOUS_SLOT', `${descriptor.id}:${slot}`);
    }
    const target = resolveSlotKey(slots, slot);
    if (!target) {
      throw new IntentDefinitionError('INVALID_SLOT', `${descriptor.id}:${slot}`);
    }
    return target.leafType === 'number' || target.leafType === 'integer' ? 'number' : 'text';
  };

const slotNamesOf = (template: string): readonly string[] =>
  (template.match(SLOT_TOKEN) ?? []).map((token) => token.slice(1, -1).replace(/\?$/, ''));

const unstableWordOf = (
  template: string,
  normalize: (text: string) => string,
): string | undefined =>
  template
    .replace(SLOT_TOKEN, ' ')
    .split(LITERAL_SPLIT)
    .map(foldText)
    .find((word) => word !== '' && normalize(word) !== word);

const exceedsSlotCaps = (template: string, kindOf: (slot: string) => SlotKind): boolean => {
  const names = slotNamesOf(template);
  const textSlots = names.filter((name) => kindOf(name) === 'text');
  return names.length > 4 || textSlots.length > 2 || SLOT_IN_ALTERNATION.test(template);
};

const explainInvalidPattern = (
  template: string,
  kindOf: (slot: string) => SlotKind,
  normalize: (text: string) => string,
): string => {
  const unstable = unstableWordOf(template, normalize);
  if (unstable !== undefined) {
    return `the word "${unstable}" is rewritten by the normalizer (a leading filler or a number word), so a pattern literal can never match it`;
  }
  if (exceedsSlotCaps(template, kindOf)) {
    return SLOT_CAPS;
  }
  return 'the pattern is malformed (unbalanced brackets, empty alternatives, a repeated slot or adjacent text slots)';
};

const compilePatterns = (
  descriptor: AnyDescriptor,
  inputJsonSchema: JsonObject,
  slots: SlotIndex,
  normalize: (text: string) => string,
): readonly CompiledPattern[] => {
  const kindOf = slotKindResolver(descriptor, inputJsonSchema, slots);
  return bySpecificity(
    descriptor.patterns.map((template) => {
      try {
        return compilePattern(template, kindOf, normalize);
      } catch (error) {
        if (error instanceof IntentDefinitionError && error.reason === 'INVALID_PATTERN') {
          throw new IntentDefinitionError(
            'INVALID_PATTERN',
            `${descriptor.id}: ${template} (${explainInvalidPattern(template, kindOf, normalize)})`,
          );
        }
        throw error;
      }
    }),
  );
};

const assertRequirementPaths = (
  descriptor: AnyDescriptor,
  schema: JsonObject,
  paths: readonly string[],
): void => {
  const leafPaths = jsonSchemaLeaves(schema).map((leaf) => leaf.path);
  for (const path of paths) {
    const exists = leafPaths.some(
      (leaf) => leaf === path || leaf.startsWith(`${path}[]`) || leaf.startsWith(`${path}.`),
    );
    if (!exists) {
      throw new IntentDefinitionError('INVALID_PATH', `${descriptor.id}:${path}`);
    }
  }
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const omitPath = (node: JsonObject, segments: readonly PathSegment[]): JsonObject => {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return node;
  }
  if (head === WILDCARD) {
    return isJsonObject(node.items) ? { ...node, items: omitPath(node.items, rest) } : node;
  }
  const properties = node.properties;
  if (typeof head !== 'string' || !isJsonObject(properties)) {
    return node;
  }
  if (rest.length > 0) {
    const child = properties[head];
    return isJsonObject(child)
      ? { ...node, properties: { ...properties, [head]: omitPath(child, rest) } }
      : node;
  }
  const kept = Object.fromEntries(Object.entries(properties).filter(([name]) => name !== head));
  const { required, ...others } = node;
  return {
    ...others,
    properties: kept,
    ...(Array.isArray(required) ? { required: required.filter((name) => name !== head) } : {}),
  };
};

const omitPaths = (schema: JsonObject, paths: readonly string[]): JsonObject =>
  paths.reduce((current, path) => omitPath(current, parsePath(path)), schema);

const buildEntry = (config: ServerCatalogConfig, descriptor: AnyDescriptor): CatalogEntry => {
  validateDescriptor(descriptor);
  const rawSchema = config.schema.toJsonSchema(descriptor.input);
  assertIdLeavesAreEntities(descriptor, rawSchema);
  assertResolvers(descriptor, new Set(config.resolverEntities));
  const requirementPaths = config.requirementPaths?.get(descriptor.id) ?? [];
  assertRequirementPaths(descriptor, rawSchema, requirementPaths);
  const inputJsonSchema = omitPaths(
    relaxEntityPaths(
      rawSchema,
      descriptor.entities.map(({ path }) => path),
    ),
    requirementPaths,
  );
  const slots = buildSlotIndex(descriptor, inputJsonSchema);
  return {
    descriptor,
    manifest: {
      id: descriptor.id,
      description: descriptor.description,
      aliases: descriptor.aliases,
      examples: descriptor.examples,
      inputJsonSchema,
    },
    slots,
    patterns: compilePatterns(descriptor, inputJsonSchema, slots, config.normalize),
  };
};

const createView = (entries: readonly CatalogEntry[]): ServerCatalogView => {
  const byId = new Map(entries.map((entry) => [entry.descriptor.id, entry]));
  return { entries, get: (id) => byId.get(id) };
};

export const createServerCatalog = (config: ServerCatalogConfig): ServerCatalog => {
  const entries = new Map<string, CatalogEntry>();
  for (const descriptor of config.capabilities) {
    if (entries.has(descriptor.id)) {
      throw new IntentDefinitionError('DUPLICATE_ID', descriptor.id);
    }
    entries.set(descriptor.id, buildEntry(config, descriptor));
  }
  return {
    entries,
    viewFor: (role, restrictTo) =>
      createView(
        [...entries.values()].filter(
          ({ descriptor }) =>
            descriptor.roles.includes(role) &&
            descriptor.agent !== 'never' &&
            (restrictTo === undefined || descriptor.id === restrictTo),
        ),
      ),
  };
};
