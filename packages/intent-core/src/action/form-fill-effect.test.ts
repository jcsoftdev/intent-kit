import { expect, test } from 'vitest';
import type { EffectContext, FormBinding } from '../contracts/index.js';
import { createFormBindingRegistry } from './form-binding-registry.js';
import { createFormFillEffect } from './form-fill-effect.js';

interface Recorder {
  readonly binding: FormBinding<unknown>;
  readonly filled: object[];
  submits: number;
}

const bindingOf = (complete: boolean): Recorder => {
  const recorder: Recorder = {
    filled: [],
    submits: 0,
    binding: {
      formId: 'order-form',
      read: () => ({}),
      fill(patch) {
        recorder.filled.push(patch);
        return Object.keys(patch);
      },
      isComplete: () => complete,
      async submit() {
        recorder.submits += 1;
        return { ok: true, output: { saved: true } };
      },
    },
  };
  return recorder;
};

const context = (signal = new AbortController().signal): EffectContext => ({
  signal,
  planId: 'p-1',
});

test('a complete form is filled with the input and submitted', async () => {
  const recorder = bindingOf(true);
  const result = await createFormFillEffect(recorder.binding).run({ tableId: 't-3' }, context());
  expect(recorder.filled).toEqual([{ tableId: 't-3' }]);
  expect(recorder.submits).toBe(1);
  expect(result).toEqual({ ok: true, output: { saved: true } });
});

test('an incomplete form after filling → INVALID_INPUT and submit is not called', async () => {
  const recorder = bindingOf(false);
  const result = await createFormFillEffect(recorder.binding).run({ tableId: 't-3' }, context());
  expect(recorder.filled).toEqual([{ tableId: 't-3' }]);
  expect(recorder.submits).toBe(0);
  expect(result).toEqual({
    ok: false,
    failure: { stage: 'execution', code: 'INVALID_INPUT', retryable: false },
  });
});

test('a non-object input never reaches the form', async () => {
  const recorder = bindingOf(true);
  const result = await createFormFillEffect(recorder.binding).run(null, context());
  expect(recorder.filled).toEqual([]);
  expect(result.ok).toBe(false);
});

test('an aborted signal resolves ABORTED without touching the form', async () => {
  const recorder = bindingOf(true);
  const controller = new AbortController();
  controller.abort();
  const result = await createFormFillEffect(recorder.binding).run({}, context(controller.signal));
  expect(recorder.filled).toEqual([]);
  expect(result).toEqual({
    ok: false,
    failure: { stage: 'execution', code: 'ABORTED', retryable: true },
  });
});

test('a stale unregister does not remove a newer binding', () => {
  const registry = createFormBindingRegistry();
  const first = bindingOf(true).binding;
  const second = bindingOf(true).binding;
  const unregisterFirst = registry.register(first, 'orders');
  registry.register(second, 'orders');
  unregisterFirst();
  expect(registry.find('order-form')).toEqual({ binding: second, routeId: 'orders' });
});
