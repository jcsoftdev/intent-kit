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

const isQuantityBeforeNumberWord = (
  filler: string,
  rest: string,
  words: ReadonlyMap<string, number>,
): boolean => words.has(filler) && words.has(rest.split(' ')[0] ?? '');

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
  return isQuantityBeforeNumberWord(filler, rest, words) ? undefined : rest;
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

const replaceNumberWords = (text: string, words: ReadonlyMap<string, number>): string =>
  text
    .split(' ')
    .map((word) => String(words.get(word) ?? word))
    .join(' ');

export const createNormalizer = (
  rules: NormalizationRules = SPANISH_NORMALIZATION,
): ((text: string) => string) => {
  const fillers = rules.leadingFillers
    .map(foldText)
    .filter((filler) => filler !== '')
    .sort((a, b) => b.length - a.length);
  const words = new Map(
    Object.entries(rules.numberWords).map(([word, value]) => [foldText(word), value]),
  );
  return (text) =>
    replaceNumberWords(
      stripLeadingFillers(foldText(text.slice(0, MAX_UTTERANCE_LENGTH)), fillers, words),
      words,
    )
      .replace(/\s+/g, ' ')
      .trim();
};
