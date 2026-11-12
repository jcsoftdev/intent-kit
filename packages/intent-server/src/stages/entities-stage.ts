import {
  expandPattern,
  getAtPath,
  matchesPattern,
  parsePath,
  setAtPath,
} from '@jcsoftdev/intent-core';
import type {
  Answers,
  Draft,
  PathSegment,
  ClosedOption,
  EntityParam,
  EntityResolver,
  Failure,
  Interpretation,
  Outcome,
  Stage,
} from '@jcsoftdev/intent-core';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState, NumberSplit } from '../state.js';
import { createMatchKey } from '../text/normalize.js';

export type ResolverRegistry<TPrincipal> = ReadonlyMap<string, EntityResolver<TPrincipal>>;

const WILDCARD_SEGMENT = '[]';

const failureOutcome = (failure: Failure): Outcome<never> => ({ ok: false, failure });

export const invalidInputInResolution: Outcome<never> = failureOutcome({
  stage: 'resolution',
  code: 'INVALID_INPUT',
  retryable: false,
});

export const resolutionUnavailable = (retryable: boolean): Outcome<never> =>
  failureOutcome({ stage: 'resolution', code: 'RESOLUTION_UNAVAILABLE', retryable });

export const capabilityNotFound: Outcome<never> = failureOutcome({
  stage: 'policy',
  code: 'CAPABILITY_NOT_FOUND',
  retryable: false,
});

export const unavailableUnlessAborted = (signal: AbortSignal, error: unknown): Outcome<never> => {
  if (signal.aborted) {
    throw error;
  }
  return resolutionUnavailable(true);
};

const isConcretePath = (path: string): boolean => {
  try {
    return !parsePath(path).includes(WILDCARD_SEGMENT);
  } catch {
    return false;
  }
};

export const answersAreWellFormed = (answers: Answers): boolean =>
  Object.keys(answers).every(isConcretePath);

export const withoutAnswers = (answers: Answers, consumed: readonly string[]): Answers =>
  Object.fromEntries(Object.entries(answers).filter(([path]) => !consumed.includes(path)));

export const withoutSegments = (value: unknown, segments: readonly PathSegment[]): unknown => {
  const [head, ...rest] = segments;
  if (head === undefined || typeof value !== 'object' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => (index === head ? withoutSegments(item, rest) : item));
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (key !== head) {
        return [[key, child]];
      }
      return rest.length === 0 ? [] : [[key, withoutSegments(child, rest)]];
    }),
  );
};

type PathResult =
  | {
      readonly kind: 'resolved';
      readonly id: string;
      readonly label: string;
      readonly reading?: SplitReading;
      readonly answered?: boolean;
    }
  | { readonly kind: 'ambiguous'; readonly options: readonly ClosedOption[] }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'failed'; readonly outcome: Outcome<never> };

type ResolvedPath = Extract<PathResult, { readonly kind: 'resolved' }>;

interface ResolvedEntry {
  readonly path: string;
  readonly entity: string;
  readonly id: string;
}

type Lookup =
  | { readonly kind: 'found'; readonly option: ClosedOption }
  | { readonly kind: 'choices' | 'notFound'; readonly options: readonly ClosedOption[] }
  | { readonly kind: 'failed'; readonly outcome: Outcome<never> };

type SettledLookup = Exclude<Lookup, { readonly kind: 'failed' }>;

type SplitReading = 'counted' | 'named';

interface ReadingLookup {
  readonly reading: SplitReading;
  readonly lookup: SettledLookup;
}

const INVALID_RESULT: PathResult = { kind: 'failed', outcome: invalidInputInResolution };
const NOT_FOUND_RESULT: PathResult = {
  kind: 'failed',
  outcome: failureOutcome({ stage: 'resolution', code: 'ENTITY_NOT_FOUND', retryable: false }),
};

const optionsOf = (lookup: SettledLookup): readonly ClosedOption[] =>
  lookup.kind === 'found' ? [lookup.option] : lookup.options;

const hasCandidates = ({ lookup }: ReadingLookup): boolean => lookup.kind !== 'notFound';

const distinctById = (options: readonly ClosedOption[]): readonly ClosedOption[] =>
  options.filter((option, index) => options.findIndex(({ id }) => id === option.id) === index);

