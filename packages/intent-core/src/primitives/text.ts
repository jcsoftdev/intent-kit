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
  readonly detail: readonly string[];
}

const toCandidate = (option: ClosedOption, fold: (text: string) => string): Candidate => {
  const tokens = tokensOf(fold(option.label));
  const content = tokens.filter((token) => !CONNECTORS.has(token));
  const detail = tokensOf(fold(option.detail ?? '')).filter((token) => !CONNECTORS.has(token));
  return { option, tokens, content: content.length > 0 ? content : tokens, detail };
};

const mentionsDetail = (candidate: Candidate, available: ReadonlySet<string>): boolean =>
  candidate.detail.length > 0 && candidate.detail.every((token) => available.has(token));

const narrowByDetail = (
  mentioned: readonly Candidate[],
  available: ReadonlySet<string>,
): readonly Candidate[] => {
  const named = mentioned.filter((candidate) => mentionsDetail(candidate, available));
  return named.length > 0 && named.length < mentioned.length ? named : mentioned;
};

const dominates = (winner: Candidate, others: readonly Candidate[]): boolean =>
  others.every(
    (other) => other === winner || other.content.every((token) => winner.tokens.includes(token)),
  );

const pickMentioned = (
  allMentioned: readonly Candidate[],
  available: ReadonlySet<string>,
): Candidate | undefined => {
  const mentioned = narrowByDetail(allMentioned, available);
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
  const exact = candidates.filter(
    (candidate) =>
      candidate.tokens.join(' ') === folded ||
      [...candidate.tokens, ...tokensOf(fold(candidate.option.detail ?? ''))].join(' ') === folded,
  );
  if (exact.length > 0) {
    return exact.length === 1 ? exact[0]?.option : undefined;
  }
  const available = new Set(tokensOf(folded));
  const mentioned = candidates.filter((candidate) =>
    [...candidate.content, ...candidate.detail].some((token) => available.has(token)),
  );
  const picked = pickMentioned(mentioned, available);
  return picked && !isNegatedFor(picked, available) ? picked.option : undefined;
};
