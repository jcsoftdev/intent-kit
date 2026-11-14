import { IntentDefinitionError, foldText } from '@jcsoftdev/intent-core';

export type SlotKind = 'text' | 'number';

export type CapturedSlots = Readonly<Record<string, string>>;

export interface SlotPair {
  readonly numberSlot: string;
  readonly textSlot: string;
}

export interface CapturedSplit {
  readonly textSlot: string;
  readonly whole: string;
}

export interface LeadingNumber {
  readonly value: number;
  readonly rest: string;
}

export interface CompiledPattern {
  readonly template: string;
  readonly slots: readonly string[];
  readonly pairs: readonly SlotPair[];
  match(normalized: string): CapturedSlots | undefined;
  splits(normalized: string): readonly CapturedSplit[];
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

const PUNCTUATION_SEPARATORS = /[,;.]/;

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
    if ((/\s/.test(char) || PUNCTUATION_SEPARATORS.test(char)) && depth === 0) {
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

const slotSource = (
  kind: SlotKind,
  group: string,
  numbers: string,
  delimitedByNumber: boolean,
): string => {
  if (kind === 'number') {
    return `(?<${group}>${numbers})`;
  }
  return delimitedByNumber
    ? `(?<${group}>\\S+(?: (?!(?:${numbers})(?: |$))\\S+)*?)`
    : `(?<${group}>.+?)`;
};

const assemble = (
  elements: readonly Element[],
  kindOf: (slot: string) => SlotKind,
  numbers: string,
  delimited: ReadonlySet<string>,
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
    const capture = slotSource(kindOf(element.name), group, numbers, delimited.has(element.name));
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

const numberDelimitedSlots = (
  elements: readonly Element[],
  kindOf: (slot: string) => SlotKind,
  template: string,
): ReadonlySet<string> => {
  const delimited = new Set<string>();
  let openText: string | undefined;
  let numbersSince = 0;
  elements.forEach((element) => {
    if (element.kind === 'literal') {
      openText = undefined;
    } else if (kindOf(element.name) === 'number') {
      numbersSince += openText === undefined ? 0 : 1;
    } else {
      if (openText !== undefined && numbersSince !== 1) {
        throw invalid(template);
      }
      if (openText !== undefined) {
        delimited.add(openText);
      }
      openText = element.name;
      numbersSince = 0;
    }
  });
  return delimited;
};

const slotPairsOf = (
  elements: readonly Element[],
  kindOf: (slot: string) => SlotKind,
): readonly SlotPair[] =>
  elements.flatMap((element, position) => {
    const next = elements[position + 1];
    return element.kind === 'slot' &&
      next?.kind === 'slot' &&
      kindOf(element.name) === 'number' &&
      kindOf(next.name) === 'text'
      ? [{ numberSlot: element.name, textSlot: next.name }]
      : [];
  });

const numberValue = (raw: string, words: ReadonlyMap<string, number>): string =>
  String(words.get(raw) ?? raw);

export const splitLeadingNumber = (
  text: string,
  words: ReadonlyMap<string, number>,
): LeadingNumber | undefined => {
  const found = new RegExp(`^(${numberSource(words)}) (.+)$`, 'u').exec(foldText(text));
  const raw = found?.[1];
  const rest = found?.[2]?.trim();
  return raw === undefined || rest === undefined || rest === ''
    ? undefined
    : { value: Number(numberValue(raw, words)), rest };
};

const convertNumbers = (
  captured: CapturedSlots,
  numberSlots: ReadonlySet<string>,
  words: ReadonlyMap<string, number>,
): CapturedSlots =>
  Object.fromEntries(
    Object.entries(captured).map(([name, value]) => [
      name,
      numberSlots.has(name) ? numberValue(value, words) : value,
    ]),
  );

export const compilePattern = (
  template: string,
  kindOf: (slot: string) => SlotKind,
  fold: (text: string) => string = foldText,
  words: ReadonlyMap<string, number> = new Map(),
): CompiledPattern => {
  const elements = tokenize(template).map((token) => parseElement(token, fold, template));
  const delimited = numberDelimitedSlots(elements, kindOf, template);
  const names = elements.flatMap((element) => (element.kind === 'slot' ? [element.name] : []));
  const textSlots = names.filter((name) => kindOf(name) === 'text');
  if (
    new Set(names).size !== names.length ||
    names.length > MAX_SLOTS ||
    textSlots.length > MAX_TEXT_SLOTS
  ) {
    throw invalid(template);
  }
  const { source, groups } = assemble(elements, kindOf, numberSource(words), delimited);
  const expression = new RegExp(`^${source}$`, 'u');
  const numberSlots = new Set(names.filter((name) => kindOf(name) === 'number'));
  const pairs = slotPairsOf(elements, kindOf);
  const capture = (normalized: string): CapturedSlots | undefined => {
    const found = expression.exec(fold(normalized));
    if (found === null) {
      return undefined;
    }
    const captured = [...groups].flatMap(([group, name]) => {
      const value = found.groups?.[group];
      return value === undefined ? [] : [[name, value] as const];
    });
    return captured.some(([, value]) => value.trim() === '')
      ? undefined
      : Object.fromEntries(captured);
  };
  return {
    template,
    slots: names,
    pairs,
    match(normalized) {
      const captured = capture(normalized);
      return captured && convertNumbers(captured, numberSlots, words);
    },
    splits(normalized) {
      const captured = capture(normalized) ?? {};
      return pairs.flatMap(({ numberSlot, textSlot }) => {
        const number = captured[numberSlot];
        const text = captured[textSlot];
        return number === undefined || text === undefined
          ? []
          : [{ textSlot, whole: `${number} ${text}` }];
      });
    },
  };
};
