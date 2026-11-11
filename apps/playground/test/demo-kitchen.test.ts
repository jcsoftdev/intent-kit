import type { IntentSession, SessionState } from '@jcsoftdev/intent-core';
import { describe, expect, it, vi } from 'vitest';
import { createPlayground } from '../src/index.js';
import type { Playground } from '../src/index.js';
import { MINUTE_MS, TENANT_ID, seedKitchenLine } from '../src/restaurant.js';
import type { PlaygroundPrincipal } from '../src/restaurant.js';

const GRACE_MS = 5000;
const READY_TEXT = 'el arroz con pollo esta listo';

const kitchen: PlaygroundPrincipal = {
  tenantId: TENANT_ID,
  userId: 'k-1',
  roles: ['kitchen'],
  activeRole: 'kitchen',
};

const waiterOf = (userId: string): PlaygroundPrincipal => ({
  tenantId: TENANT_ID,
  userId,
  roles: ['waiter'],
  activeRole: 'waiter',
});

const seed = (
  playground: Playground,
  index: number,
  tableLabel: string,
  minutesAgo: number,
  waiterId = 'w-1',
): void =>
  playground.store.addLine(
    seedKitchenLine({
      index,
      tableLabel,
      waiterId,
      createdAt: playground.clock.now() - minutesAgo * MINUTE_MS,
    }),
  );

const untilGraceOffered = (playground: Playground): Promise<void> =>
  vi.waitFor(() => expect(playground.kit.undo.active()).toHaveLength(1));

const stateAfter = async (
  session: IntentSession,
  pending: Promise<SessionState>,
): Promise<SessionState> => {
  await pending;
  return session.state();
};

describe('9.2 mark a dish as ready', () => {
  it('sends PREPARANDO then LISTO after the grace window and reveals the kitchen ticket', async () => {
    const playground = createPlayground({ principal: kitchen });
    seed(playground, 1, 'Mesa 3', 12);
    const pending = playground.session.submit({ text: READY_TEXT, source: 'text' });

    await untilGraceOffered(playground);
    expect(playground.store.transitions()).toEqual([]);
    await playground.clock.advance(GRACE_MS);
    const state = await stateAfter(playground.session, pending);

    expect(state.name).toBe('completed');
    expect(playground.store.transitions().map(({ from, to }) => `${from}>${to}`)).toEqual([
      'EN_COLA>PREPARANDO',
      'PREPARANDO>LISTO',
    ]);
    const [line] = playground.store.lines(TENANT_ID);
    expect(playground.revealer.revealed().map(({ element }) => element.id)).toEqual([
      `kitchen-ticket:${line?.orderId}`,
    ]);
    expect(playground.announcer.messages()).toEqual([
      { message: 'Listo: Arroz con pollo · Mesa 3', politeness: 'polite' },
    ]);
  });

  it('asks which line when two are pending, oldest first', async () => {
    const playground = createPlayground({ principal: kitchen });
    seed(playground, 2, 'Mesa 7', 3);
    seed(playground, 1, 'Mesa 3', 12);

    const state = await playground.session.submit({ text: READY_TEXT, source: 'text' });

    if (state.name !== 'clarifying' || state.interpretation.status !== 'ambiguous') {
      throw new Error(`expected an ambiguous clarification, got ${state.name}`);
    }
    expect(
      state.interpretation.candidates.flatMap((candidate) =>
        candidate.kind === 'entity' ? [candidate.option.label] : [],
      ),
    ).toEqual(['Mesa 3 · pedido 121 · hace 12 min', 'Mesa 7 · pedido 122 · hace 3 min']);
  });

  it('fails with ENTITY_NOT_FOUND and an assertive announcement when nothing is pending', async () => {
    const playground = createPlayground({ principal: kitchen });

    const state = await playground.session.submit({ text: READY_TEXT, source: 'text' });

    expect(state).toMatchObject({ name: 'failed', failure: { code: 'ENTITY_NOT_FOUND' } });
    const [announcement] = playground.announcer.messages();
    expect(announcement?.politeness).toBe('assertive');
    expect(announcement?.message).toMatch(/^No hay .*pendiente/);
  });

  it('lets a waiter see only the lines of their own orders', async () => {
    const playground = createPlayground({ principal: waiterOf('w-1') });
    seed(playground, 1, 'Mesa 3', 12, 'w-1');
    seed(playground, 2, 'Mesa 7', 5, 'w-2');
    const pending = playground.session.submit({ text: READY_TEXT, source: 'text' });

    await untilGraceOffered(playground);
    await playground.clock.advance(GRACE_MS);
    const state = await stateAfter(playground.session, pending);

    expect(state.name).toBe('completed');
    expect(
      playground.store.lines(TENANT_ID).map(({ id, state: lineState }) => [id, lineState]),
    ).toEqual([
      [expect.any(String), 'LISTO'],
      [expect.any(String), 'EN_COLA'],
    ]);
    expect(playground.store.transitions().every(({ lineId }) => lineId.endsWith('1'))).toBe(true);
  });

  it('undoes during the grace window and leaves the line in the queue', async () => {
    const playground = createPlayground({ principal: kitchen });
    seed(playground, 1, 'Mesa 3', 12);
    const pending = playground.session.submit({ text: READY_TEXT, source: 'text' });

    await untilGraceOffered(playground);
    const [offer] = playground.kit.undo.active();
    await playground.session.undo(offer?.planId ?? '');
    await pending;

    expect(playground.session.state().name).toBe('undone');
    expect(playground.store.transitions()).toEqual([]);
    expect(playground.store.lines(TENANT_ID).map(({ state }) => state)).toEqual(['EN_COLA']);
  });
});
