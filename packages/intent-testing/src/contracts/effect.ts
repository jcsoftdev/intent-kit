import { FAILURE_CODES, FAILURE_STAGES, type Effect } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

const PLAN_ID = 'contract-plan';

export function describeEffectContract<TInput>(
  name: string,
  factory: () => {
    readonly effect: Effect<TInput, unknown>;
    readonly input: TInput;
    readonly sideEffects: () => number;
  },
): void {
  describe(`${name} effect contract`, () => {
    it('with an already-aborted signal resolves an ABORTED execution failure and causes no side effects', async () => {
      const { effect, input, sideEffects } = factory();
      const before = sideEffects();
      const result = await effect.run(input, {
        signal: AbortSignal.abort(new Error('already aborted')),
        planId: PLAN_ID,
      });
      expect(result).toEqual({
        ok: false,
        failure: { stage: 'execution', code: 'ABORTED', retryable: true },
      });
      expect(sideEffects()).toBe(before);
    });

    it('a normal run resolves a well-formed EffectResult and never throws', async () => {
      const { effect, input } = factory();
      const result = await effect.run(input, {
        signal: new AbortController().signal,
        planId: PLAN_ID,
      });
      if (result.ok) {
        expect(result).toHaveProperty('output');
      } else {
        expect(FAILURE_STAGES).toContain(result.failure.stage);
        expect(FAILURE_CODES).toContain(result.failure.code);
        expect(typeof result.failure.retryable).toBe('boolean');
      }
    });
  });
}
