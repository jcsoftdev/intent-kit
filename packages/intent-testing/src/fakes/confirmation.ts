import type { ConfirmationPort, ConfirmationRequest } from '@jcsoftdev/intent-core';

export const createScriptedConfirmation = (
  answers: readonly ('confirmed' | 'declined')[],
): ConfirmationPort & { requests(): readonly ConfirmationRequest[] } => {
  const pending = [...answers];
  const received: ConfirmationRequest[] = [];
  return {
    requests: () => [...received],
    async confirm(request, { signal }) {
      signal.throwIfAborted();
      received.push(request);
      const answer = pending.shift();
      if (answer === undefined) {
        throw new Error(`No scripted confirmation answer left for plan ${request.planId}`);
      }
      return answer;
    },
  };
};
