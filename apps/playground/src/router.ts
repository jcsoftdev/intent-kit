import type { CurrentRoute, Destination, RouterAdapter, Unregister } from '@jcsoftdev/intent-core';
import type { PlaygroundRouteId } from './restaurant.js';

export interface MemoryRouter extends RouterAdapter<PlaygroundRouteId> {
  stack(): readonly Destination<PlaygroundRouteId>[];
  navigations(): readonly Destination<PlaygroundRouteId>[];
  subscribe(listener: (route: CurrentRoute<PlaygroundRouteId>) => void): Unregister;
}

interface Waiter {
  readonly destination: Destination<PlaygroundRouteId>;
  readonly resolve: () => void;
}

const routeOf = (destination: Destination<PlaygroundRouteId>): CurrentRoute<PlaygroundRouteId> => ({
  routeId: destination.routeId,
  params: destination.params ?? {},
});

const matches = (
  route: CurrentRoute<PlaygroundRouteId> | undefined,
  destination: Destination<PlaygroundRouteId>,
): boolean =>
  route !== undefined &&
  route.routeId === destination.routeId &&
  Object.entries(destination.params ?? {}).every(([name, value]) => route.params[name] === value);

export function createMemoryRouter(initial?: Destination<PlaygroundRouteId>): MemoryRouter {
  const stack: Destination<PlaygroundRouteId>[] = initial ? [initial] : [];
  const navigations: Destination<PlaygroundRouteId>[] = [];
  const listeners = new Set<(route: CurrentRoute<PlaygroundRouteId>) => void>();
  let waiters: Waiter[] = [];

  const currentRoute = (): CurrentRoute<PlaygroundRouteId> | undefined => {
    const top = stack.at(-1);
    return top ? routeOf(top) : undefined;
  };

  const releaseWaiters = (): void => {
    const route = currentRoute();
    const ready = waiters.filter((waiter) => matches(route, waiter.destination));
    waiters = waiters.filter((waiter) => !ready.includes(waiter));
    ready.forEach((waiter) => waiter.resolve());
  };

  return {
    currentRoute,
    stack: () => [...stack],
    navigations: () => [...navigations],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async navigate(destination, { signal }) {
      signal.throwIfAborted();
      stack.push(destination);
      navigations.push(destination);
      const route = routeOf(destination);
      [...listeners].forEach((listener) => listener(route));
      releaseWaiters();
    },
    waitUntilReady(destination, { signal }) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        if (matches(currentRoute(), destination)) {
          resolve();
          return;
        }
        const waiter: Waiter = {
          destination,
          resolve: () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          },
        };
        const onAbort = (): void => {
          waiters = waiters.filter((candidate) => candidate !== waiter);
          reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiters.push(waiter);
      });
    },
  };
}
