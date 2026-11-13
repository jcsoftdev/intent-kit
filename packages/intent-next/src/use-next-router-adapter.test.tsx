import { act, renderHook } from '@testing-library/react';
import { createFakeTargetRegistry } from '@jcsoftdev/intent-testing';
import { describeRouterAdapterContract } from '@jcsoftdev/intent-testing/contracts';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteMap } from './route-map.js';
import { useNextRouterAdapter } from './use-next-router-adapter.js';

const navigation = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { url: '/', snapshot: { pathname: '/', search: new URLSearchParams() } };
  const push = vi.fn<(href: string) => void>();
  return { listeners, state, push };
});

const applyUrl = (href: string): void => {
  const parsed = new URL(href, 'http://localhost');
  navigation.state.snapshot = { pathname: parsed.pathname, search: parsed.searchParams };
  for (const listener of [...navigation.listeners]) {
    listener();
  }
};

const subscribe = (listener: () => void): (() => void) => {
  navigation.listeners.add(listener);
  return () => navigation.listeners.delete(listener);
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => useSyncExternalStore(subscribe, () => navigation.state.snapshot).pathname,
  useSearchParams: () => useSyncExternalStore(subscribe, () => navigation.state.snapshot).search,
}));

type RouteId = 'home' | 'orders' | 'order';

const map = createRouteMap<RouteId>({
  home: { path: '/' },
  orders: { path: '/orders', query: ['venueId'] },
  order: { path: '/orders/:id', query: ['venueId'] },
});

const mount = (persistentQuery?: readonly string[]) => {
  const targets = createFakeTargetRegistry();
  const rendered = renderHook(() =>
    useNextRouterAdapter(map, { targets: targets as never, persistentQuery }),
  );
  return { ...rendered, targets, router: () => rendered.result.current };
};

const signal = () => new AbortController().signal;

beforeEach(() => {
  navigation.push.mockReset();
  navigation.push.mockImplementation((href) => act(() => applyUrl(href)));
  act(() => applyUrl('/'));
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useNextRouterAdapter', () => {
  it('navigate pushes once and resolves only after usePathname reports the destination', async () => {
    navigation.push.mockImplementation(() => undefined);
    const { router } = mount();
    let settled = false;
    const done = router()
      .navigate({ routeId: 'orders' }, { signal: signal() })
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith('/orders');
    expect(settled).toBe(false);
    act(() => applyUrl('/orders'));
    await done;
    expect(settled).toBe(true);
  });

  it('navigate to the current route does not push', async () => {
    const { router } = mount();
    await router().navigate({ routeId: 'home' }, { signal: signal() });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('abort during navigate rejects with the reason', async () => {
    navigation.push.mockImplementation(() => undefined);
    const { router } = mount();
    const controller = new AbortController();
    const reason = new Error('stop');
    const outcome = router().navigate({ routeId: 'orders' }, { signal: controller.signal });
    controller.abort(reason);
    await expect(outcome).rejects.toBe(reason);
  });

  it('venueId is preserved', async () => {
    act(() => applyUrl('/?venueId=v1'));
    const { router } = mount(['venueId']);
    await router().navigate({ routeId: 'orders' }, { signal: signal() });
    expect(navigation.push).toHaveBeenCalledWith('/orders?venueId=v1');
    expect(router().currentRoute()).toEqual({ routeId: 'orders', params: { venueId: 'v1' } });
  });

  it('an explicit param wins over the persisted one', async () => {
    act(() => applyUrl('/?venueId=v1'));
    const { router } = mount(['venueId']);
    await router().navigate({ routeId: 'orders', params: { venueId: 'v2' } }, { signal: signal() });
    expect(navigation.push).toHaveBeenCalledWith('/orders?venueId=v2');
  });

  it('currentRoute follows the location', () => {
    const { router } = mount();
    expect(router().currentRoute()).toEqual({ routeId: 'home', params: {} });
    act(() => applyUrl('/orders/9'));
    expect(router().currentRoute()).toEqual({ routeId: 'order', params: { id: '9' } });
  });

  it('keeps one adapter identity across renders', () => {
    const { result, rerender } = mount();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  describe('waitUntilReady', () => {
    it('waits for the target and for main not aria-busy', async () => {
      const main = document.createElement('main');
      main.setAttribute('aria-busy', 'true');
      document.body.append(main);
      const { router, targets } = mount();
      act(() => applyUrl('/orders'));
      let settled = false;
      const done = router()
        .waitUntilReady(
          { routeId: 'orders', target: { intent: 'orders.list' } },
          { signal: signal() },
        )
        .then(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      targets.register(
        { intent: 'orders.list' },
        { id: 'list', role: 'list', name: 'Orders' },
        { role: 'list', requireName: true },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      main.removeAttribute('aria-busy');
      await done;
      expect(settled).toBe(true);
    });

    it('waits for the route to match before resolving', async () => {
      const { router } = mount();
      let settled = false;
      const done = router()
        .waitUntilReady({ routeId: 'orders' }, { signal: signal() })
        .then(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      act(() => applyUrl('/orders'));
      await done;
    });
  });

  describeRouterAdapterContract('next', () => {
    act(() => applyUrl('/'));
    const { router } = mount();
    return {
      router: router(),
      first: { routeId: 'orders' as const },
      second: { routeId: 'order' as const, params: { id: '1' } },
    };
  });
});
