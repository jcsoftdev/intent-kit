import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../test/support.js';
import { CloudVoiceNotice } from './cloud-voice-notice.js';

afterEach(cleanup);

test('the notice shows its copy and accept and decline call back', async () => {
  const onAccept = vi.fn();
  const onDecline = vi.fn();
  render(<CloudVoiceNotice open copy={copy} onAccept={onAccept} onDecline={onDecline} />);
  const dialog = await screen.findByRole('alertdialog', { name: copy.cloudNotice.title });
  expect(dialog.textContent).toContain(copy.cloudNotice.body);
  fireEvent.click(screen.getByRole('button', { name: copy.cloudNotice.accept }));
  await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: copy.cloudNotice.decline }));
  expect(onDecline).toHaveBeenCalledTimes(1);
});

test('the notice renders nothing while closed', () => {
  render(<CloudVoiceNotice open={false} copy={copy} onAccept={vi.fn()} onDecline={vi.fn()} />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
