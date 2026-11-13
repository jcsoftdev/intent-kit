import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { ConfirmationRequest } from '@jcsoftdev/intent-core';
import { copy } from '../test/support.js';
import { createDialogConfirmationPort } from './dialog-confirmation-port.js';

afterEach(cleanup);

const request = (heard?: string): ConfirmationRequest => ({
  planId: 'p1',
  capabilityId: 'order.cancel',
  risk: 'destructive',
  summary: 'Cancelar el pedido 12',
  ...(heard === undefined ? {} : { heard }),
});

const open = (heard?: string) => {
  const { port, Dialog } = createDialogConfirmationPort();
  render(<Dialog copy={copy} />);
  let answer: Promise<'confirmed' | 'declined'> | undefined;
  act(() => {
    answer = port.confirm(request(heard), { signal: new AbortController().signal });
  });
  return { port, answer: () => answer! };
};

test('with heard the dialog shows the heard line and resolves confirmed on confirm', async () => {
  const { answer } = open('cancela el doce');
  const dialog = await screen.findByRole('alertdialog', { name: 'Cancelar el pedido 12' });
  expect(dialog.textContent).toContain('Escuché: «cancela el doce»');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await answer()).toBe('confirmed');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('Esc and decline resolve declined', async () => {
  const first = open();
  await screen.findByRole('alertdialog');
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  expect(await first.answer()).toBe('declined');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  cleanup();

  const second = open();
  await screen.findByRole('alertdialog');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(await second.answer()).toBe('declined');
});

test('the dialog without heard shows only the summary', async () => {
  open();
  const dialog = await screen.findByRole('alertdialog', { name: 'Cancelar el pedido 12' });
  expect(dialog.textContent).not.toContain('Escuché');
});

test('focus starts on the decline action', async () => {
  open('cancela el doce');
  const decline = await screen.findByRole('button', { name: 'Cancelar' });
  await waitFor(() => expect(document.activeElement).toBe(decline));
});

test('an aborted signal declines and closes the dialog', async () => {
  const { port, Dialog } = createDialogConfirmationPort();
  render(<Dialog copy={copy} />);
  const controller = new AbortController();
  let answer: Promise<'confirmed' | 'declined'> | undefined;
  act(() => {
    answer = port.confirm(request(), { signal: controller.signal });
  });
  await screen.findByRole('alertdialog');
  act(() => controller.abort());
  expect(await answer).toBe('declined');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});
