import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { createRecordingTargets, createTestKit, wrapperOf } from '../test/support.js';
import { useIntentSession } from './use-intent-session.js';

test('useIntentSession re-renders on every state change', () => {
  const wrapper = wrapperOf(createTestKit(), createRecordingTargets());
  const { result } = renderHook(() => useIntentSession(), { wrapper });
  expect(result.current.state.name).toBe('idle');
  act(() => {
    result.current.session.capture('typing');
  });
  expect(result.current.state).toEqual({ name: 'capturing', mode: 'typing' });
  act(() => {
    result.current.session.cancel();
  });
  expect(result.current.state.name).toBe('cancelled');
  act(() => {
    result.current.session.reset();
  });
  expect(result.current.state.name).toBe('idle');
});

test('useIntentSession throws outside a provider', () => {
  expect(() => renderHook(() => useIntentSession())).toThrow(/IntentProvider/);
});
