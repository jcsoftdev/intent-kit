import {
  expandPattern,
  foldText,
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
import type { InterpretationState } from '../state.js';

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
  | { readonly kind: 'resolved'; readonly id: string; readonly label: string }
  | { readonly kind: 'ambiguous'; readonly options: readonly ClosedOption[] }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'failed'; readonly outcome: Outcome<never> };

interface ResolvedEntry {
  readonly path: string;
  readonly entity: string;
  readonly id: string;
  readonly exact: boolean;
}

const INVALID_RESULT: PathResult = { kind: 'failed', outcome: invalidInputInResolution };
const NOT_FOUND_RESULT: PathResult = {
  kind: 'failed',
  outcome: failureOutcome({ stage: 'resolution', code: 'ENTITY_NOT_FOUND', retryable: false }),
};

interface ResolvedReading {
  readonly kind: 'resolved';
  readonly reading: Draft;
  readonly input: unknown;
  readonly labels: Readonly<Record<string, string>>;
  readonly resolved: readonly ResolvedEntry[];
  readonly consumed: readonly string[];
}

type Reading =
  ResolvedReading | { readonly kind: 'stopped'; readonly outcome: Outcome<Interpretation> };

type Chosen =
  | ResolvedReading
  | { readonly kind: 'stopped'; readonly outcome: Outcome<Interpretation> }
  | { readonly kind: 'ambiguous'; readonly outcome: Outcome<Interpretation> };

const signatureOf = (reading: ResolvedReading): string =>
  JSON.stringify(reading.resolved.map(({ path, id }) => [path, id]));

const firstDifferingPath = (readings: readonly ResolvedReading[]): string | undefined => {
  const [first, ...others] = readings;
  return first?.resolved
    .map(({ path }) => path)
    .find((path) =>
      others.some(
        (other) =>
          other.resolved.find((entry) => entry.path === path)?.id !==
          first.resolved.find((entry) => entry.path === path)?.id,
      ),
    );
};

const ambiguityBetween = (readings: readonly ResolvedReading[]): Chosen => {
  const [first] = readings;
  const path = firstDifferingPath(readings);
  if (!first || path === undefined) {
    return { kind: 'stopped', outcome: invalidInputInResolution };
  }
  const options = readings.flatMap((reading) => {
    const id = reading.resolved.find((entry) => entry.path === path)?.id;
    const label = reading.labels[path];
    return id === undefined || label === undefined ? [] : [{ id, label }];
  });
  const unique = options.filter(
    (option, index) => options.findIndex(({ id }) => id === option.id) === index,
  );
  return {
    kind: 'ambiguous',
    outcome: {
      ok: true,
      value: {
        status: 'ambiguous',
        draft: { ...first.reading, input: withoutSegments(first.reading.input, parsePath(path)) },
        candidates: unique.map((option) => ({ kind: 'entity', path, option })),
      },
    },
  };
};

const exactCount = (reading: ResolvedReading): number =>
  reading.resolved.filter(({ exact }) => exact).length;

const chooseReading = (readings: readonly Reading[]): Chosen => {
  const [primary] = readings;
  const resolved = readings.filter(
    (reading): reading is ResolvedReading => reading.kind === 'resolved',
  );
  if (resolved.length === 0 || !primary) {
    return primary?.kind === 'stopped'
      ? primary
      : { kind: 'stopped', outcome: invalidInputInResolution };
  }
  const signatures = new Set(resolved.map(signatureOf));
  if (signatures.size > 1) {
    return ambiguityBetween(resolved);
  }
  return resolved.reduce((best, reading) =>
    exactCount(reading) > exactCount(best) ? reading : best,
  );
};

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

export const createEntitiesStage = <TPrincipal>(config: {
  readonly resolvers: ResolverRegistry<TPrincipal>;
  readonly budgetMs: number;
  readonly matchKey?: (text: string) => string;
}): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
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
    const resolveAt = async (
      reading: Draft,
      path: string,
      param: EntityParam,
      resolved: readonly ResolvedEntry[],
    ): Promise<PathResult> => {
      const text: unknown = getAtPath(reading.input, path);
      const answer = answerTextOf(answers, path);
      if (answer === null || (text !== undefined && typeof text !== 'string')) {
        return INVALID_RESULT;
      }
      const resolver = config.resolvers.get(param.entity);
      if (!resolver) {
        return { kind: 'failed', outcome: resolutionUnavailable(false) };
      }
      try {
        if (text === undefined) {
          return answer === undefined
            ? { kind: 'skipped' }
            : pickOption(
                answer,
                await resolver.options(principal, path, reading, { signal: context.signal }),
              );
        }
        const resolution = await resolver.resolve(
          principal,
          { text, hints: hintsFor(path, resolved), scope: param.scope ?? 'any' },
          { signal: context.signal },
        );
        if (resolution.status === 'found') {
          return answer === undefined || answer === resolution.id
            ? { kind: 'resolved', id: resolution.id, label: resolution.label }
            : INVALID_RESULT;
        }
        const options = resolution.status === 'choices' ? resolution.options : resolution.nearest;
        if (answer !== undefined) {
          return pickOption(answer, options);
        }
        if (options.length > 0) {
          return { kind: 'ambiguous', options };
        }
        return NOT_FOUND_RESULT;
      } catch (error) {
        return { kind: 'failed', outcome: unavailableUnlessAborted(context.signal, error) };
      }
    };
    const keyOf = config.matchKey ?? foldText;
    const isExact = (text: unknown, label: string): boolean =>
      typeof text === 'string' && keyOf(text) === keyOf(label);
    const readInput = async (reading: Draft): Promise<Reading> => {
      let input = reading.input;
      const labels: Record<string, string> = {};
      const resolved: ResolvedEntry[] = [];
      const consumed: string[] = [];
      for (const param of entry.descriptor.entities) {
        for (const path of concretePathsOf(param, reading.input, answers)) {
          const result = await resolveAt(reading, path, param, resolved);
          if (result.kind === 'failed') {
            return { kind: 'stopped', outcome: result.outcome };
          }
          if (result.kind === 'ambiguous') {
            return {
              kind: 'stopped',
              outcome: {
                ok: true,
                value: {
                  status: 'ambiguous',
                  draft: reading,
                  candidates: result.options.map((option) => ({ kind: 'entity', path, option })),
                },
              },
            };
          }
          if (result.kind === 'resolved') {
            input = setAtPath(input, path, result.id);
            labels[path] = result.label;
            resolved.push({
              path,
              entity: param.entity,
              id: result.id,
              exact: isExact(getAtPath(reading.input, path), result.label),
            });
            consumed.push(path);
          }
        }
      }
      return { kind: 'resolved', reading, input, labels, resolved, consumed };
    };
    const primary = await readInput(draft);
    const alternatives = context.find('alternativeInputs') ?? [];
    const readings = [
      primary,
      ...(await Promise.all(alternatives.map((input) => readInput({ ...draft, input })))),
    ];
    const chosen = chooseReading(readings);
    if (chosen.kind === 'stopped') {
      return chosen.outcome;
    }
    if (chosen.kind === 'ambiguous') {
      return chosen.outcome;
    }
    context.set('draft', chosen.reading);
    context.set('resolvedInput', chosen.input);
    context.set('labels', chosen.labels);
    context.set('answers', withoutAnswers(answers, chosen.consumed));
    return next();
  },
});
