import type { Interpretation, Stage } from '@jcsoftdev/intent-core';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

export const createNormalizeStage = <TPrincipal>(
  normalize: (text: string) => string,
): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.normalize,
  phase: 'interpretation',
  requires: ['input'],
  provides: ['normalizedText'],
  async run(context, next) {
    const input = context.get('input');
    context.set('normalizedText', input.kind === 'utterance' ? normalize(input.text) : '');
    return next();
  },
});
