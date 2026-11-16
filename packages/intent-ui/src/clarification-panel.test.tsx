import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { SessionState } from '@jcsoftdev/intent-core';
import { copy } from '../test/support.js';
import { ClarificationPanel } from './clarification-panel.js';

afterEach(cleanup);

type Clarifying = Extract<SessionState, { name: 'clarifying' }>;

const draft = { capabilityId: 'dish.markReady', version: 1, input: {} };

const incomplete: Clarifying = {
  name: 'clarifying',
  interpretation: {
    status: 'incomplete',
    draft,
    missing: [
      {
        path: 'dishId',
        reason: 'required',
        prompt: 'plato',
        options: [
          { id: 'd1', label: 'Arroz con pollo' },
          { id: 'd2', label: 'Lomo saltado', detail: 'S/ 32' },
          { id: 'd3', label: 'Ceviche' },
        ],
      },
    ],
  },
};

test('the clarification options are navigable with arrows and Enter answers the option id', () => {
  const onAnswer = vi.fn();
  render(<ClarificationPanel state={incomplete} onAnswer={onAnswer} copy={copy} />);
  const group = screen.getByRole('radiogroup', { name: 'Elige: plato' });
  const options = screen.getAllByRole('radio');
  expect(group).toBeTruthy();
  expect(options.map((option) => option.textContent)).toEqual([
    'Arroz con pollo',
    'Lomo saltadoS/ 32',
    'Ceviche',
  ]);
  options[0]?.focus();
  fireEvent.keyDown(options[0]!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(options[1]);
  fireEvent.keyDown(options[1]!, { key: 'ArrowUp' });
  fireEvent.keyDown(options[0]!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(options[2]);
  fireEvent.click(options[1]!);
  expect(onAnswer).toHaveBeenCalledWith({ dishId: 'd2' });
});

test('ambiguous entity candidates answer with their path', () => {
  const onAnswer = vi.fn();
  const ambiguous: Clarifying = {
    name: 'clarifying',
    interpretation: {
      status: 'ambiguous',
      draft,
      candidates: [
        { kind: 'entity', path: 'tableId', option: { id: 't4', label: 'Mesa 4' } },
        { kind: 'entity', path: 'tableId', option: { id: 't14', label: 'Mesa 14' } },
      ],
    },
  };
  render(<ClarificationPanel state={ambiguous} onAnswer={onAnswer} copy={copy} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Mesa 14' }));
  expect(onAnswer).toHaveBeenCalledWith({ tableId: 't14' });
});

test('a clarification without closed options renders nothing', () => {
  const open: Clarifying = {
    name: 'clarifying',
    interpretation: {
      status: 'incomplete',
      draft,
      missing: [{ path: 'note', reason: 'required', prompt: 'nota' }],
    },
  };
  const { container } = render(<ClarificationPanel state={open} onAnswer={vi.fn()} copy={copy} />);
  expect(container.innerHTML).toBe('');
});
