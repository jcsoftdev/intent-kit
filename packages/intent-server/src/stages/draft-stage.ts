import { getAtPath } from '@jcsoftdev/intent-core';
import type { Answers, Draft, Interpretation, Stage } from '@jcsoftdev/intent-core';
import type { CatalogEntry } from '../catalog/server-catalog.js';
import type { InterpretationCopy } from '../copy.js';
import { numberWordsOf } from '../text/normalize.js';
import { splitLeadingNumber } from '../text/pattern.js';
import type { CapturedSplit } from '../text/pattern.js';
import { buildDraftInput, slotPathOf } from '../text/slots.js';
import { INTERPRETATION_STAGES } from '../state.js';
import type { InterpretationState, NumberSplit } from '../state.js';

type NumberWords = ReadonlyMap<string, number>;

const numberSplitAt = (
  entry: CatalogEntry,
  textPath: string,
  whole: string,
  words: NumberWords,
): NumberSplit | undefined => {
  const numberPath = entry.numberSplits.get(textPath);
  const leading = splitLeadingNumber(whole, words);
  return numberPath === undefined || leading === undefined
    ? undefined
    : { textPath, numberPath, whole, ...leading };
};

const capturedNumberSplits = (
  entry: CatalogEntry,
  captured: readonly CapturedSplit[],
  words: NumberWords,
): readonly NumberSplit[] =>
  captured.flatMap(({ textSlot, whole }) => {
    const textPath = slotPathOf(entry.slots, textSlot);
    const split = textPath === undefined ? undefined : numberSplitAt(entry, textPath, whole, words);
    return split ? [split] : [];
  });

const unsplitNumberSplits = (
  entry: CatalogEntry,
  draft: Draft,
  words: NumberWords,
): readonly NumberSplit[] =>
  [...entry.numberSplits].flatMap(([textPath, numberPath]) => {
    const whole: unknown = getAtPath(draft.input, textPath);
    const split =
      typeof whole === 'string' && getAtPath(draft.input, numberPath) === undefined
        ? numberSplitAt(entry, textPath, whole, words)
        : undefined;
    return split ? [split] : [];
  });

const answeredNumberSplits = (
  entry: CatalogEntry,
  draft: Draft,
  answers: Answers,
  words: NumberWords,
): readonly NumberSplit[] => {
  const unsplit = unsplitNumberSplits(entry, draft, words);
  return unsplit.some(({ textPath }) => Object.hasOwn(answers, textPath)) ? unsplit : [];
};

export const createDraftStage = <TPrincipal>(
  copy: InterpretationCopy,
  numberWords: NumberWords = numberWordsOf(),
): Stage<InterpretationState<TPrincipal>, Interpretation> => ({
  name: INTERPRETATION_STAGES.draft,
  phase: 'interpretation',
  requires: ['catalog'],
  provides: ['draft', 'answers', 'numberSplits'],
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
      const answers = context.find('answers') ?? {};
      context.set('answers', answers);
      context.set('numberSplits', answeredNumberSplits(entry, seeded, answers, numberWords));
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
    context.set(
      'numberSplits',
      capturedNumberSplits(entry, context.find('capturedSplits') ?? [], numberWords),
    );
    context.set('answers', {});
    return next();
  },
});
