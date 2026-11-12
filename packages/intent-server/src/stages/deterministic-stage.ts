import type { Interpretation, Proposal, Stage } from '@jcsoftdev/intent-core';
import type { CatalogEntry, ServerCatalogView } from '../catalog/server-catalog.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

const DETERMINISTIC_CONFIDENCE = 1;

interface Match {
  readonly proposal: Proposal;
  readonly alternatives: readonly Proposal['slots'][];
}

const matchOf = (entry: CatalogEntry, normalized: string): Match | undefined => {
  for (const pattern of entry.patterns) {
    const slots = pattern.match(normalized);
    if (slots) {
      return {
        proposal: {
          capabilityId: entry.descriptor.id,
          slots,
          confidence: DETERMINISTIC_CONFIDENCE,
        },
        alternatives: pattern.alternatives(normalized),
      };
    }
  }
  return undefined;
};

const matchesOf = (view: ServerCatalogView, normalized: string): readonly Match[] =>
  view.entries.flatMap((entry) => {
    const match = matchOf(entry, normalized);
    return match ? [match] : [];
  });

export const createDeterministicStage = <TPrincipal>(): Stage<
  InterpretationState<TPrincipal>,
  Interpretation
> => ({
  name: INTERPRETATION_STAGES.deterministic,
  phase: 'interpretation',
  requires: ['normalizedText', 'catalog'],
  provides: ['proposal', 'origin', 'alternativeSlots'],
  async run(context, next) {
    if (context.has('draft')) {
      return next();
    }
    const view = context.get('catalog');
    const matches = matchesOf(view, context.get('normalizedText'));
    const proposals = matches.map(({ proposal }) => proposal);
    const [only, ...others] = matches;
    if (!only) {
      return next();
    }
    if (others.length === 0) {
      context.set('proposal', only.proposal);
      context.set('alternativeSlots', only.alternatives);
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