const offeredReadings = (readings: readonly ReadingLookup[]): readonly ReadingLookup[] => {
  const withCandidates = readings.filter(hasCandidates);
  return withCandidates.length > 0 ? withCandidates : readings;
};

const offeredOptions = (readings: readonly ReadingLookup[]): readonly ClosedOption[] =>
  distinctById(offeredReadings(readings).flatMap(({ lookup }) => optionsOf(lookup)));

const keyTokensOf = (text: string, keyOf: (text: string) => string): readonly string[] =>
  keyOf(text)
    .split(' ')
    .filter((token) => token !== '');

const containsInOrder = (tokens: readonly string[], sequence: readonly string[]): boolean =>
  tokens.some((_, start) => sequence.every((token, offset) => tokens[start + offset] === token));

const labelContainsUnsplitText = (
  split: NumberSplit,
  label: string,
  keyOf: (text: string) => string,
): boolean =>
  containsInOrder(keyTokensOf(label, keyOf), [
    String(split.value),
    ...keyTokensOf(split.rest, keyOf),
  ]);

const readingForSharedOption = (
  split: NumberSplit,
  option: ClosedOption,
  keyOf: (text: string) => string,
): SplitReading => (labelContainsUnsplitText(split, option.label, keyOf) ? 'named' : 'counted');

const resolvedBy = (
  reading: SplitReading,
  option: ClosedOption,
  answered: boolean,
): PathResult => ({ kind: 'resolved', id: option.id, label: option.label, reading, answered });

const answerAmongReadings = (
  split: NumberSplit,
  readings: readonly ReadingLookup[],
  answer: string,
  keyOf: (text: string) => string,
): PathResult => {
  const holders = offeredReadings(readings).filter(({ lookup }) =>
    optionsOf(lookup).some(({ id }) => id === answer),
  );
  const [first, ...others] = holders;
  const option = first && optionsOf(first.lookup).find(({ id }) => id === answer);
  if (!first || !option) {
    return INVALID_RESULT;
  }
  const reading =
    others.length === 0 ? first.reading : readingForSharedOption(split, option, keyOf);
  return resolvedBy(reading, option, true);
};

const chooseAmongReadings = (
  split: NumberSplit,
  readings: readonly ReadingLookup[],
  keyOf: (text: string) => string,
): PathResult => {
  const options = offeredOptions(readings);
  const withCandidates = readings.filter(hasCandidates);
  if (withCandidates.length === 0) {
    return options.length > 0 ? { kind: 'ambiguous', options } : NOT_FOUND_RESULT;
  }
  const allFound = withCandidates.every(({ lookup }) => lookup.kind === 'found');
  const [first] = withCandidates;
  const [only] = options;
  if (first && only && allFound && options.length === 1) {
    const reading =
      withCandidates.length === 1 ? first.reading : readingForSharedOption(split, only, keyOf);
    return resolvedBy(reading, only, false);
  }
  return { kind: 'ambiguous', options };
};

const withSplitUndone = (input: unknown, split: NumberSplit): unknown =>
  setAtPath(withoutSegments(input, parsePath(split.numberPath)), split.textPath, split.whole);

const parentOf = (path: string): string => /^(.*\])\.[^\]]*$/.exec(path)?.[1] ?? '';

const hintsFor = (path: string, resolved: readonly ResolvedEntry[]): Record<string, string> =>
  Object.fromEntries(
    resolved
      .filter((entry) => {
        const parent = parentOf(entry.path);
        return parent === '' || parent === parentOf(path);
      })
      .map((entry) => [entry.entity, entry.id]),
  );

const pickOption = (answer: string, options: readonly ClosedOption[]): PathResult => {
  const option = options.find(({ id }) => id === answer);
  return option ? { kind: 'resolved', id: option.id, label: option.label } : INVALID_RESULT;
};

const answerTextOf = (answers: Answers, path: string): string | undefined | null => {
  if (!Object.hasOwn(answers, path)) {
    return undefined;
  }
  const answer = answers[path];
  return typeof answer === 'string' ? answer : null;
};

