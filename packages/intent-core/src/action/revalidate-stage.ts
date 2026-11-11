import { stageName } from '../contracts/index.js';
import type { Authorizer, CapabilityRegistry, Failure } from '../contracts/index.js';
import { validateWithSchema } from '../primitives/index.js';
import type { ActionStage } from './action-pipeline.js';

export const REVALIDATE_STAGE = stageName('revalidate');

const capabilityNotFound: Failure = {
  stage: 'policy',
  code: 'CAPABILITY_NOT_FOUND',
  retryable: false,
};
const stalePlan: Failure = { stage: 'interpretation', code: 'STALE_PLAN', retryable: false };

export interface RevalidateDependencies<TPrincipal> {
  readonly registry: CapabilityRegistry;
  readonly authorizer: Authorizer<TPrincipal>;
}

export const createRevalidateStage = <TPrincipal, TRole extends string>(
  dependencies: RevalidateDependencies<TPrincipal>,
): ActionStage<TPrincipal, TRole> => ({
  name: REVALIDATE_STAGE,
  phase: 'policy',
  requires: ['plan', 'principal'],
  provides: ['descriptor', 'input'],
  async run(context, next) {
    const { draft } = context.get('plan');
    const descriptor = dependencies.registry.get(draft.capabilityId);
    if (!descriptor) {
      return { ok: false, failure: capabilityNotFound };
    }
    if (draft.version !== descriptor.version) {
      return { ok: false, failure: stalePlan };
    }
    const validated = await validateWithSchema(descriptor.input, draft.input);
    if (!validated.ok) {
      return validated;
    }
    const decision = await dependencies.authorizer.authorize(context.get('principal'), descriptor, {
      signal: context.signal,
    });
    if (!decision.allowed) {
      return { ok: false, failure: decision.failure };
    }
    context.set('descriptor', descriptor);
    context.set('input', validated.value);
    return next();
  },
});
