import type { ClosedOption } from '../contracts/index.js';

export const foldText = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const tokensOf = (folded: string): readonly string[] => (folded === '' ? [] : folded.split(' '));

const onlyMatch = (matches: readonly ClosedOption[]): ClosedOption | undefined =>
  matches.length === 1 ? matches[0] : undefined;

export const matchClosedOption = (
  text: string,
  options: readonly ClosedOption[],
  fold: (text: string) => string = foldText,
): ClosedOption | undefined => {
  const folded = fold(text);
  const exact = options.filter((option) => fold(option.label) === folded);
  if (exact.length > 0) {
    return onlyMatch(exact);
  }
  const available = new Set(tokensOf(folded));
  const partial = options.filter((option) => {
    const labelTokens = tokensOf(fold(option.label));
    return labelTokens.length > 0 && labelTokens.every((token) => available.has(token));
  });
  return onlyMatch(partial);
};
