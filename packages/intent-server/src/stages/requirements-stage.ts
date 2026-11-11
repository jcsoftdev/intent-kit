import { expandPattern, matchesPattern, parsePath, setAtPath } from '@jcsoftdev/intent-core';
import type {
  Interpretation,
  MissingField,
  PathSegment,
  RequirementProbe,
  Stage,
} from '@jcsoftdev/intent-core';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';
import {
  capabilityNotFound,
  invalidInputInResolution,
  resolutionUnavailable,
  unavailableUnlessAborted,
  withoutAnswers,
} from './entities-stage.js';

const idsOf = (answer: unknown): readonly string[] | undefined => {
  if (typeof answer === 'string') {
    return [answer];
  }
  return Array.isArray(answer) && answer.every((id) => typeof id === 'string') ? answer : undefined;
};

const isValidSelection = (field: MissingField, ids: readonly string[]): boolean =>
  new Set(ids).size === ids.length &&
  ids.every((id) => (field.options ?? []).some((option) => option.id === id)) &&
  ids.length >= (field.min ?? 0) &&
  ids.length <= (field.max ?? Number.POSITIVE_INFINITY);

const isDeclaredPath = (path: string, declared: readonly string[]): boolean => {
  try {
    return declared.some((pattern) => matchesPattern(path, pattern));
  } catch {
    return false;
  }
};

const withoutSegments = (value: unknown, segments: readonly PathSegment[]): unknown => {
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

const withoutRequirementValues = (input: unknown, patterns: readonly string[]): unknown =>
  patterns
    .flatMap((pattern) => expandPattern(pattern, input))
    .reduce((current, path) => withoutSegments(current, parsePath(path)), input);

export const createRequirementsStage = <TPrincipal>(config: {
  readonly probes: ReadonlyMap<string, RequirementProbe<TPrincipal>>;
  readonly budgetMs: number;
}): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.requirements,
  phase: 'resolution',
  requires: ['catalog', 'principal', 'draft', 'answers', 'resolvedInput'],
  provides: ['resolvedInput', 'answers'],
  budget: {
    timeoutMs: config.budgetMs,
    onTimeout: { stage: 'resolution', code: 'RESOLUTION_UNAVAILABLE', retryable: true },
  },
  async run(context, next) {
    const draft = context.get('draft');
    const probe = config.probes.get(draft.capabilityId);
    if (!probe) {
      return next();
    }
    const entry = context.get('catalog').get(draft.capabilityId);
    if (!entry) {
      return capabilityNotFound;
    }
    const answers = context.get('answers');
    const unfilled = withoutRequirementValues(context.get('resolvedInput'), entry.requirementPaths);
    let fields: readonly MissingField[];
    try {
      fields = await probe.probe(
        context.get('principal'),
        { ...draft, input: unfilled },
        { signal: context.signal },
      );
    } catch (error) {
      return unavailableUnlessAborted(context.signal, error);
    }
    const undeclared = fields.some(({ path }) => !isDeclaredPath(path, entry.requirementPaths));
    if (undeclared) {
      return resolutionUnavailable(false);
    }
    let input = unfilled;
    const unanswered: MissingField[] = [];
    const consumed: string[] = [];
    for (const field of fields) {
      if (!Object.hasOwn(answers, field.path)) {
        unanswered.push(field);
        continue;
      }
      const ids = idsOf(answers[field.path]);
      if (!ids || !isValidSelection(field, ids)) {
        return invalidInputInResolution;
      }
      input = setAtPath(input, field.path, ids);
      consumed.push(field.path);
    }
    if (unanswered.length > 0) {
      return { ok: true, value: { status: 'incomplete', draft, missing: unanswered } };
    }
    context.set('resolvedInput', input);
    context.set('answers', withoutAnswers(answers, consumed));
    return next();
  },
});
