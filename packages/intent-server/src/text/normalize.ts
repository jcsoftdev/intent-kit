import { foldText } from '@jcsoftdev/intent-core';

export interface NormalizationRules {
  readonly leadingFillers: readonly string[];
  readonly numberWords: Readonly<Record<string, number>>;
}

export const SPANISH_NORMALIZATION: NormalizationRules = {
  leadingFillers: ['por favor', 'porfa', 'oye', 'hazme', 'haz', 'quiero', 'necesito', 'un', 'una'],
  numberWords: {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    veinte: 20,
  },
};

const MAX_UTTERANCE_LENGTH = 500;

const SPOKEN_DECIMAL = /(\d)[.,](\d{1,2})(?!\d)/g;
const FRACTION_WIDTH = 2;

export const spellDecimals = (text: string): string =>
  text.replace(
    SPOKEN_DECIMAL,
    (_match, whole: string, fraction: string) =>
      `${whole} con ${fraction.padEnd(FRACTION_WIDTH, '0')}`,
  );

const DIGITS = /^\d/;

const isQuantityBeforeNumber = (
  filler: string,
  rest: string,
  words: ReadonlyMap<string, number>,
): boolean => {
  const next = rest.split(' ')[0] ?? '';
  return words.has(filler) && (words.has(next) || DIGITS.test(next));
};

const stripLeadingFiller = (
  text: string,
  fillers: readonly string[],
  words: ReadonlyMap<string, number>,
): string | undefined => {
  const filler = fillers.find(
    (candidate) => text === candidate || text.startsWith(`${candidate} `),
  );
  if (filler === undefined) {
    return undefined;
  }
  const rest = text.slice(filler.length).trim();
  return isQuantityBeforeNumber(filler, rest, words) ? undefined : rest;
};

const stripLeadingFillers = (
  text: string,
  fillers: readonly string[],
  words: ReadonlyMap<string, number>,
): string => {
  let current = text;
  for (let next = stripLeadingFiller(current, fillers, words); next !== undefined;) {
    current = next;
    next = stripLeadingFiller(current, fillers, words);
  }
  return current;
};

export const numberWordsOf = (
  rules: NormalizationRules = SPANISH_NORMALIZATION,
): ReadonlyMap<string, number> =>
  new Map(Object.entries(rules.numberWords).map(([word, value]) => [foldText(word), value]));

const replaceNumberWords = (text: string, words: ReadonlyMap<string, number>): string =>
  text
    .split(' ')
    .map((word) => String(words.get(word) ?? word))
    .join(' ');

const fillersOf = (rules: NormalizationRules): readonly string[] =>
  rules.leadingFillers
    .map(foldText)
    .filter((filler) => filler !== '')
    .sort((a, b) => b.length - a.length);

export const createNormalizer = (
  rules: NormalizationRules = SPANISH_NORMALIZATION,
): ((text: string) => string) => {
  const fillers = fillersOf(rules);
  const words = numberWordsOf(rules);
  return (text) =>
    stripLeadingFillers(
      foldText(spellDecimals(text.slice(0, MAX_UTTERANCE_LENGTH))),
      fillers,
      words,
    )
      .replace(/\s+/g, ' ')
      .trim();
};

export const createMatchKey = (
  rules: NormalizationRules = SPANISH_NORMALIZATION,
): ((text: string) => string) => {
  const normalize = createNormalizer(rules);
  const words = numberWordsOf(rules);
  return (text) => replaceNumberWords(normalize(text), words);
};

const PLURAL_ES_AFTER_N = /[aeiou]nes$/;
const MIN_PLURAL_LENGTH = 4;
const INVARIANT_PLURAL_LIKE: ReadonlySet<string> = new Set([
  'tres',
  'gas',
  'mas',
  'menos',
  'pues',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
]);

export const foldSpanishPlural = (token: string): string => {
  if (
    !token.endsWith('s') ||
    token.length < MIN_PLURAL_LENGTH ||
    INVARIANT_PLURAL_LIKE.has(token)
  ) {
    return token;
  }
  return PLURAL_ES_AFTER_N.test(token) ? token.slice(0, -2) : token.slice(0, -1);
};
