import { IntentDefinitionError, foldText } from '@jcsoftdev/intent-core';

export type SlotKind = 'text' | 'number';

export type CapturedSlots = Readonly<Record<string, string>>;

export interface CompiledPattern {
  readonly template: string;
  readonly slots: readonly string[];
  match(normalized: string): CapturedSlots | undefined;
  alternatives(normalized: string): readonly CapturedSlots[];
}

type Element =
  | { readonly kind: 'slot'; readonly name: string; readonly optional: boolean }
  | { readonly kind: 'literal'; readonly source: string };

const MAX_SLOTS = 4;
const MAX_TEXT_SLOTS = 2;
const SLOT_NAME = /^[A-Za-z_$][\w$.[\]-]*$/;
const SLOT_TOKEN = /^\{([^{}?]+)(\?)?\}$/;
const ALTERNATION_TOKEN = /^\(([^()]*)\)$/;
const CLASS_SPLIT = /(\[[^[\]]*\])/;

const invalid = (template: string): IntentDefinitionError =>
  new IntentDefinitionError('INVALID_PATTERN', template);

const tokenize = (template: string): readonly string[] => {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of template) {
    if (char === '(' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === '}') {
      depth -= 1;
    }
    if (depth < 0) {
      throw invalid(template);
    }
    if (/\s/.test(char) && depth === 0) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (depth !== 0 || tokens.length + current.length === 0) {
    throw invalid(template);
  }
  return current === '' ? tokens : [...tokens, current];
};

type Fold = (text: string) => string;

const assertStable = (literal: string, fold: Fold, template: string): string => {
  const folded = foldText(literal);
  if (folded.split(' ').some((word) => word !== '' && fold(word) !== word)) {
    throw invalid(template);
  }
  return folded;
};

const alternationSource = (inner: string, fold: Fold, template: string): string => {
  const alternatives = inner.split('|').map((alternative) => {
    if (/[{}]/.test(alternative)) {
      throw invalid(template);
    }
    return assertStable(alternative, fold, template);
  });
  if (alternatives.some((alternative) => alternative === '')) {
    throw invalid(template);
  }
  return `(?:${alternatives.join('|')})`;
};

const wordSource = (token: string, fold: Fold, template: string): string => {
  const source = token
    .split(CLASS_SPLIT)
    .map((part) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        const chars = foldText(part.slice(1, -1));
        if (chars === '' || chars.includes(' ')) {
          throw invalid(template);
        }
        return `[${chars}]`;
      }
      if (/[[\]{}()|]/.test(part)) {
        throw invalid(template);
      }
      return assertStable(part, fold, template);
    })
    .join('');
  if (source === '') {
    throw invalid(template);
  }
  return source;
};

