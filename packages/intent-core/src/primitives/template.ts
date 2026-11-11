import { getAtPath } from './paths.js';

export interface TemplateScope {
  readonly input: unknown;
  readonly output: unknown;
}

const REFERENCE_PATTERN = /\{([^{}]*)\}/g;

export const templateReferences = (template: string): readonly string[] => [
  ...new Set([...template.matchAll(REFERENCE_PATTERN)].map((match) => (match[1] ?? '').trim())),
];

const isScopeRoot = (root: string): root is keyof TemplateScope =>
  root === 'input' || root === 'output';

const isPrintable = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const resolveReference = (reference: string, scope: TemplateScope): string | undefined => {
  const separator = reference.indexOf('.');
  const root = separator === -1 ? reference : reference.slice(0, separator);
  if (!isScopeRoot(root)) {
    return undefined;
  }
  const value =
    separator === -1 ? scope[root] : getAtPath(scope[root], reference.slice(separator + 1));
  return isPrintable(value) ? String(value) : undefined;
};

export const fillTemplate = (template: string, scope: TemplateScope): string | undefined => {
  const resolved = new Map<string, string>();
  for (const reference of templateReferences(template)) {
    const value = resolveReference(reference, scope);
    if (value === undefined) {
      return undefined;
    }
    resolved.set(reference, value);
  }
  return template.replace(
    REFERENCE_PATTERN,
    (_, reference: string) => resolved.get(reference.trim()) as string,
  );
};
