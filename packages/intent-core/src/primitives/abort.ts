import type { Failure, FailureStage } from '../contracts/index.js';

export const abortFailure = (stage: FailureStage): Failure => ({
  stage,
  code: 'ABORTED',
  retryable: stage === 'execution',
});

export const throwIfAborted = (signal: AbortSignal): void => {
  signal.throwIfAborted();
};
