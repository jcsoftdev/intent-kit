import type { Destination, RouterAdapter, TargetRegistry } from '@jcsoftdev/intent-core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { RouteMap } from './route-map.js';

export interface NextRouterAdapterOptions {
  readonly targets: TargetRegistry<Element>;
  readonly persistentQuery?: readonly string[];
  readonly readyTimeoutMs?: number;
}

interface Location {
  readonly pathname: string;
  readonly search: URLSearchParams;
}

const DEFAULT_READY_TIMEOUT_MS = 5000;

const toSearch = (source: { toString(): string } | null): URLSearchParams =>
  new URLSearchParams(source?.toString() ?? '');

const isMainBusy = (): boolean =>
  document.querySelector('main')?.getAttribute('aria-busy') === 'true';

const subsetOf = (
  expected: Readonly<Record<string, string>> | undefined,
  actual: Readonly<Record<string, string>>,
): boolean => Object.entries(expected ?? {}).every(([name, value]) => actual[name] === value);

function waitUntil(
  isDone: () => boolean,
  subscribe: (notify: () => void) => () => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<void>((resolve, reject) => {
    const finish = (settle: () => void): void => {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = (): void => finish(() => reject(signal.reason));
    const check = (): void => {
      if (isDone()) {
        finish(resolve);
      }
    };
    const unsubscribe = subscribe(check);
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

const subscribeToMainBusy = (notify: () => void): (() => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-busy'],
  });
  return () => observer.disconnect();
};

export function useNextRouterAdapter<TRouteId extends string>(
  map: RouteMap<TRouteId>,
  options: NextRouterAdapterOptions,
): RouterAdapter<TRouteId> {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const latest = useRef({ map, options, router });
  latest.current = { map, options, router };

  const location = useRef<Location>({ pathname, search: toSearch(searchParams) });
  const listeners = useRef(new Set<() => void>());

  useEffect(() => {
    location.current = { pathname, search: toSearch(searchParams) };
    for (const listener of [...listeners.current]) {
      listener();
    }
  }, [pathname, searchParams]);

  const adapter = useRef<RouterAdapter<TRouteId>>(null);
  if (adapter.current === null) {
    const subscribeToRoute = (notify: () => void): (() => void) => {
      listeners.current.add(notify);
      return () => listeners.current.delete(notify);
    };
    const currentRoute: RouterAdapter<TRouteId>['currentRoute'] = () =>
      latest.current.map.match(location.current.pathname, location.current.search);
    const isAt = (destination: Destination<TRouteId>): boolean => {
      const route = currentRoute();
      return route?.routeId === destination.routeId && subsetOf(destination.params, route.params);
    };
    const hrefWithPersistentQuery = (destination: Destination<TRouteId>): string => {
      const [path = '', query = ''] = latest.current.map.href(destination).split('?');
      const search = new URLSearchParams(query);
      for (const name of latest.current.options.persistentQuery ?? []) {
        const carried = location.current.search.get(name);
        if (!search.has(name) && carried !== null) {
          search.set(name, carried);
        }
      }
      const text = search.toString();
      return text === '' ? path : `${path}?${text}`;
    };
    const awaitTarget = async (
      destination: Destination<TRouteId>,
      signal: AbortSignal,
    ): Promise<void> => {
      if (destination.target !== undefined) {
        await latest.current.options.targets.waitFor(destination.target, {
          signal,
          timeoutMs: latest.current.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        });
      }
    };

    adapter.current = {
      currentRoute,
      async navigate(destination, { signal }) {
        signal.throwIfAborted();
        if (!isAt(destination)) {
          latest.current.router.push(hrefWithPersistentQuery(destination));
        }
        await waitUntil(() => isAt(destination), subscribeToRoute, signal);
      },
      async waitUntilReady(destination, { signal }) {
        signal.throwIfAborted();
        await waitUntil(() => isAt(destination), subscribeToRoute, signal);
        await awaitTarget(destination, signal);
        await waitUntil(() => !isMainBusy(), subscribeToMainBusy, signal);
      },
    };
  }
  return adapter.current;
}
