import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { createRecordingTargets, createTestKit, wrapperOf } from '../test/support.js';
import { useIntentTarget } from './use-intent-target.js';

function Row({ orderId }: { orderId: string }) {
  const attach = useIntentTarget(
    { intent: 'my-order', key: orderId },
    { role: 'row', requireName: true },
  );
  return <div ref={attach} role="row" aria-label={orderId} />;
}

test('useIntentTarget registers on mount and unregisters on unmount', () => {
  const targets = createRecordingTargets();
  const Wrapper = wrapperOf(createTestKit(), targets);
  const view = render(<Row orderId="o-1" />, { wrapper: Wrapper });
  expect(targets.registered()).toEqual(['my-order:o-1']);
  expect(targets.find({ intent: 'my-order', key: 'o-1' })).toBe(view.getByRole('row'));
  view.unmount();
  expect(targets.registered()).toEqual([]);
});

test('useIntentTarget moves the registration when the key changes', () => {
  const targets = createRecordingTargets();
  const Wrapper = wrapperOf(createTestKit(), targets);
  const view = render(<Row orderId="o-1" />, { wrapper: Wrapper });
  view.rerender(<Row orderId="o-2" />);
  expect(targets.registered()).toEqual(['my-order:o-2']);
});
