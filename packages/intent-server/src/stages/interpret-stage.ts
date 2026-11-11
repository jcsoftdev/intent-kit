import type { Interpretation, Interpreter, Proposal, Stage } from '@jcsoftdev/intent-core';
import type { InterpretationCopy } from '../copy.js';
import type { ServerCatalogView } from '../catalog/server-catalog.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState } from '../state.js';

const DEFAULT_BUDGET_MS = 4000;
const MIN_TOP_CONFIDENCE = 0.6;
const MIN_CONFIDENCE_GAP = 0.2;
const CONFIDENCE_EPSILON = 1e-9;

const unsupported = (copy: InterpretationCopy, view: ServerCatalogView): Interpretation => ({
  status: 'unsupported',
  suggestions: copy.suggestions(view),
});

const rankInView = (proposals: readonly Proposal[], view: ServerCatalogView): readonly Proposal[] =>
  proposals
    .filter((proposal) => view.get(proposal.capabilityId))
    .sort((a, b) => b.confidence - a.confidence);

const isDecisive = (ranked: readonly Proposal[]): boolean => {
  const [top, second] = ranked;
  if (!top) {
    return false;
  }
  return (
    !second ||
    (top.confidence >= MIN_TOP_CONFIDENCE &&
      top.confidence - second.confidence >= MIN_CONFIDENCE_GAP - CONFIDENCE_EPSILON)
  );
};

const contendersOf = (ranked: readonly Proposal[]): readonly Proposal[] => {
  const [top] = ranked;
  if (!top || top.confidence < MIN_TOP_CONFIDENCE) {
    return ranked;
  }
  return ranked.filter((proposal) => top.confidence - proposal.confidence < MIN_CONFIDENCE_GAP);
};

const sameSlotValue = (a: Proposal['slots'][string], b: Proposal['slots'][string] | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

const agreedSlots = (contenders: readonly Proposal[]): Proposal['slots'] => {
  const [top] = contenders;
  return Object.fromEntries(
    Object.entries(top?.slots ?? {}).filter(([key, value]) =>
      contenders.every((other) => sameSlotValue(value, other.slots[key])),
    ),
  );
};

const sharedCapability = (contenders: readonly Proposal[]): Proposal | undefined => {
  const [top] = contenders;
  return top && contenders.every((other) => other.capabilityId === top.capabilityId)
    ? { ...top, slots: agreedSlots(contenders) }
    : undefined;
};

const capabilityCandidates = (
  contenders: readonly Proposal[],
  view: ServerCatalogView,
): Interpretation => ({
  status: 'ambiguous',
  candidates: [...new Set(contenders.map(({ capabilityId }) => capabilityId))].map(
    (capabilityId) => ({
      kind: 'capability',
      capabilityId,
      label: view.get(capabilityId)?.descriptor.description ?? capabilityId,
    }),
  ),
});

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
    if (view.entries.length === 0 || !config.interpreter) {
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
    const ranked = result.status === 'proposed' ? rankInView(result.proposals, view) : [];
    const [top] = ranked;
    if (!top) {
      return { ok: true, value: unsupported(config.copy, view) };
    }
    const chosen = isDecisive(ranked) ? top : sharedCapability(contendersOf(ranked));
    if (!chosen) {
      return { ok: true, value: capabilityCandidates(contendersOf(ranked), view) };
    }
    context.set('proposal', chosen);
    context.set('origin', 'interpreter');
    return next();
  },
});
