import {
  IntentFailureError,
  type CurrentRoute,
  type Destination,
  type RouterAdapter,
} from '@jcsoftdev/intent-core';

export interface FakeRouter<TRouteId extends string> extends RouterAdapter<TRouteId> {
  navigations(): readonly Destination<TRouteId>[];
  settle(): void;
}

interface Waiter {
  readonly isReady: () => boolean;
  readonly resolve: () => void;
}

const NAVIGATION_FAILED = new IntentFailureError({
  stage: 'navigation',
  code: 'NAVIGATION_FAILED',
  retryable: false,
});

const matchesDestination = <TRouteId extends string>(
  route: CurrentRoute<TRouteId> | undefined,
  destination: Destination<TRouteId>,
): boolean =>
  route !== undefined &&
  route.routeId === destination.routeId &&
  Object.entries(destination.params ?? {}).every(([key, value]) => route.params[key] === value);

export const createFakeRouter = <TRouteId extends string>(
  options: {
    readonly initial?: CurrentRoute<TRouteId>;
    readonly manualReady?: boolean;
    readonly fail?: (destination: Destination<TRouteId>) => boolean;
  } = {},
): FakeRouter<TRouteId> => {
  let route: CurrentRoute<TRouteId> | undefined = options.initial;
  let settled = !options.manualReady;
  const visited: Destination<TRouteId>[] = [];
  let waiters: Waiter[] = [];

  const release = (): void => {
    const ready = waiters.filter((waiter) => waiter.isReady());
    waiters = waiters.filter((waiter) => !ready.includes(waiter));
    ready.forEach((waiter) => waiter.resolve());
  };

  return {
    currentRoute: () => route,
    navigations: () => [...visited],
    settle() {
      settled = true;
      release();
    },
    async navigate(destination, { signal }) {
      signal.throwIfAborted();
      visited.push(destination);
      if (options.fail?.(destination)) {
        throw NAVIGATION_FAILED;
      }
      route = { routeId: destination.routeId, params: destination.params ?? {} };
      settled = !options.manualReady;
      release();
    },
    waitUntilReady(destination, { signal }) {
      return new Promise<void>((resolve, reject) => {
        const isReady = (): boolean => settled && matchesDestination(route, destination);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        if (isReady()) {
          resolve();
          return;
        }
        const waiter: Waiter = {
          isReady,
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
};
