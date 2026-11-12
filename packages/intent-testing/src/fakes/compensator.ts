import {
  abortFailure,
  type CompensationRequest,
  type Compensator,
  type EffectResult,
} from '@jcsoftdev/intent-core';

const compensated: EffectResult<unknown> = { ok: true, output: null };

export const createFakeCompensator = (
  compensate: (request: CompensationRequest) => EffectResult<unknown> = () => compensated,
): Compensator & {
  calls(): readonly CompensationRequest[];
  applied(): readonly string[];
} => {
  const received: CompensationRequest[] = [];
  const settledByKey = new Map<string, EffectResult<unknown>>();
  const appliedKeys: string[] = [];
  return {
    calls: () => [...received],
    applied: () => [...appliedKeys],
    async compensate(request, { signal }) {
      received.push(request);
      if (signal.aborted) {
        return { ok: false, failure: abortFailure('execution') };
      }
      const known = settledByKey.get(request.idempotencyKey);
      if (known) {
        return known;
      }
      const result = compensate(request);
      appliedKeys.push(request.idempotencyKey);
      if (result.ok) {
        settledByKey.set(request.idempotencyKey, result);
      }
      return result;
    },
  };
};
