import { describe, expect, it } from 'vitest';
import { createFakeRouter } from './router.js';

describe('fake router', () => {
  it('navigate then currentRoute equals; aborted before navigate leaves currentRoute unchanged', async () => {
    const router = createFakeRouter<'home' | 'orders'>({
      initial: { routeId: 'home', params: {} },
    });
    const live = new AbortController();
    await router.navigate({ routeId: 'orders', params: { id: 'o-1' } }, { signal: live.signal });
    expect(router.currentRoute()).toEqual({ routeId: 'orders', params: { id: 'o-1' } });

    const aborted = new AbortController();
    const reason = new Error('stop');
    aborted.abort(reason);
    await expect(router.navigate({ routeId: 'home' }, { signal: aborted.signal })).rejects.toBe(
      reason,
    );
    expect(router.currentRoute()).toEqual({ routeId: 'orders', params: { id: 'o-1' } });
    expect(router.navigations()).toEqual([{ routeId: 'orders', params: { id: 'o-1' } }]);
  });

  it('manualReady holds waitUntilReady until settle and honours abort', async () => {
    const router = createFakeRouter<'orders'>({ manualReady: true });
    const signal = new AbortController().signal;
    await router.navigate({ routeId: 'orders' }, { signal });
    let ready = false;
    const waiting = router.waitUntilReady({ routeId: 'orders' }, { signal }).then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    router.settle();
    await waiting;
    expect(ready).toBe(true);

    const controller = new AbortController();
    const pending = router.waitUntilReady({ routeId: 'orders', params: { x: '1' } }, controller);
    controller.abort(new Error('late'));
    await expect(pending).rejects.toThrow('late');
  });
});
