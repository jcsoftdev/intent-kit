import { expect, test } from 'vitest';
import type { SemanticExpectation, TargetRef } from '@jcsoftdev/intent-core';
import { createIntentBridge } from './intent-bridge.js';
import { createRecordingTargets } from '../test/support.js';

interface UiIntentBridge {
  registerTarget(ref: TargetRef, element: Element, expectation: SemanticExpectation): () => void;
}

test('createIntentBridge assigns to ui IntentBridge', () => {
  const targets = createRecordingTargets();
  const bridge: UiIntentBridge = createIntentBridge(targets);
  const element = document.createElement('div');
  const unregister = bridge.registerTarget({ intent: 'a' }, element, {
    role: 'row',
    requireName: false,
  });
  expect(targets.find({ intent: 'a' })).toBe(element);
  unregister();
  expect(targets.find({ intent: 'a' })).toBeUndefined();
});
