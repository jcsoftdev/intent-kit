import type { Destination, RouterAdapter } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';
import { nextMacrotask } from './abort.js';

export function describeRouterAdapterContract<TRouteId extends string>(
  name: string,
  factory: () => {
    readonly router: RouterAdapter<TRouteId>;
    readonly first: Destination<TRouteId>;
    readonly second: Destination<TRouteId>;
  },
): void {
  describe(`${name} router adapter contract`, () => {
    it('navigate resolves and currentRoute reports the destination route', async () => {
      const { router, first } = factory();
      await router.navigate(first, { signal: new AbortController().signal });
      expect(router.currentRoute()?.routeId).toBe(first.routeId);
      expect(router.currentRoute()?.params).toMatchObject(first.params ?? {});
    });

    it('waitUntilReady resolves for a destination that was navigated to', async () => {
      const { router, first } = factory();
      const { signal } = new AbortController();
      await router.navigate(first, { signal });
      await expect(router.waitUntilReady(first, { signal })).resolves.toBeUndefined();
    });

    it('navigate with an already-aborted signal rejects with the reason and leaves the route unchanged', async () => {
      const { router, first, second } = factory();
      await router.navigate(first, { signal: new AbortController().signal });
      const before = router.currentRoute();
      const reason = new Error('already aborted');
      await expect(router.navigate(second, { signal: AbortSignal.abort(reason) })).rejects.toBe(
        reason,
      );
      expect(router.currentRoute()).toEqual(before);
    });

    it('waitUntilReady with an already-aborted signal rejects with the reason even when the route is ready', async () => {
      const { router, first } = factory();
      await router.navigate(first, { signal: new AbortController().signal });
      const reason = new Error('already aborted');
      await expect(
        router.waitUntilReady(first, { signal: AbortSignal.abort(reason) }),
      ).rejects.toBe(reason);
    });

    it('waitUntilReady for a destination not yet navigated to rejects with the reason within one macrotask of an abort during the call', async () => {
      const { router, second } = factory();
      const controller = new AbortController();
      const reason = new Error('aborted during the call');
      const outcome = router.waitUntilReady(second, { signal: controller.signal }).then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );
      controller.abort(reason);
      expect(await Promise.race([outcome, nextMacrotask().then(() => 'pending')])).toBe(reason);
    });
  });
}
