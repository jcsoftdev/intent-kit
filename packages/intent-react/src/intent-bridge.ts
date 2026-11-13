import type { SemanticExpectation, TargetRef, TargetRegistry } from '@jcsoftdev/intent-core';

export interface IntentBridge {
  registerTarget(ref: TargetRef, element: Element, expectation: SemanticExpectation): () => void;
}

export function createIntentBridge(targets: TargetRegistry<Element>): IntentBridge {
  return {
    registerTarget: (ref, element, expectation) => targets.register(ref, element, expectation),
  };
}
