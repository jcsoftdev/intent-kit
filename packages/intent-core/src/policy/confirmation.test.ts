import { expect, test } from 'vitest';
import type { ConfirmationPolicy, Reversibility } from '../contracts/index.js';
import { requiresConfirmation } from './confirmation.js';

const reversibilities: Record<string, Reversibility> = {
  none: { kind: 'none' },
  compensate: { kind: 'compensate', via: 'orders.cancel', windowMs: 1000 },
  grace: { kind: 'grace', delayMs: 1000 },
};

test.each<[ConfirmationPolicy, string, 'text' | 'voice', boolean]>([
  ['always', 'compensate', 'text', true],
  ['never', 'compensate', 'text', false],
  ['never', 'none', 'voice', true],
  ['never', 'none', 'text', false],
  ['whenVoice', 'compensate', 'voice', true],
  ['whenVoice', 'compensate', 'text', false],
  ['whenIrreversible', 'none', 'text', true],
  ['whenIrreversible', 'compensate', 'voice', false],
  ['whenIrreversible', 'grace', 'voice', false],
])('confirmation %s + reversibility %s + %s → %s', (confirmation, kind, source, expected) => {
  const reversibility = reversibilities[kind] as Reversibility;
  expect(requiresConfirmation({ confirmation, reversibility }, source)).toBe(expected);
});