const concretePathsOf = (
  param: EntityParam,
  input: unknown,
  answers: Answers,
): readonly string[] => {
  const present = expandPattern(param.path, input);
  const answered = Object.keys(answers).filter(
    (path) => matchesPattern(path, param.path) && !present.includes(path),
  );
  return [...present, ...answered];
};

interface PathItem {
  readonly path: string;
  readonly param: EntityParam;
  readonly split?: NumberSplit;
}

const pathItemsOf = (
  params: readonly EntityParam[],
  input: unknown,
  answers: Answers,
  splits: readonly NumberSplit[],
): readonly PathItem[] =>
  params.flatMap((param) =>
    concretePathsOf(param, input, answers).map((path) => {
      const split = splits.find(({ textPath }) => textPath === path);
      return split ? { path, param, split } : { path, param };
    }),
  );

interface PendingAmbiguity {
  readonly path: string;
  readonly options: readonly ClosedOption[];
}

const ambiguityAt = (
  draft: Draft,
  input: unknown,
  { path, options }: PendingAmbiguity,
): Outcome<Interpretation> => ({
  ok: true,
  value: {
    status: 'ambiguous',
    draft: { ...draft, input },
    candidates: options.map((option) => ({ kind: 'entity', path, option })),
  },
});

const decidedText = (split: NumberSplit, result: ResolvedPath): string => {
  if (result.answered === true) {
    return result.label;
  }
  return result.reading === 'counted' ? split.rest : split.whole;
};

const splitDraftInput = (input: unknown, split: NumberSplit, result: ResolvedPath): unknown => {
  const written = setAtPath(input, split.textPath, decidedText(split, result));
  return result.reading === 'counted' ? setAtPath(written, split.numberPath, split.value) : written;
};

const splitResolvedInput = (input: unknown, split: NumberSplit, result: ResolvedPath): unknown =>
  result.reading === 'counted' ? setAtPath(input, split.numberPath, split.value) : input;

