import type { Effect, EffectResult, FormBinding } from '../contracts/index.js';

const aborted: EffectResult<unknown> = {
  ok: false,
  failure: { stage: 'execution', code: 'ABORTED', retryable: true },
};
const incomplete: EffectResult<unknown> = {
  ok: false,
  failure: { stage: 'execution', code: 'INVALID_INPUT', retryable: false },
};

const isPatch = (input: unknown): input is object => typeof input === 'object' && input !== null;

export const createFormFillEffect = (binding: FormBinding<unknown>): Effect<unknown, unknown> => ({
  async run(input, context) {
    if (context.signal.aborted) {
      return aborted;
    }
    if (!isPatch(input)) {
      return incomplete;
    }
    binding.fill(input);
    if (!binding.isComplete()) {
      return incomplete;
    }
    try {
      return await binding.submit({ signal: context.signal });
    } catch (error) {
      if (context.signal.aborted) {
        return aborted;
      }
      throw error;
    }
  },
});
