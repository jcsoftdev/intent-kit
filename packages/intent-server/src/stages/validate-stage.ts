import { formatPath, overlaps, parsePath, setAtPath } from '@jcsoftdev/intent-core';
import type { Interpretation, PathSegment, SchemaAdapter, Stage } from '@jcsoftdev/intent-core';
import { pruneToSchema } from '../catalog/prune-input.js';
import type { InterpretationCopy } from '../copy.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';
import {
  answersAreWellFormed,
  capabilityNotFound,
  invalidInputInResolution,
  unavailableUnlessAborted,
} from './entities-stage.js';
import type { ResolverRegistry } from './entities-stage.js';

const FIRST_ITEM = 0;

const concreteSegment = (segment: PathSegment): PathSegment =>
  segment === '[]' ? FIRST_ITEM : segment;

const askedEntityPath = (missing: string, entityPath: string): string => {
  const missingSegments = parsePath(missing);
  const entitySegments = parsePath(entityPath);
  if (missingSegments.length >= entitySegments.length) {
    return missing;
  }
  return formatPath(
    entitySegments.map((segment, index) => concreteSegment(missingSegments[index] ?? segment)),
  );
};

export const createValidateStage = <TPrincipal>(config: {
  readonly schema: SchemaAdapter;
  readonly resolvers: ResolverRegistry<TPrincipal>;
  readonly copy: InterpretationCopy;
}): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.validate,
  phase: 'interpretation',
  requires: ['catalog', 'principal', 'draft', 'answers', 'resolvedInput'],
  provides: ['validInput'],
  async run(context, next) {
    const draft = context.get('draft');
    const answers = context.get('answers');
    const entry = context.get('catalog').get(draft.capabilityId);
    if (!entry) {
      return capabilityNotFound;
    }
    const { descriptor } = entry;
    const answeredPaths = Object.keys(answers);
    if (
      !answersAreWellFormed(answers) ||
      answeredPaths.some((path) =>
        [...descriptor.entities.map((param) => param.path), ...entry.requirementPaths].some(
          (guarded) => overlaps(path, guarded),
        ),
      )
    ) {
      return invalidInputInResolution;
    }
    const askedPaths = await config.schema.missingPaths(
      descriptor.input,
      context.get('resolvedInput'),
      {
        signal: context.signal,
      },
    );
    if (answeredPaths.some((path) => !askedPaths.includes(path))) {
      return invalidInputInResolution;
    }
    const input = answeredPaths.reduce<unknown>(
      (current, path) => setAtPath(current, path, answers[path]),
      context.get('resolvedInput'),
    );
    const validated = await config.schema.validate(descriptor.input, input, {
      signal: context.signal,
    });
    if (validated.ok) {
      context.set('validInput', pruneToSchema(entry.inputShape, validated.value));
      return next();
    }
    const [first] = await config.schema.missingPaths(descriptor.input, input, {
      signal: context.signal,
    });
    if (first === undefined) {
      return { ok: false, failure: validated.failure };
    }
    const param = descriptor.entities.find((candidate) => overlaps(first, candidate.path));
    const asked = param ? askedEntityPath(first, param.path) : first;
    const resolver = param ? config.resolvers.get(param.entity) : undefined;
    let options;
    try {
      options = await resolver?.options(context.get('principal'), asked, draft, {
        signal: context.signal,
      });
    } catch (error) {
      return unavailableUnlessAborted(context.signal, error);
    }
    return {
      ok: true,
      value: {
        status: 'incomplete',
        draft,
        missing: [
          {
            path: asked,
            reason: 'required',
            prompt: config.copy.promptFor(descriptor.id, asked),
            ...(options ? { options } : {}),
          },
        ],
      },
    };
  },
});
