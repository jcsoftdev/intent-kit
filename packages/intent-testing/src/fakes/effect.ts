import {
  abortFailure,
  type Effect,
  type EffectContext,
  type EffectResult,
} from '@jcsoftdev/intent-core';

export const createFakeEffect = <TInput, TOutput>(
  run: (input: TInput) => EffectResult<TOutput>,
): Effect<TInput, TOutput> & {
  calls(): readonly { readonly input: TInput; readonly context: EffectContext }[];
} => {
  const received: { readonly input: TInput; readonly context: EffectContext }[] = [];
  return {
    calls: () => [...received],
    async run(input, context) {
      received.push({ input, context });
      if (context.signal.aborted) {
        return { ok: false, failure: abortFailure('execution') };
      }
      return run(input);
    },
  };
};
