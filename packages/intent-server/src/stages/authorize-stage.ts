import type { Authorizer, Interpretation, Stage } from '@jcsoftdev/intent-core';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';
import { capabilityNotFound } from './entities-stage.js';

export const createAuthorizeStage = <TPrincipal>(
  authorizer: Authorizer<TPrincipal>,
): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.authorize,
  phase: 'policy',
  requires: ['catalog', 'principal', 'draft', 'validInput'],
  provides: ['decision'],
  async run(context, next) {
    const entry = context.get('catalog').get(context.get('draft').capabilityId);
    if (!entry) {
      return capabilityNotFound;
    }
    const decision = await authorizer.authorize(context.get('principal'), entry.descriptor, {
      signal: context.signal,
    });
    if (!decision.allowed) {
      return { ok: false, failure: decision.failure };
    }
    context.set('decision', decision);
    return next();
  },
});
