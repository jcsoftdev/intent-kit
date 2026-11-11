import type { InterpretRequest, Interpreter, Proposal } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

const isSlotValue = (value: unknown): boolean =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));

const expectWellFormedProposal = (proposal: Proposal): void => {
  expect(typeof proposal.capabilityId).toBe('string');
  expect(Number.isFinite(proposal.confidence)).toBe(true);
  expect(proposal.confidence).toBeGreaterThanOrEqual(0);
  expect(proposal.confidence).toBeLessThanOrEqual(1);
  Object.values(proposal.slots).forEach((value) => expect(isSlotValue(value)).toBe(true));
};

export function describeInterpreterContract(
  name: string,
  factory: () => { readonly interpreter: Interpreter; readonly request: InterpretRequest },
): void {
  describe(`${name} interpreter contract`, () => {
    it('resolves a result whose status is proposed or unsupported', async () => {
      const { interpreter, request } = factory();
      const result = await interpreter.interpret(request, { signal: new AbortController().signal });
      expect(['proposed', 'unsupported']).toContain(result.status);
    });

    it('every proposal has a confidence from 0 to 1 and slot values of string, number, boolean or string array', async () => {
      const { interpreter, request } = factory();
      const result = await interpreter.interpret(request, { signal: new AbortController().signal });
      if (result.status === 'proposed') {
        expect(Array.isArray(result.proposals)).toBe(true);
        result.proposals.forEach(expectWellFormedProposal);
      }
    });

    it('with an already-aborted signal rejects with the reason', async () => {
      const { interpreter, request } = factory();
      const reason = new Error('already aborted');
      const controller = new AbortController();
      controller.abort(reason);
      await expect(interpreter.interpret(request, { signal: controller.signal })).rejects.toBe(
        reason,
      );
    });
  });
}
