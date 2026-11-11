import type { ClosedOption } from '../contracts/index.js';

export const foldText = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const tokensOf = (folded: string): readonly string[] => (folded === '' ? [] : folded.split(' '));

const CONNECTORS: ReadonlySet<string> = new Set([
  'con',
  'de',
  'del',
  'el',
  'la',
  'los',
  'las',
  'y',
  'o',
  'a',
  'al',
  'en',
]);

const NEGATORS: ReadonlySet<string> = new Set(['sin', 'no']);

interface Candidate {
  readonly option: ClosedOption;
  readonly tokens: readonly string[];
  readonly content: readonly string[];
}

const toCandidate = (option: ClosedOption, fold: (text: string) => string): Candidate => {
  const tokens = tokensOf(fold(option.label));
  const content = tokens.filter((token) => !CONNECTORS.has(token));
  return { option, tokens, content: content.length > 0 ? content : tokens };
};

const dominates = (winner: Candidate, others: readonly Candidate[]): boolean =>
  others.every(
    (other) => other === winner || other.content.every((token) => winner.tokens.includes(token)),
  );

const pickMentioned = (
  mentioned: readonly Candidate[],
  available: ReadonlySet<string>,
): Candidate | undefined => {
  if (mentioned.length <= 1) {
    return mentioned[0];
  }
  const full = mentioned.filter((candidate) =>
    candidate.tokens.every((token) => available.has(token)),
  );
  const winners = full.filter((candidate) => dominates(candidate, mentioned));
  return winners.length === 1 ? winners[0] : undefined;
};

const isNegatedFor = (candidate: Candidate, available: ReadonlySet<string>): boolean =>
  [...NEGATORS].some((negator) => available.has(negator) && !candidate.tokens.includes(negator));

export const matchClosedOption = (
  text: string,
  options: readonly ClosedOption[],
  fold: (text: string) => string = foldText,
): ClosedOption | undefined => {
  const folded = fold(text);
  const candidates = options.map((option) => toCandidate(option, fold));
  const exact = candidates.filter((candidate) => candidate.tokens.join(' ') === folded);
  if (exact.length > 0) {
    return exact.length === 1 ? exact[0]?.option : undefined;
  }
  const available = new Set(tokensOf(folded));
  const mentioned = candidates.filter((candidate) =>
    candidate.content.some((token) => available.has(token)),
  );
  const picked = pickMentioned(mentioned, available);
  return picked && !isNegatedFor(picked, available) ? picked.option : undefined;
};
