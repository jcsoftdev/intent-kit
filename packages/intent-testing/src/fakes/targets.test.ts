import { IntentDefinitionError } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';
import { createFakeTargetRegistry } from './targets.js';

const expectation = { role: 'button', requireName: true };
const signal = new AbortController().signal;

describe('fake targets', () => {
  it('duplicate (order-card, o-1) throws DUPLICATE_TARGET; role mismatch is recorded as a violation; waitFor resolves when the target mounts later', async () => {
    const registry = createFakeTargetRegistry();
    const ref = { intent: 'order-card', key: 'o-1' };
    const card = { id: 'e1', role: 'button', name: 'Pedido 1' };
    registry.register(ref, card, expectation);
    expect(() => registry.register(ref, { ...card, id: 'e2' }, expectation)).toThrow(
      expect.objectContaining({ name: IntentDefinitionError.name, reason: 'DUPLICATE_TARGET' }),
    );
    expect(registry.find(ref)).toBe(card);

    registry.register({ intent: 'order-card', key: 'o-2' }, { ...card, role: 'link' }, expectation);
    registry.register({ intent: 'nameless' }, { ...card, name: ' ' }, expectation);
    expect(
      registry.violations().map((violation) => violation.ref.key ?? violation.ref.intent),
    ).toEqual(['o-2', 'nameless']);

    const later = { intent: 'order-card', key: 'o-3' };
    const waiting = registry.waitFor(later, { signal, timeoutMs: 1000 });
    const mounted = { id: 'e3', role: 'button', name: 'Pedido 3' };
    registry.register(later, mounted, expectation);
    await expect(waiting).resolves.toBe(mounted);
  });

  it('unregister removes, waitFor times out and aborts', async () => {
    const registry = createFakeTargetRegistry();
    const ref = { intent: 'a' };
    const unregister = registry.register(ref, { id: 'e', role: 'button', name: 'A' }, expectation);
    unregister();
    expect(registry.find(ref)).toBeUndefined();
    await expect(registry.waitFor(ref, { signal, timeoutMs: 5 })).rejects.toMatchObject({
      failure: { code: 'TARGET_NOT_FOUND' },
    });
    const controller = new AbortController();
    const pending = registry.waitFor(ref, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort(new Error('gone'));
    await expect(pending).rejects.toThrow('gone');
  });
});