const parseElement = (token: string, fold: Fold, template: string): Element => {
  const slot = SLOT_TOKEN.exec(token);
  if (slot) {
    const name = slot[1] as string;
    if (!SLOT_NAME.test(name)) {
      throw invalid(template);
    }
    return { kind: 'slot', name, optional: slot[2] === '?' };
  }
  const alternation = ALTERNATION_TOKEN.exec(token);
  if (alternation) {
    return { kind: 'literal', source: alternationSource(alternation[1] as string, fold, template) };
  }
  return { kind: 'literal', source: wordSource(token, fold, template) };
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const numberSource = (words: ReadonlyMap<string, number>): string =>
  ['\\d+', ...[...words.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)].join('|');

const slotSource = (kind: SlotKind, group: string, numbers: string): string =>
  kind === 'number' ? `(?<${group}>${numbers})` : `(?<${group}>.+?)`;

const assemble = (
  elements: readonly Element[],
  kindOf: (slot: string) => SlotKind,
  numbers: string,
): { readonly source: string; readonly groups: ReadonlyMap<string, string> } => {
  const groups = new Map<string, string>();
  let source = '';
  let separatorPending = false;
  elements.forEach((element, position) => {
    const separator = separatorPending ? ' ' : '';
    separatorPending = true;
    if (element.kind === 'literal') {
      source += `${separator}${element.source}`;
      return;
    }
    const group = `s${groups.size}`;
    groups.set(group, element.name);
    const capture = slotSource(kindOf(element.name), group, numbers);
    if (!element.optional) {
      source += `${separator}${capture}`;
    } else if (position === 0) {
      source += `(?:${capture} )?`;
      separatorPending = false;
    } else {
      source += `(?:${separator}${capture})?`;
    }
  });
  return { source, groups };
};

const assertSeparated = (
  elements: readonly Element[],
  kindOf: (slot: string) => SlotKind,
  template: string,
): void => {
  let textSlotOpen = false;
  elements.forEach((element) => {
    if (element.kind === 'literal') {
      textSlotOpen = false;
    } else if (kindOf(element.name) === 'text') {
      if (textSlotOpen) {
        throw invalid(template);
      }
      textSlotOpen = true;
    }
  });
};

const splittableNumberSlot = (
  elements: readonly Element[],
  kindOf: (slot: string) => SlotKind,
): number => {
  const first = elements.findIndex(
    (element, position) =>
      element.kind === 'slot' &&
      element.optional &&
      kindOf(element.name) === 'number' &&
      elements[position + 1]?.kind === 'slot' &&
      kindOf((elements[position + 1] as Extract<Element, { kind: 'slot' }>).name) === 'text',
  );
  return first;
};

const convertNumbers = (
  captured: CapturedSlots,
  numberSlots: ReadonlySet<string>,
  words: ReadonlyMap<string, number>,
): CapturedSlots =>
  Object.fromEntries(
    Object.entries(captured).map(([name, value]) => [
      name,
      numberSlots.has(name) ? String(words.get(value) ?? value) : value,
    ]),
  );

export const compilePattern = (
  template: string,
  kindOf: (slot: string) => SlotKind,
  fold: (text: string) => string = foldText,
  words: ReadonlyMap<string, number> = new Map(),
): CompiledPattern => {
  const elements = tokenize(template).map((token) => parseElement(token, fold, template));
  assertSeparated(elements, kindOf, template);
  const names = elements.flatMap((element) => (element.kind === 'slot' ? [element.name] : []));
  const textSlots = names.filter((name) => kindOf(name) === 'text');
  if (
    new Set(names).size !== names.length ||
    names.length > MAX_SLOTS ||
    textSlots.length > MAX_TEXT_SLOTS
  ) {
    throw invalid(template);
  }
  const numbers = numberSource(words);
  const numberSlots = new Set(names.filter((name) => kindOf(name) === 'number'));
  const runner = (parts: readonly Element[]) => {
    const { source, groups } = assemble(parts, kindOf, numbers);
    const expression = new RegExp(`^${source}$`, 'u');
    return (normalized: string): CapturedSlots | undefined => {
      const found = expression.exec(fold(normalized));
      if (!found?.groups) {
        return undefined;
      }
      const captured = [...groups].flatMap(([group, name]) => {
        const value = found.groups?.[group];
        return value === undefined ? [] : [[name, value] as const];
      });
      return captured.some(([, value]) => value.trim() === '')
        ? undefined
        : convertNumbers(Object.fromEntries(captured), numberSlots, words);
    };
  };
  const primary = runner(elements);
  const splitAt = splittableNumberSlot(elements, kindOf);
  const split = splitAt < 0 ? undefined : runner(elements.filter((_, index) => index !== splitAt));
  const splitName =
    splitAt < 0 ? undefined : (elements[splitAt] as Extract<Element, { kind: 'slot' }>).name;
  return {
    template,
    slots: names,
    match: primary,
    alternatives(normalized) {
      const first = primary(normalized);
      const second = split?.(normalized);
      return first && second && splitName !== undefined && splitName in first ? [second] : [];
    },
  };
};
