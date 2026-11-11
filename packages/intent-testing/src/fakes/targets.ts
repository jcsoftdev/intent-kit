import {
  IntentDefinitionError,
  IntentFailureError,
  type SemanticExpectation,
  type TargetRef,
  type TargetRegistry,
} from '@jcsoftdev/intent-core';

export interface FakeElement {
  readonly id: string;
  readonly role: string;
  readonly name: string;
}

export interface FakeTargetRegistry extends TargetRegistry<FakeElement> {
  violations(): readonly { readonly ref: TargetRef; readonly expected: SemanticExpectation }[];
}

interface TargetWaiter {
  readonly key: string;
  readonly resolve: (element: FakeElement) => void;
}

const TARGET_NOT_FOUND = new IntentFailureError({
  stage: 'presentation',
  code: 'TARGET_NOT_FOUND',
  retryable: false,
});

const keyOf = (ref: TargetRef): string => JSON.stringify([ref.intent, ref.key ?? null]);

const violatesExpectation = (element: FakeElement, expectation: SemanticExpectation): boolean =>
  element.role !== expectation.role || (expectation.requireName && element.name.trim() === '');

export const createFakeTargetRegistry = (): FakeTargetRegistry => {
  const elements = new Map<string, FakeElement>();
  const recorded: { readonly ref: TargetRef; readonly expected: SemanticExpectation }[] = [];
  let waiters: TargetWaiter[] = [];

  return {
    violations: () => [...recorded],
    register(ref, element, expectation) {
      const key = keyOf(ref);
      if (elements.has(key)) {
        throw new IntentDefinitionError('DUPLICATE_TARGET', `${ref.intent}:${ref.key ?? ''}`);
      }
      elements.set(key, element);
      if (violatesExpectation(element, expectation)) {
        recorded.push({ ref, expected: expectation });
      }
      const ready = waiters.filter((waiter) => waiter.key === key);
      waiters = waiters.filter((waiter) => waiter.key !== key);
      ready.forEach((waiter) => waiter.resolve(element));
      return () => {
        if (elements.get(key) === element) {
          elements.delete(key);
        }
      };
    },
    find: (ref) => elements.get(keyOf(ref)),
    waitFor(ref, { signal, timeoutMs }) {
      return new Promise<FakeElement>((resolve, reject) => {
        const key = keyOf(ref);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const existing = elements.get(key);
        if (existing) {
          resolve(existing);
          return;
        }
        const finish = (): void => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          waiters = waiters.filter((candidate) => candidate !== waiter);
        };
        const waiter: TargetWaiter = {
          key,
          resolve: (element) => {
            finish();
            resolve(element);
          },
        };
        const onAbort = (): void => {
          finish();
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          finish();
          reject(TARGET_NOT_FOUND);
        }, timeoutMs);
        signal.addEventListener('abort', onAbort, { once: true });
        waiters.push(waiter);
      });
    },
  };
};
