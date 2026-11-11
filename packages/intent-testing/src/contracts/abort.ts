import { expect } from 'vitest';

export const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Settlement<T> =
  | { readonly kind: 'resolved'; readonly value: T }
  | { readonly kind: 'rejected'; readonly error: unknown }
  | { readonly kind: 'pending' };

export async function expectAbortHonoredMidCall<T>(
  start: (signal: AbortSignal) => Promise<T>,
): Promise<void> {
  const controller = new AbortController();
  const reason = new Error('aborted during the call');
  const settlement = start(controller.signal).then(
    (value): Settlement<T> => ({ kind: 'resolved', value }),
    (error: unknown): Settlement<T> => ({ kind: 'rejected', error }),
  );
  controller.abort(reason);
  const winner = await Promise.race([
    settlement,
    nextMacrotask().then((): Settlement<T> => ({ kind: 'pending' })),
  ]);
  expect(winner.kind, 'the call was still pending one macrotask after the abort').not.toBe(
    'pending',
  );
  if (winner.kind === 'rejected') {
    expect(winner.error).toBe(reason);
  }
}
