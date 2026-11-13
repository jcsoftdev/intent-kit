import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Toaster } from '@jcsoftdev/ui/overlays';
import { copy } from '../test/support.js';

const intent = vi.hoisted(() => ({
  state: { name: 'presenting', planId: 'p7' } as { name: string; planId?: string },
  undo: vi.fn(),
}));

vi.mock('@jcsoftdev/intent-react', () => ({
  useIntentSession: () => ({ session: { undo: intent.undo }, state: intent.state }),
}));

const { useUndoToast } = await import('./use-undo-toast.js');

afterEach(() => {
  cleanup();
  intent.undo.mockReset();
  intent.state = { name: 'presenting', planId: 'p7' };
});

const message = (planId: string) => `Hecho ${planId}`;

const Probe = ({ isUndoable }: { isUndoable?: (planId: string) => boolean }) => {
  useUndoToast({ copy, message, ...(isUndoable ? { isUndoable } : {}) });
  return <Toaster />;
};

test('the toast offers undo for the presenting plan and undo calls the session', async () => {
  render(<Probe />);
  fireEvent.click(await screen.findByRole('button', { name: copy.undo }));
  expect(intent.undo).toHaveBeenCalledWith('p7');
  expect(screen.queryByText('Hecho p7')).not.toBeNull();
});

test('no toast while the plan is not undoable', async () => {
  intent.state = { name: 'presenting', planId: 'p8' };
  render(<Probe isUndoable={() => false} />);
  await act(async () => undefined);
  expect(screen.queryByText('Hecho p8')).toBeNull();
});

test('no toast outside the presenting state', async () => {
  intent.state = { name: 'completed', planId: 'p9' };
  render(<Probe />);
  await act(async () => undefined);
  expect(screen.queryByText('Hecho p9')).toBeNull();
});
