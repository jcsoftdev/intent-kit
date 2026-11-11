import type { IdSource, Interpretation, Terminal } from '@jcsoftdev/intent-core';
import type { InterpretationCopy } from '../copy.js';
import type { InterpretationState } from '../state.js';
import { capabilityNotFound } from './entities-stage.js';

export const createPlanTerminal = <TPrincipal>(config: {
  readonly ids: IdSource;
  readonly copy: InterpretationCopy;
}): Terminal<InterpretationState<TPrincipal>, Interpretation> => ({
  requires: ['catalog', 'draft', 'validInput', 'decision', 'labels', 'origin'],
  async settle(context) {
    const { capabilityId, version } = context.get('draft');
    const entry = context.get('catalog').get(capabilityId);
    if (!entry) {
      return capabilityNotFound;
    }
    const input = context.get('validInput');
    return {
      ok: true,
      value: {
        status: 'complete',
        planId: config.ids.next(),
        draft: { capabilityId, version, input },
        summary: config.copy.summarize({
          descriptor: entry.descriptor,
          input,
          labels: context.get('labels'),
        }),
        source: context.get('origin'),
      },
    };
  },
});
