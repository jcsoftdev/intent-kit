import type { CompensationRequest, Compensator } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

export function describeCompensatorContract(
  name: string,
  factory: () => {
    readonly compensator: Compensator;
    readonly request: CompensationRequest;
    readonly sideEffects: () => number;
  },
): void {
  describe(`${name} compensator contract`, () => {
    it('with an already-aborted signal resolves an ABORTED execution failure and causes no side effects', async () => {
      const { compensator, request, sideEffects } = factory();
      const before = sideEffects();
      const result = await compensator.compensate(request, {
        signal: AbortSignal.abort(new Error('already aborted')),
      });
      expect(result).toEqual({
        ok: false,
        failure: { stage: 'execution', code: 'ABORTED', retryable: true },
      });
      expect(sideEffects()).toBe(before);
    });

    it('the same idempotency key sent twice compensates once and answers the same result', async () => {
      const { compensator, request, sideEffects } = factory();
      const before = sideEffects();
      const first = await compensator.compensate(request, {
        signal: new AbortController().signal,
      });
      const retry = await compensator.compensate(
        { ...request },
        { signal: new AbortController().signal },
      );
      expect(first.ok).toBe(true);
      expect(retry).toEqual(first);
      expect(sideEffects() - before).toBe(1);
    });
  });
}
