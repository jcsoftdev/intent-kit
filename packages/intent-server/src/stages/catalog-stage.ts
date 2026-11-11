import type { Interpretation, PrincipalRoles, Stage } from '@jcsoftdev/intent-core';
import type { ServerCatalog } from '../catalog/server-catalog.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

export const createCatalogStage = <TPrincipal, TRole extends string>(
  catalog: ServerCatalog,
  rolesOf: (principal: TPrincipal) => PrincipalRoles<TRole>,
): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.catalog,
  phase: 'policy',
  requires: ['input', 'principal'],
  provides: ['catalog'],
  async run(context, next) {
    const { active, granted } = rolesOf(context.get('principal'));
    if (!granted.includes(active)) {
      return { ok: false, failure: { stage: 'policy', code: 'UNAUTHORIZED', retryable: false } };
    }
    const input = context.get('input');
    context.set(
      'catalog',
      catalog.viewFor(active, input.kind === 'utterance' ? input.restrictTo : undefined),
    );
    return next();
  },
});