export const createEntitiesStage = <TPrincipal>(config: {
  readonly resolvers: ResolverRegistry<TPrincipal>;
  readonly budgetMs: number;
  readonly matchKey?: (text: string) => string;
}): Stage<InterpretationState<TPrincipal>, Interpretation> => {
  const keyOf = config.matchKey ?? createMatchKey();
  return {
    name: INTERPRETATION_STAGES.entities,
    phase: 'resolution',
    requires: ['catalog', 'principal', 'draft', 'answers'],
    provides: ['resolvedInput', 'labels', 'answers', 'draft'],
    budget: {
      timeoutMs: config.budgetMs,
      onTimeout: { stage: 'resolution', code: 'RESOLUTION_UNAVAILABLE', retryable: true },
    },
    async run(context, next) {
      const draft = context.get('draft');
      const answers = context.get('answers');
      const principal = context.get('principal');
      const entry = context.get('catalog').get(draft.capabilityId);
      if (!entry) {
        return capabilityNotFound;
      }
      if (!answersAreWellFormed(answers)) {
        return invalidInputInResolution;
      }
      const splits = context.find('numberSplits') ?? [];
      const lookUp = async (
        resolver: EntityResolver<TPrincipal>,
        text: string,
        path: string,
        param: EntityParam,
        resolved: readonly ResolvedEntry[],
      ): Promise<Lookup> => {
        try {
          const resolution = await resolver.resolve(
            principal,
            { text, hints: hintsFor(path, resolved), scope: param.scope ?? 'any' },
            { signal: context.signal },
          );
          if (resolution.status === 'found') {
            return { kind: 'found', option: { id: resolution.id, label: resolution.label } };
          }
          return resolution.status === 'choices'
            ? { kind: 'choices', options: resolution.options }
            : { kind: 'notFound', options: resolution.nearest };
        } catch (error) {
          return { kind: 'failed', outcome: unavailableUnlessAborted(context.signal, error) };
        }
      };
      const resolveText = async (
        resolver: EntityResolver<TPrincipal>,
        text: string,
        answer: string | undefined,
        item: PathItem,
        resolved: readonly ResolvedEntry[],
      ): Promise<PathResult> => {
        const lookup = await lookUp(resolver, text, item.path, item.param, resolved);
        if (lookup.kind === 'failed') {
          return lookup;
        }
        if (lookup.kind === 'found') {
          return answer === undefined || answer === lookup.option.id
            ? { kind: 'resolved', id: lookup.option.id, label: lookup.option.label }
            : INVALID_RESULT;
        }
        if (answer !== undefined) {
          return pickOption(answer, lookup.options);
        }
        return lookup.options.length > 0
          ? { kind: 'ambiguous', options: lookup.options }
          : NOT_FOUND_RESULT;
      };
      const resolveSplit = async (
        resolver: EntityResolver<TPrincipal>,
        split: NumberSplit,
        answer: string | undefined,
        item: PathItem,
        resolved: readonly ResolvedEntry[],
      ): Promise<PathResult> => {
        const [byCount, byName] = await Promise.all([
          lookUp(resolver, split.rest, item.path, item.param, resolved),
          lookUp(resolver, split.whole, item.path, item.param, resolved),
        ]);
        if (byCount.kind === 'failed') {
          return byCount;
        }
        if (byName.kind === 'failed') {
          return byName;
        }
        const readings: readonly ReadingLookup[] = [
          { reading: 'counted', lookup: byCount },
          { reading: 'named', lookup: byName },
        ];
        return answer === undefined
          ? chooseAmongReadings(split, readings, keyOf)
          : answerAmongReadings(split, readings, answer, keyOf);
      };
      const resolveAt = async (
        input: unknown,
        item: PathItem,
        resolved: readonly ResolvedEntry[],
      ): Promise<PathResult> => {
        const text: unknown = getAtPath(input, item.path);
        const answer = answerTextOf(answers, item.path);
        if (answer === null || (text !== undefined && typeof text !== 'string')) {
          return INVALID_RESULT;
        }
        const resolver = config.resolvers.get(item.param.entity);
        if (!resolver) {
          return { kind: 'failed', outcome: resolutionUnavailable(false) };
        }
        if (text !== undefined) {
          return item.split
            ? resolveSplit(resolver, item.split, answer, item, resolved)
            : resolveText(resolver, text, answer, item, resolved);
        }
        if (answer === undefined) {
          return { kind: 'skipped' };
        }
        try {
          return pickOption(
            answer,
            await resolver.options(
              principal,
              item.path,
              { ...draft, input },
              {
                signal: context.signal,
              },
            ),
          );
        } catch (error) {
          return { kind: 'failed', outcome: unavailableUnlessAborted(context.signal, error) };
        }
      };
      const unsplit = splits.reduce(withSplitUndone, draft.input);
      const items = pathItemsOf(entry.descriptor.entities, unsplit, answers, splits);
      let draftInput = unsplit;
      let input = unsplit;
      let deferred: PendingAmbiguity | undefined;
      const labels: Record<string, string> = {};
      const resolved: ResolvedEntry[] = [];
      const consumed: string[] = [];
      for (const [position, item] of items.entries()) {
        const result = await resolveAt(unsplit, item, resolved);
        if (result.kind === 'failed') {
          return result.outcome;
        }
        if (result.kind === 'ambiguous') {
          const current: PendingAmbiguity = { path: item.path, options: result.options };
          if (item.split) {
            return ambiguityAt(draft, draftInput, current);
          }
          deferred = deferred ?? current;
          if (!items.slice(position + 1).some(({ split }) => split !== undefined)) {
            return ambiguityAt(draft, draftInput, deferred);
          }
          continue;
        }
        if (result.kind === 'resolved') {
          if (item.split) {
            draftInput = splitDraftInput(draftInput, item.split, result);
            input = splitResolvedInput(input, item.split, result);
          }
          input = setAtPath(input, item.path, result.id);
          labels[item.path] = result.label;
          resolved.push({ path: item.path, entity: item.param.entity, id: result.id });
          consumed.push(item.path);
        }
      }
      if (deferred) {
        return ambiguityAt(draft, draftInput, deferred);
      }
      context.set('draft', { ...draft, input: draftInput });
      context.set('resolvedInput', input);
      context.set('labels', labels);
      context.set('answers', withoutAnswers(answers, consumed));
      return next();
    },
  };
};
