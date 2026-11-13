import { expect, test } from 'vitest';
import type { ConfirmationPolicy, Reversibility, RiskLevel } from '../contracts/index.js';
import { requiresConfirmation } from './confirmation.js';

const reversibilities: Record<string, Reversibility> = {
  none: { kind: 'none' },
  compensate: { kind: 'compensate', via: 'orders.cancel', windowMs: 1000 },
  grace: { kind: 'grace', delayMs: 1000 },
};

test.each<[ConfirmationPolicy, string, RiskLevel, 'text' | 'voice', boolean]>([
  ['always', 'compensate', 'write', 'text', true],
  ['never', 'compensate', 'write', 'text', false],
  ['never', 'none', 'write', 'voice', true],
  ['never', 'none', 'write', 'text', false],
  ['whenVoice', 'compensate', 'write', 'voice', true],
  ['whenVoice', 'compensate', 'write', 'text', false],
  ['whenIrreversible', 'none', 'write', 'text', true],
  ['whenIrreversible', 'compensate', 'write', 'voice', false],
  ['whenIrreversible', 'grace', 'write', 'voice', false],
  ['never', 'none', 'read', 'voice', false],
  ['never', 'none', 'destructive', 'voice', true],
  ['whenVoice', 'none', 'read', 'voice', true],
  ['always', 'none', 'read', 'voice', true],
  ['whenIrreversible', 'none', 'read', 'text', true],
])(
  'confirmation %s + reversibility %s + risk %s + %s → %s',
  (confirmation, kind, risk, source, expected) => {
    const reversibility = reversibilities[kind] as Reversibility;
    expect(requiresConfirmation({ confirmation, reversibility, risk }, source)).toBe(expected);
  },
);
