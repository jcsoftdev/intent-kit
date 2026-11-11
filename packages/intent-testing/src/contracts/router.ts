import type { Destination, RouterAdapter } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

const abortedWith = (reason: Error): AbortSignal => {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
};

const nextMacrotask = (): Promise<'pending'> =>
  new Promise((resolve) => setTimeout(() => resolve('pending'), 0));

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
      await expect(router.navigate(second, { signal: abortedWith(reason) })).rejects.toBe(reason);
      expect(router.currentRoute()).toEqual(before);
    });

    it('waitUntilReady with an already-aborted signal rejects with the reason even when the route is ready', async () => {
      const { router, first } = factory();
      await router.navigate(first, { signal: new AbortController().signal });
      const reason = new Error('already aborted');
      await expect(router.waitUntilReady(first, { signal: abortedWith(reason) })).rejects.toBe(
        reason,
      );
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
      expect(await Promise.race([outcome, nextMacrotask()])).toBe(reason);
    });
  });
}
