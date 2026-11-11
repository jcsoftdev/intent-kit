import type { Interpretation, Interpreter, Proposal, Stage } from '@jcsoftdev/intent-core';
import type { InterpretationCopy } from '../copy.js';
import type { ServerCatalogView } from '../catalog/server-catalog.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

const DEFAULT_BUDGET_MS = 4000;
const MIN_TOP_CONFIDENCE = 0.6;
const MIN_CONFIDENCE_GAP = 0.2;

const unsupported = (copy: InterpretationCopy, view: ServerCatalogView): Interpretation => ({
  status: 'unsupported',
  suggestions: copy.suggestions(view),
});

const bestPerCapability = (
  proposals: readonly Proposal[],
  view: ServerCatalogView,
): readonly Proposal[] => {
  const best = new Map<string, Proposal>();
  for (const proposal of proposals) {
    const known = best.get(proposal.capabilityId);
    if (view.get(proposal.capabilityId) && (!known || proposal.confidence > known.confidence)) {
      best.set(proposal.capabilityId, proposal);
    }
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
};

const isDecisive = (ranked: readonly Proposal[]): boolean => {
  const [top, second] = ranked;
  if (!top) {
    return false;
  }
  return (
    !second ||
    (top.confidence >= MIN_TOP_CONFIDENCE &&
      top.confidence - second.confidence >= MIN_CONFIDENCE_GAP)
  );
};

export const createInterpretStage = <TPrincipal>(config: {
  readonly interpreter?: Interpreter;
  readonly copy: InterpretationCopy;
  readonly budgetMs?: number;
}): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.interpret,
  phase: 'interpretation',
  requires: ['input', 'catalog'],
  provides: ['proposal', 'origin'],
  budget: {
    timeoutMs: config.budgetMs ?? DEFAULT_BUDGET_MS,
    onTimeout: { stage: 'interpretation', code: 'INTERPRETER_TIMEOUT', retryable: true },
  },
  async run(context, next) {
    const input = context.get('input');
    if (context.has('proposal') || context.has('draft') || input.kind !== 'utterance') {
      return next();
    }
    const view = context.get('catalog');
    if (!config.interpreter) {
      return { ok: true, value: unsupported(config.copy, view) };
    }
    let result;
    try {
      result = await config.interpreter.interpret(
        {
          text: input.text,
          locale: input.locale,
          source: input.source,
          catalog: view.entries.map((entry) => entry.manifest),
          context: input.context,
        },
        { signal: context.signal },
      );
    } catch (error) {
      if (context.signal.aborted) {
        throw error;
      }
      return {
        ok: false,
        failure: { stage: 'interpretation', code: 'INTERPRETER_UNAVAILABLE', retryable: true },
      };
    }
    const ranked = result.status === 'proposed' ? bestPerCapability(result.proposals, view) : [];
    const [top] = ranked;
    if (!top) {
      return { ok: true, value: unsupported(config.copy, view) };
    }
    if (!isDecisive(ranked)) {
      return {
        ok: true,
        value: {
          status: 'ambiguous',
          candidates: ranked.map(({ capabilityId }) => ({
            kind: 'capability',
            capabilityId,
            label: view.get(capabilityId)?.descriptor.description ?? capabilityId,
          })),
        },
      };
    }
    context.set('proposal', top);
    context.set('origin', 'interpreter');
    return next();
  },
});
