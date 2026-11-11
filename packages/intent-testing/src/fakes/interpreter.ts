import {
  IntentFailureError,
  systemClock,
  type Clock,
  type InterpretRequest,
  type Interpreter,
  type InterpreterResult,
} from '@jcsoftdev/intent-core';

const INTERPRETER_UNAVAILABLE = new IntentFailureError({
  stage: 'interpretation',
  code: 'INTERPRETER_UNAVAILABLE',
  retryable: true,
});

export const createFakeInterpreter = (
  script: (request: InterpretRequest) => InterpreterResult,
  options: { readonly delayMs?: number; readonly clock?: Clock; readonly fail?: boolean } = {},
): Interpreter & { calls(): readonly InterpretRequest[] } => {
  const received: InterpretRequest[] = [];
  const clock = options.clock ?? systemClock;
  return {
    calls: () => [...received],
    async interpret(request, { signal }) {
      received.push(request);
      signal.throwIfAborted();
      if (options.delayMs !== undefined) {
        await clock.delay(options.delayMs, { signal });
      }
      if (options.fail) {
        throw INTERPRETER_UNAVAILABLE;
      }
      return script(request);
    },
  };
};
