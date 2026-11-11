import type { Interpretation, Stage } from '@jcsoftdev/intent-core';
import type { InterpretationCopy } from '../copy.js';
import { buildDraftInput } from '../text/slots.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

export const createDraftStage = <TPrincipal>(
  copy: InterpretationCopy,
): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.draft,
  phase: 'interpretation',
  requires: ['catalog'],
  provides: ['draft', 'answers'],
  async run(context, next) {
    const view = context.get('catalog');
    const seeded = context.find('draft');
    if (seeded) {
      const entry = view.get(seeded.capabilityId);
      if (!entry) {
        return { ok: true, value: { status: 'unsupported', suggestions: copy.suggestions(view) } };
      }
      if (entry.descriptor.version !== seeded.version) {
        return {
          ok: false,
          failure: { stage: 'interpretation', code: 'STALE_PLAN', retryable: false },
        };
      }
      context.set('answers', context.find('answers') ?? {});
      return next();
    }
    const proposal = context.get('proposal');
    const entry = view.get(proposal.capabilityId);
    if (!entry) {
      return { ok: true, value: { status: 'unsupported', suggestions: copy.suggestions(view) } };
    }
    context.set('draft', {
      capabilityId: entry.descriptor.id,
      version: entry.descriptor.version,
      input: buildDraftInput(entry.slots, proposal.slots),
    });
    context.set('answers', {});
    return next();
  },
});
