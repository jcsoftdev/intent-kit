import type { Interpretation, Proposal, Stage } from '@jcsoftdev/intent-core';
import type { CatalogEntry, ServerCatalogView } from '../catalog/server-catalog.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

const DETERMINISTIC_CONFIDENCE = 1;

const proposalOf = (entry: CatalogEntry, normalized: string): Proposal | undefined => {
  for (const pattern of entry.patterns) {
    const slots = pattern.match(normalized);
    if (slots) {
      return {
        capabilityId: entry.descriptor.id,
        slots,
        confidence: DETERMINISTIC_CONFIDENCE,
      };
    }
  }
  return undefined;
};

const proposalsOf = (view: ServerCatalogView, normalized: string): readonly Proposal[] =>
  view.entries.flatMap((entry) => {
    const proposal = proposalOf(entry, normalized);
    return proposal ? [proposal] : [];
  });

export const createDeterministicStage = <TPrincipal>(): Stage<
  InterpretationState<TPrincipal>,
  Interpretation
> => ({
  name: INTERPRETATION_STAGES.deterministic,
  phase: 'interpretation',
  requires: ['normalizedText', 'catalog'],
  provides: ['proposal', 'origin'],
  async run(context, next) {
    if (context.has('draft')) {
      return next();
    }
    const view = context.get('catalog');
    const proposals = proposalsOf(view, context.get('normalizedText'));
    const [only, ...others] = proposals;
    if (!only) {
      return next();
    }
    if (others.length === 0) {
      context.set('proposal', only);
      context.set('origin', 'deterministic');
      return next();
    }
    return {
      ok: true,
      value: {
        status: 'ambiguous',
        candidates: proposals.map(({ capabilityId }) => ({
          kind: 'capability',
          capabilityId,
          label: view.get(capabilityId)?.descriptor.description ?? capabilityId,
        })),
      },
    };
  },
});
