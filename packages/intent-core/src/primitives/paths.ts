import { IntentDefinitionError } from '../contracts/index.js';
import type { StandardSchemaV1 } from '../contracts/index.js';

export type PathSegment = string | number | '[]';

const PART_PATTERN = /^([A-Za-z_$][\w$-]*)((?:\[\d*\])*)$/;
const INDEX_PATTERN = /\[(\d*)\]/g;

const parsePart = (part: string, path: string): readonly PathSegment[] => {
  const match = PART_PATTERN.exec(part);
  if (!match) {
    throw new IntentDefinitionError('INVALID_PATH', path);
  }
  const indices = [...(match[2] ?? '').matchAll(INDEX_PATTERN)].map((index): PathSegment =>
    index[1] === '' ? '[]' : Number(index[1]),
  );
  return [match[1] as string, ...indices];
};

export const parsePath = (path: string): readonly PathSegment[] =>
  path.split('.').flatMap((part) => parsePart(part, path));

export const formatPath = (segments: readonly PathSegment[]): string =>
  segments.reduce<string>((formatted, segment, position) => {
    if (typeof segment === 'string' && segment !== '[]') {
      return position === 0 ? segment : `${formatted}.${segment}`;
    }
    return `${formatted}[${segment === '[]' ? '' : segment}]`;
  }, '');

const isContainer = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null;

const isWildcard = (segment: PathSegment): boolean => segment === '[]';

export const getAtSegments = (value: unknown, segments: readonly PathSegment[]): unknown =>
  segments.reduce<unknown>((current, segment) => {
    if (!isContainer(current) || isWildcard(segment)) {
      return undefined;
    }
    return Object.hasOwn(current, segment) ? current[segment] : undefined;
  }, value);

export const getAtPath = (value: unknown, path: string): unknown =>
  getAtSegments(value, parsePath(path));

const shallowCopy = (value: unknown, nextSegment: PathSegment): Record<PropertyKey, unknown> => {
  if (Array.isArray(value)) {
    return [...value] as unknown as Record<PropertyKey, unknown>;
  }
  if (isContainer(value)) {
    return { ...value };
  }
  return typeof nextSegment === 'number' ? ([] as unknown as Record<PropertyKey, unknown>) : {};
};

const setAtSegments = (
  value: unknown,
  segments: readonly PathSegment[],
  next: unknown,
  path: string,
): unknown => {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return next;
  }
  if (isWildcard(head)) {
    throw new IntentDefinitionError('INVALID_PATH', path);
  }
  const copy = shallowCopy(value, head);
  const child = isContainer(value) && Object.hasOwn(value, head) ? value[head] : undefined;
  copy[head] = setAtSegments(child, rest, next, path);
  return copy;
};

export const setAtPath = <T>(value: T, path: string, next: unknown): T =>
  setAtSegments(value, parsePath(path), next, path) as T;

const expandSegments = (
  value: unknown,
  segments: readonly PathSegment[],
  walked: readonly PathSegment[],
): readonly (readonly PathSegment[])[] => {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return value === undefined ? [] : [walked];
  }
  if (isWildcard(head)) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((item, index) => expandSegments(item, rest, [...walked, index]));
  }
  if (!isContainer(value) || !Object.hasOwn(value, head)) {
    return [];
  }
  return expandSegments(value[head], rest, [...walked, head]);
};

export const expandPattern = (pattern: string, value: unknown): readonly string[] =>
  expandSegments(value, parsePath(pattern), []).map(formatPath);

const segmentMatches = (concrete: PathSegment, pattern: PathSegment): boolean =>
  isWildcard(pattern) ? typeof concrete === 'number' || isWildcard(concrete) : concrete === pattern;

export const matchesPattern = (concrete: string, pattern: string): boolean => {
  const concreteSegments = parsePath(concrete);
  const patternSegments = parsePath(pattern);
  return (
    concreteSegments.length === patternSegments.length &&
    concreteSegments.every((segment, index) =>
      segmentMatches(segment, patternSegments[index] as PathSegment),
    )
  );
};

const normalize = (path: string): readonly PathSegment[] =>
  parsePath(path).map((segment) => (typeof segment === 'number' ? '[]' : segment));

export const overlaps = (a: string, b: string): boolean => {
  const left = normalize(a);
  const right = normalize(b);
  const shared = Math.min(left.length, right.length);
  return left.slice(0, shared).every((segment, index) => segment === right[index]);
};

export const issueSegments = (issue: StandardSchemaV1.Issue): readonly PathSegment[] =>
  (issue.path ?? []).map((entry): PathSegment => {
    const key = typeof entry === 'object' ? entry.key : entry;
    return typeof key === 'number' ? key : String(key);
  });

export const issuePath = (issue: StandardSchemaV1.Issue): string =>
  formatPath(issueSegments(issue));
